import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import path from 'path';
import { EventsRepository } from '@app/database';
import * as schema from '@app/database';
import { WorkflowRegistry } from '@app/core';
import { EchoWorkflow, EchoNode, UpperCaseNode } from '@app/workflows';
import { detectRagNetwork, attachOrExpose, endpointOf } from '../../../../test/helpers/rag-network';

const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../../docker/migrations');

/**
 * When running inside the builder Docker container we share the `rag_default`
 * Docker network with the compose stack.  We attach Testcontainers-managed
 * containers to that same network so they are directly reachable by container IP,
 * bypassing the host port-mapping that is blocked between network namespaces.
 *
 * Outside Docker (plain host) Testcontainers' standard exposed-port strategy works.
 */
async function startContainersForTest(): Promise<{
  pgHost: string;
  pgPort: number;
  redisHost: string;
  redisPort: number;
  pgContainer: StartedTestContainer;
  redisContainer: StartedTestContainer;
}> {
  const net = await detectRagNetwork();

  const pgBuilder = attachOrExpose(
    new GenericContainer('postgres:16-bookworm')
      .withEnvironment({
        POSTGRES_DB: 'rag_test',
        POSTGRES_USER: 'rag',
        POSTGRES_PASSWORD: 'rag',
      })
      .withWaitStrategy(
        // Postgres inits, RESTARTS, then listens: a psql check via the unix
        // socket passes during the first phase, before TCP is actually up
        // (flaky ECONNREFUSED through the docker gateway). The second "ready"
        // log line marks the real, post-restart listen.
        Wait.forLogMessage(/database system is ready to accept connections/, 2).withStartupTimeout(
          60_000,
        ),
      ),
    net,
    'pg_tc_test',
    5432,
  );

  const redisBuilder = attachOrExpose(
    new GenericContainer('redis:7-bookworm').withWaitStrategy(
      Wait.forSuccessfulCommand('redis-cli ping'),
    ),
    net,
    'redis_tc_test',
    6379,
  );

  const [pgContainer, redisContainer] = await Promise.all([
    pgBuilder.start(),
    redisBuilder.start(),
  ]);

  const [pg, redis] = await Promise.all([
    endpointOf(pgContainer, net, 5432),
    endpointOf(redisContainer, net, 6379),
  ]);

  return {
    pgHost: pg.host,
    pgPort: pg.port,
    redisHost: redis.host,
    redisPort: redis.port,
    pgContainer,
    redisContainer,
  };
}

describe('Events integration (Redis + Postgres)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let pool: Pool;
  let queue: Queue;
  let worker: Worker;
  let eventsRepo: EventsRepository;
  let workflowRegistry: WorkflowRegistry;

  beforeAll(async () => {
    const {
      pgHost,
      pgPort,
      redisHost,
      redisPort,
      pgContainer: pg,
      redisContainer: redis,
    } = await startContainersForTest();
    pgContainer = pg;
    redisContainer = redis;

    const dbUrl = `postgresql://rag:rag@${pgHost}:${pgPort}/rag_test`;
    pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    eventsRepo = new EventsRepository(
      db as Parameters<typeof EventsRepository.prototype.constructor>[0],
    );

    const connection = { host: redisHost, port: redisPort };

    const echoNode = new EchoNode();
    const echoWorkflow = new EchoWorkflow(echoNode, new UpperCaseNode(echoNode));
    workflowRegistry = new WorkflowRegistry();
    workflowRegistry.register(EchoWorkflow.TYPE, echoWorkflow);

    queue = new Queue('events_integration', { connection });

    worker = new Worker(
      'events_integration',
      async (job) => {
        const { eventId } = job.data as { eventId: string };
        const event = await eventsRepo.findById(eventId);
        if (!event) throw new Error(`Event ${eventId} not found`);
        await eventsRepo.updateStatus(eventId, 'processing');
        try {
          const wf = workflowRegistry.resolve(event.workflowType);
          const ctx = await wf.run(event.data, event.traceId ?? undefined);
          await eventsRepo.complete(eventId, Object.fromEntries(ctx.nodes.entries()));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          await eventsRepo.fail(eventId, msg);
          throw err;
        }
      },
      { connection, concurrency: 2 },
    );

    await worker.waitUntilReady();
  }, 120_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await pool?.end();
    await pgContainer?.stop();
    await redisContainer?.stop();
  });

  it('processes an echo event end-to-end: pending → completed', async () => {
    const event = await eventsRepo.create({
      workflowType: 'echo',
      data: { message: 'hello' },
    });

    await queue.add('process', { eventId: event.id }, { attempts: 1 });

    let found = await eventsRepo.findById(event.id);
    const deadline = Date.now() + 10_000;
    while (found?.status !== 'completed' && found?.status !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      found = await eventsRepo.findById(event.id);
    }

    expect(found?.status).toBe('completed');
    const result = found?.result as Record<string, unknown>;
    expect(result['UpperCaseNode']).toMatchObject({ result: 'HELLO' });
  }, 30_000);

  it('marks event as failed when workflow type is unknown (never stuck pending)', async () => {
    const event = await eventsRepo.create({
      workflowType: 'unknown-workflow-type',
      data: {},
    });

    await queue.add('process', { eventId: event.id }, { attempts: 1 });

    let found = await eventsRepo.findById(event.id);
    const deadline = Date.now() + 10_000;
    while (found?.status === 'pending' || found?.status === 'processing') {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 200));
      found = await eventsRepo.findById(event.id);
    }

    expect(found?.status).toBe('failed');
    expect(found?.error).toMatch(/unknown-workflow-type/i);
  }, 30_000);
});

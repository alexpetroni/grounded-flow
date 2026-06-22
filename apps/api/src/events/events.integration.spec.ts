import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import Dockerode from 'dockerode';
import path from 'path';
import { EventsRepository } from '@app/database';
import * as schema from '@app/database';
import { WorkflowRegistry } from '@app/core';
import { EchoWorkflow } from '../../../../workflows/echo/echo.workflow';
import { EchoNode, UpperCaseNode } from '../../../../workflows/echo/echo.nodes';

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
  const docker = new Dockerode();

  // Detect if we are inside the `rag_default` Docker network
  let ragNetworkId: string | null = null;
  try {
    const nets = await docker.listNetworks({ filters: JSON.stringify({ name: ['rag_default'] }) });
    if (nets.length > 0) ragNetworkId = nets[0].Id;
  } catch {
    // not in Docker or no socket access — proceed with standard strategy
  }

  const fakeNetwork = ragNetworkId
    ? ({ getId: () => ragNetworkId, getName: () => 'rag_default' } as unknown as Parameters<
        typeof GenericContainer.prototype.withNetwork
      >[0])
    : null;

  let pgBuilder = new GenericContainer('postgres:16-bookworm')
    .withEnvironment({
      POSTGRES_DB: 'rag_test',
      POSTGRES_USER: 'rag',
      POSTGRES_PASSWORD: 'rag',
    })
    .withWaitStrategy(Wait.forSuccessfulCommand('psql -U rag -d rag_test -c "SELECT 1"'));

  let redisBuilder = new GenericContainer('redis:7-bookworm').withWaitStrategy(
    Wait.forSuccessfulCommand('redis-cli ping'),
  );

  if (fakeNetwork) {
    pgBuilder = pgBuilder.withNetwork(fakeNetwork).withNetworkAliases('pg_tc_test');
    redisBuilder = redisBuilder.withNetwork(fakeNetwork).withNetworkAliases('redis_tc_test');
  } else {
    pgBuilder = pgBuilder.withExposedPorts(5432);
    redisBuilder = redisBuilder.withExposedPorts(6379);
  }

  const [pgContainer, redisContainer] = await Promise.all([
    pgBuilder.start(),
    redisBuilder.start(),
  ]);

  let pgHost: string;
  let pgPort: number;
  let redisHost: string;
  let redisPort: number;

  if (ragNetworkId) {
    const pgInfo = await docker.getContainer(pgContainer.getId()).inspect();
    const redisInfo = await docker.getContainer(redisContainer.getId()).inspect();
    pgHost = pgInfo.NetworkSettings.Networks['rag_default']?.IPAddress ?? pgContainer.getHost();
    pgPort = 5432;
    redisHost =
      redisInfo.NetworkSettings.Networks['rag_default']?.IPAddress ?? redisContainer.getHost();
    redisPort = 6379;
  } else {
    pgHost = pgContainer.getHost();
    pgPort = pgContainer.getMappedPort(5432);
    redisHost = redisContainer.getHost();
    redisPort = redisContainer.getMappedPort(6379);
  }

  return { pgHost, pgPort, redisHost, redisPort, pgContainer, redisContainer };
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

    const echoWorkflow = new EchoWorkflow(new EchoNode(), new UpperCaseNode());
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

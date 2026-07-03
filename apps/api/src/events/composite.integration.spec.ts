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
import {
  EchoWorkflow,
  EchoNode,
  UpperCaseNode,
  CompositeWorkflow,
  EchoSubWorkflowNode,
  SummarizeNode,
} from '@app/workflows';
import { detectRagNetwork, attachOrExpose, endpointOf } from '../../../../test/helpers/rag-network';

const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../../docker/migrations');

async function startContainers(): Promise<{
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
      .withEnvironment({ POSTGRES_DB: 'rag_test', POSTGRES_USER: 'rag', POSTGRES_PASSWORD: 'rag' })
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
    'pg_composite_test',
    5432,
  );
  const redisBuilder = attachOrExpose(
    new GenericContainer('redis:7-bookworm').withWaitStrategy(
      Wait.forSuccessfulCommand('redis-cli ping'),
    ),
    net,
    'redis_composite_test',
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

describe('Composite workflow integration (events path)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let pool: Pool;
  let queue: Queue;
  let worker: Worker;
  let eventsRepo: EventsRepository;

  beforeAll(async () => {
    const { pgHost, pgPort, redisHost, redisPort, ...containers } = await startContainers();
    pgContainer = containers.pgContainer;
    redisContainer = containers.redisContainer;

    const dbUrl = `postgresql://rag:rag@${pgHost}:${pgPort}/rag_test`;
    pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    eventsRepo = new EventsRepository(
      db as Parameters<typeof EventsRepository.prototype.constructor>[0],
    );

    // Build the registry by hand (mirrors what WorkflowsModule's onModuleInit
    // does): register echo, then construct the composite with that shared
    // registry and register it too.
    const registry = new WorkflowRegistry();
    const echoNode = new EchoNode();
    registry.register(EchoWorkflow.TYPE, new EchoWorkflow(echoNode, new UpperCaseNode(echoNode)));
    const echoSub = new EchoSubWorkflowNode(registry);
    const composite = new CompositeWorkflow(
      echoSub,
      new SummarizeNode(echoSub),
      registry,
    );
    registry.register(CompositeWorkflow.TYPE, composite);

    const connection = { host: redisHost, port: redisPort };
    queue = new Queue('events_composite', { connection });
    worker = new Worker(
      'events_composite',
      async (job) => {
        const { eventId } = job.data as { eventId: string };
        const event = await eventsRepo.findById(eventId);
        if (!event) throw new Error(`Event ${eventId} not found`);
        await eventsRepo.updateStatus(eventId, 'processing');
        try {
          const wf = registry.resolve(event.workflowType);
          const ctx = await wf.run(event.data, event.traceId ?? undefined);
          await eventsRepo.complete(eventId, Object.fromEntries(ctx.nodes.entries()));
        } catch (err: unknown) {
          await eventsRepo.fail(eventId, err instanceof Error ? err.message : String(err));
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

  it('runs a composed workflow end-to-end and persists the merged child output', async () => {
    const event = await eventsRepo.create({
      workflowType: 'composite',
      data: { text: 'hello world' },
    });

    await queue.add('process', { eventId: event.id }, { attempts: 1 });

    let found = await eventsRepo.findById(event.id);
    const deadline = Date.now() + 15_000;
    while (found?.status !== 'completed' && found?.status !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      found = await eventsRepo.findById(event.id);
    }

    expect(found?.status).toBe('completed');
    const result = found?.result as Record<string, { [k: string]: unknown }>;

    // The sub-workflow node merged the child's outputs, namespaced under its token.
    const sub = result['EchoSubWorkflow'] as {
      workflowType: string;
      nodes: Record<string, { result?: string }>;
    };
    expect(sub.workflowType).toBe('echo');
    expect(sub.nodes['UpperCaseNode']).toMatchObject({ result: 'HELLO WORLD' });

    // The downstream parent node consumed the child result.
    expect(result['SummarizeNode']).toMatchObject({
      summary: 'echo workflow returned: HELLO WORLD',
      childWorkflow: 'echo',
    });
  }, 30_000);
});

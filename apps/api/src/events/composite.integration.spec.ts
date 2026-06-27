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
import { CompositeWorkflow } from '../../../../workflows/composite/composite.workflow';
import {
  EchoSubWorkflowNode,
  SummarizeNode,
} from '../../../../workflows/composite/composite.nodes';

const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../../docker/migrations');

async function startContainers(): Promise<{
  pgHost: string;
  pgPort: number;
  redisHost: string;
  redisPort: number;
  pgContainer: StartedTestContainer;
  redisContainer: StartedTestContainer;
}> {
  const docker = new Dockerode();
  let ragNetworkId: string | null = null;
  try {
    const nets = await docker.listNetworks({ filters: JSON.stringify({ name: ['rag_default'] }) });
    if (nets.length > 0) ragNetworkId = nets[0].Id;
  } catch {
    // not in Docker
  }
  const fakeNetwork = ragNetworkId
    ? ({ getId: () => ragNetworkId, getName: () => 'rag_default' } as unknown as Parameters<
        typeof GenericContainer.prototype.withNetwork
      >[0])
    : null;

  let pgBuilder = new GenericContainer('postgres:16-bookworm')
    .withEnvironment({ POSTGRES_DB: 'rag_test', POSTGRES_USER: 'rag', POSTGRES_PASSWORD: 'rag' })
    .withWaitStrategy(Wait.forSuccessfulCommand('psql -U rag -d rag_test -c "SELECT 1"'));
  let redisBuilder = new GenericContainer('redis:7-bookworm').withWaitStrategy(
    Wait.forSuccessfulCommand('redis-cli ping'),
  );

  if (fakeNetwork) {
    pgBuilder = pgBuilder.withNetwork(fakeNetwork).withNetworkAliases('pg_composite_test');
    redisBuilder = redisBuilder.withNetwork(fakeNetwork).withNetworkAliases('redis_composite_test');
  } else {
    pgBuilder = pgBuilder.withExposedPorts(5432);
    redisBuilder = redisBuilder.withExposedPorts(6379);
  }

  const [pgContainer, redisContainer] = await Promise.all([
    pgBuilder.start(),
    redisBuilder.start(),
  ]);

  if (ragNetworkId) {
    const pgInfo = await docker.getContainer(pgContainer.getId()).inspect();
    const redisInfo = await docker.getContainer(redisContainer.getId()).inspect();
    return {
      pgHost: pgInfo.NetworkSettings.Networks['rag_default']?.IPAddress ?? pgContainer.getHost(),
      pgPort: 5432,
      redisHost:
        redisInfo.NetworkSettings.Networks['rag_default']?.IPAddress ?? redisContainer.getHost(),
      redisPort: 6379,
      pgContainer,
      redisContainer,
    };
  }
  return {
    pgHost: pgContainer.getHost(),
    pgPort: pgContainer.getMappedPort(5432),
    redisHost: redisContainer.getHost(),
    redisPort: redisContainer.getMappedPort(6379),
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

    // Build the registry the same way WorkflowsModule does: register echo, then
    // construct the composite with that shared registry and register it too.
    const registry = new WorkflowRegistry();
    registry.register(EchoWorkflow.TYPE, new EchoWorkflow(new EchoNode(), new UpperCaseNode()));
    const composite = new CompositeWorkflow(
      new EchoSubWorkflowNode(registry),
      new SummarizeNode(),
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

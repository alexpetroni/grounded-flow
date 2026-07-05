import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import { DeadLetterService, MAX_DLQ_ENTRIES } from './dead-letter.service';
import { detectRagNetwork, attachOrExpose, endpointOf } from '../../../test/helpers/rag-network';

let container: StartedTestContainer;
let connection: { host: string; port: number };
let dls: DeadLetterService;

async function startRedis(): Promise<{ host: string; port: number }> {
  const net = await detectRagNetwork();

  const builder = attachOrExpose(
    new GenericContainer('redis:7-bookworm').withWaitStrategy(
      Wait.forSuccessfulCommand('redis-cli ping'),
    ),
    net,
    'redis_dlq_test',
    6379,
  );

  container = await builder.start();
  return endpointOf(container, net, 6379);
}

function configWith(url: string): ConfigService {
  return {
    get: (key: string) => (key === 'REDIS_URL' ? url : undefined),
  } as unknown as ConfigService;
}

async function waitForState(
  queue: Queue,
  jobId: string,
  states: string[],
  timeoutMs = 10_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId);
    const state = job ? await job.getState() : 'missing';
    if (states.includes(state)) return state;
    await new Promise((r) => setTimeout(r, 100));
  }
  const job = await queue.getJob(jobId);
  throw new Error(`Timed out; last state was ${job ? await job.getState() : 'missing'}`);
}

beforeAll(async () => {
  connection = await startRedis();
  dls = new DeadLetterService(configWith(`redis://${connection.host}:${connection.port}/0`));
}, 90_000);

afterAll(async () => {
  await dls?.onModuleDestroy();
  await container?.stop();
}, 60_000);

describe('Worker resilience + dead-letter', () => {
  it('retries then reaches a terminal failed status and dead-letters (never stuck pending)', async () => {
    const QUEUE = 'resil-fail';
    const queue = new Queue(QUEUE, { connection });
    const worker = new Worker(
      QUEUE,
      async () => {
        throw new Error('always boom');
      },
      { connection, autorun: true },
    );
    worker.on('failed', async (job, err) => {
      if (job && dls.isTerminal(job)) await dls.deadLetter(QUEUE, job, err);
    });

    const job = await queue.add(
      'job',
      { n: 1 },
      { attempts: 2, backoff: { type: 'fixed', delay: 50 } },
    );

    const state = await waitForState(queue, job.id!, ['failed']);
    expect(state).toBe('failed'); // terminal, not stuck waiting/active
    const reloaded = await queue.getJob(job.id!);
    expect(reloaded?.attemptsMade).toBe(2);

    // Terminal failure was dead-lettered.
    const dlq = new Queue(DeadLetterService.dlqName(QUEUE), { connection });
    const start = Date.now();
    let dead = await dlq.getJobs(['waiting', 'paused', 'delayed']);
    while (dead.length === 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 100));
      dead = await dlq.getJobs(['waiting', 'paused', 'delayed']);
    }
    expect(dead.length).toBeGreaterThanOrEqual(1);
    expect((dead[0]!.data as { failedReason: string }).failedReason).toContain('always boom');

    await worker.close();
    await queue.close();
    await dlq.close();
  });

  it('a transient failure retries and then completes (terminal success, no dead-letter)', async () => {
    const QUEUE = 'resil-recover';
    const queue = new Queue(QUEUE, { connection });
    let attempts = 0;
    const worker = new Worker(
      QUEUE,
      async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('transient');
        return 'ok';
      },
      { connection, autorun: true },
    );
    worker.on('failed', async (job, err) => {
      if (job && dls.isTerminal(job)) await dls.deadLetter(QUEUE, job, err);
    });

    const job = await queue.add(
      'job',
      { n: 2 },
      { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    );

    const state = await waitForState(queue, job.id!, ['completed']);
    expect(state).toBe('completed');

    const dlq = new Queue(DeadLetterService.dlqName(QUEUE), { connection });
    expect(await dlq.getJobCountByTypes('waiting')).toBe(0);

    await worker.close();
    await queue.close();
    await dlq.close();
  });

  // A terminal-failed job shaped like what BullMQ hands the 'failed' handler.
  const terminalJob = (id: string): Job =>
    ({ id, data: { n: 1 }, attemptsMade: 2, opts: { attempts: 2 } }) as unknown as Job;

  it('caps the DLQ across waiting and paused states, dropping the oldest loudly', async () => {
    const QUEUE = 'resil-cap';
    const dlq = new Queue(DeadLetterService.dlqName(QUEUE), { connection });
    // Seed to exactly the cap, then pause the DLQ (an operator inspecting
    // it mid-incident) — new entries land in 'paused', which the cap must
    // still see.
    await dlq.addBulk(
      Array.from({ length: MAX_DLQ_ENTRIES }, (_, i) => ({
        name: 'dead-letter',
        data: { seed: i },
        opts: { removeOnComplete: false, removeOnFail: false },
      })),
    );
    await dlq.pause();

    await dls.deadLetter(QUEUE, terminalJob('over-cap'), new Error('boom'));

    expect(await dlq.getJobCountByTypes('waiting', 'paused')).toBe(MAX_DLQ_ENTRIES);
    const kept = await dlq.getJobs(['waiting', 'paused'], 0, MAX_DLQ_ENTRIES, true);
    const datas = kept.map((j) => j.data as { seed?: number; originalJobId?: string });
    expect(datas.some((d) => d.originalJobId === 'over-cap')).toBe(true); // newest kept
    expect(datas.some((d) => d.seed === 0)).toBe(false); // oldest dropped

    // Drain the 1,000 seeded records so suite teardown stays fast.
    await dlq.obliterate({ force: true });
    await dlq.close();
  }, 60_000);

  // Regression: the trim runs inside the worker's 'failed' handler, which
  // nothing awaits or catches — a transient Redis error there must not become
  // an unhandled rejection that kills the worker process.
  it('does not reject when the cap trim fails after a successful add', async () => {
    const QUEUE = 'resil-trim-error';
    await dls.deadLetter(QUEUE, terminalJob('j1'), new Error('boom'));

    const internal = (dls as unknown as { queues: Map<string, Queue> }).queues.get(
      DeadLetterService.dlqName(QUEUE),
    )!;
    const spy = vi
      .spyOn(internal, 'getJobCountByTypes')
      .mockRejectedValueOnce(new Error('redis down'));

    await expect(
      dls.deadLetter(QUEUE, terminalJob('j2'), new Error('boom')),
    ).resolves.not.toThrow();
    spy.mockRestore();

    // Both records were still durably added.
    const dlq = new Queue(DeadLetterService.dlqName(QUEUE), { connection });
    expect(await dlq.getJobCountByTypes('waiting', 'paused')).toBe(2);
    await dlq.close();
  });
});

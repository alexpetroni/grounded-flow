/**
 * Worker concurrency for the `@Processor` decorator. The decorator is evaluated
 * at class-definition time (before Nest DI), so this reads `process.env`
 * directly; the value is validated again by the Zod env schema at boot.
 */
export function workerConcurrency(): number {
  const raw = Number(process.env.WORKER_CONCURRENCY);
  return Number.isInteger(raw) && raw > 0 ? raw : 5;
}

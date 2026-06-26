import type { EvalMetrics } from './metrics';

export interface CheckResult {
  passed: boolean;
  failures: string[];
}

const EPSILON = 1e-6;

/**
 * Ratchet: the current run must not drop below the recorded baseline on any
 * metric the baseline tracks. A small epsilon absorbs floating-point jitter.
 */
export function checkRatchet(current: EvalMetrics, baseline: Partial<EvalMetrics>): CheckResult {
  const failures: string[] = [];
  for (const key of Object.keys(baseline) as (keyof EvalMetrics)[]) {
    const base = baseline[key];
    if (typeof base !== 'number') continue;
    const cur = current[key];
    if (typeof cur !== 'number') {
      failures.push(`${key}: missing in current run (baseline ${base.toFixed(4)})`);
      continue;
    }
    if (cur < base - EPSILON) {
      failures.push(`${key}: ${cur.toFixed(4)} regressed below baseline ${base.toFixed(4)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

/**
 * Absolute quality gate. Each provided threshold must be met. Metrics absent
 * from the current run (e.g. faithfulness without an LLM judge) are skipped, so
 * the retrieval-only path still gates on retrieval thresholds.
 */
export function checkThresholds(
  current: EvalMetrics,
  thresholds: Partial<EvalMetrics>,
): CheckResult {
  const failures: string[] = [];
  for (const key of Object.keys(thresholds) as (keyof EvalMetrics)[]) {
    const min = thresholds[key];
    if (typeof min !== 'number') continue;
    const cur = current[key];
    if (typeof cur !== 'number') continue; // not measured this run
    if (cur < min - EPSILON) {
      failures.push(`${key}: ${cur.toFixed(4)} below threshold ${min.toFixed(4)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

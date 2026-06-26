import { describe, it, expect } from 'vitest';
import {
  recallAtK,
  reciprocalRank,
  meanReciprocalRank,
  contextPrecisionAtK,
  aggregate,
  mean,
} from './metrics';
import { checkRatchet, checkThresholds } from './ratchet';

describe('metrics', () => {
  it('recallAtK counts gold items within k and caps at totalRelevant', () => {
    expect(recallAtK({ relevant: [false, true, false], totalRelevant: 1 }, 5)).toBe(1);
    expect(recallAtK({ relevant: [false, false, true], totalRelevant: 1 }, 2)).toBe(0);
    // two retrieved but only one gold → capped at 1
    expect(recallAtK({ relevant: [true, true], totalRelevant: 1 }, 5)).toBe(1);
    // half of two gold found
    expect(recallAtK({ relevant: [true, false], totalRelevant: 2 }, 5)).toBe(0.5);
    expect(recallAtK({ relevant: [], totalRelevant: 0 }, 5)).toBe(0);
  });

  it('reciprocalRank reflects the first relevant position', () => {
    expect(reciprocalRank([true])).toBe(1);
    expect(reciprocalRank([false, true])).toBe(0.5);
    expect(reciprocalRank([false, false, false])).toBe(0);
  });

  it('meanReciprocalRank averages across queries', () => {
    expect(meanReciprocalRank([[true], [false, true]])).toBeCloseTo(0.75, 10);
    expect(meanReciprocalRank([])).toBe(0);
  });

  it('contextPrecisionAtK is the relevant fraction of the top-k window', () => {
    expect(contextPrecisionAtK([true, false, true, false], 4)).toBe(0.5);
    expect(contextPrecisionAtK([true, true], 5)).toBe(1);
    expect(contextPrecisionAtK([], 5)).toBe(0);
  });

  it('mean handles the empty case', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('aggregate produces headline metrics', () => {
    const m = aggregate([
      { relevant: [true, false, false], totalRelevant: 1 },
      { relevant: [false, true, false], totalRelevant: 1 },
    ]);
    expect(m.recallAt5).toBe(1);
    expect(m.mrr).toBeCloseTo(0.75, 10);
    expect(m.contextPrecision).toBeCloseTo((1 / 3 + 1 / 3) / 2, 10);
  });
});

describe('ratchet', () => {
  it('passes when no metric regresses below baseline', () => {
    const res = checkRatchet(
      { recallAt5: 0.9, mrr: 0.8, contextPrecision: 0.4 },
      { recallAt5: 0.85, mrr: 0.7, contextPrecision: 0.4 },
    );
    expect(res.passed).toBe(true);
    expect(res.failures).toEqual([]);
  });

  it('fails and names the regressed metric', () => {
    const res = checkRatchet(
      { recallAt5: 0.6, mrr: 0.8, contextPrecision: 0.4 },
      { recallAt5: 0.85, mrr: 0.7, contextPrecision: 0.4 },
    );
    expect(res.passed).toBe(false);
    expect(res.failures.join(' ')).toMatch(/recallAt5/);
  });

  it('flags a metric the current run is missing', () => {
    const res = checkRatchet(
      { recallAt5: 0.9, mrr: 0.8, contextPrecision: 0.4 },
      { recallAt5: 0.85, faithfulness: 0.9 },
    );
    expect(res.passed).toBe(false);
    expect(res.failures.join(' ')).toMatch(/faithfulness/);
  });
});

describe('thresholds', () => {
  it('passes when measured metrics meet thresholds', () => {
    const res = checkThresholds(
      { recallAt5: 0.9, mrr: 0.75, contextPrecision: 0.4 },
      { recallAt5: 0.85, mrr: 0.7 },
    );
    expect(res.passed).toBe(true);
  });

  it('skips unmeasured metrics (e.g. faithfulness without a judge)', () => {
    const res = checkThresholds(
      { recallAt5: 0.9, mrr: 0.75, contextPrecision: 0.4 },
      { recallAt5: 0.85, faithfulness: 0.9 },
    );
    expect(res.passed).toBe(true);
  });

  it('fails when a measured metric is below threshold', () => {
    const res = checkThresholds({ recallAt5: 0.5, mrr: 0.4, contextPrecision: 0.2 }, { mrr: 0.7 });
    expect(res.passed).toBe(false);
    expect(res.failures.join(' ')).toMatch(/mrr/);
  });
});

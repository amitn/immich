import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark } from 'test/fixtures/orientation/benchmark.js';

/**
 * The orientation detection on 37 real photos turned synthetically (see `test/fixtures/orientation/benchmark.ts`): 111
 * rotated cases to fix and 37 upright ones to leave alone. ORIENTATION_BENCHMARK_VERBOSE=1 prints every case.
 */
const fixture = loadFixture();

describe('orientation benchmark', () => {
  it('should find most rotated photos, never turn them the wrong way and leave upright photos alone', async () => {
    const result = await runBenchmark(fixture);
    process.stdout.write(`${formatReport(result, !!process.env.ORIENTATION_BENCHMARK_VERBOSE)}\n`);

    expect(result.rotated.photos).toBe(111);
    expect(result.upright.photos).toBe(37);
    // just below what the detection reaches (96/111): the photos of Sicily are nearly all found, the dishes seen from
    // above less often, as they look much the same every way
    expect(result.rotated.correct).toBeGreaterThanOrEqual(94);
    expect(result.byKind.sicily.correct).toBeGreaterThanOrEqual(56);
    expect(result.byKind.food.correct).toBeGreaterThanOrEqual(37);
    // a photo it turns is turned the right way, and upright photos are left alone
    expect(result.rotated.wrong).toBe(0);
    expect(result.upright.flagged).toBe(0);
    // the requests stay bounded: most upright photos need none beyond their stored embedding
    expect(result.upright.requests / result.upright.photos).toBeLessThan(1.5);
    expect(Math.max(...result.outcomes.map(({ result: detection }) => detection.requests))).toBeLessThanOrEqual(5);
  });
});

import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/food/benchmark.js';

/**
 * The food utilities on real meals (see `test/fixtures/food/benchmark.ts`): three restaurant visits, a tasting menu
 * read in two photos (The French Laundry), a tasting menu with a juice pairing on a warped page (Noma Australia) and
 * a crowded menu board (Katz's Delicatessen). The text embeddings of the menu items are cached by prompt: when the
 * menu reading changes, run the spec once with FOOD_BENCHMARK_ML=http://<machine learning server> to update them.
 * FOOD_BENCHMARK_VERBOSE=1 prints every match.
 */
const fixture = loadFixture();

/** the scores to keep: items read, dishes matched, and matches marked sure that are wrong */
const MINIMUM = {
  'french-laundry-2014-01-11': { items: 7, dishes: 9 },
  'katzs-delicatessen-2013-06-15': { items: 2, dishes: 2 },
  'noma-australia-2016-03-24': { items: 12, dishes: 7 },
} as Record<string, { items: number; dishes: number }>;

describe('food benchmark', () => {
  it('should have the text embeddings of the menu items', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.FOOD_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.FOOD_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with FOOD_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the menus and match the dishes of real meals', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.FOOD_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      expect(result.recovered, `${result.key}: menu items read`).toBeGreaterThanOrEqual(MINIMUM[result.key].items);
      expect(result.correct, `${result.key}: dishes matched`).toBeGreaterThanOrEqual(MINIMUM[result.key].dishes);
    }
    expect(results.map(({ key, ordered }) => [key, ordered])).toEqual([
      ['french-laundry-2014-01-11', true],
      ['katzs-delicatessen-2013-06-15', false],
      ['noma-australia-2016-03-24', true],
    ]);
    // what the matcher gets wrong, it has to say it is unsure of
    expect(results.reduce((sum, result) => sum + result.sureWrong, 0)).toBeLessThanOrEqual(3);
  });
});

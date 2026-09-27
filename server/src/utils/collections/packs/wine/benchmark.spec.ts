import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/wine/benchmark.js';

/**
 * The wine pack on real tastings (see `test/fixtures/wine/benchmark.ts`): a Thanksgiving tasting of seventeen bottles,
 * each photographed once beside its glass on a white tablecloth (iPhone 4, script labels at an angle); a Mosel trip,
 * with three bottles on the counter of a winery's tasting room, its sign, and nine German bottles photographed one by
 * one at home five weeks later; and the drinks of a lunch at Noma Australia, whose dishes the Food pack named. OCR
 * reads labels in fragments, so the scores are modest: what matters is that what is read is right, that a name the
 * label contradicts is never sure, and that the assistant gets the crops to read the rest. The text embeddings are
 * cached by prompt: when the prompts change, run the spec once with WINE_BENCHMARK_ML=http://<machine learning
 * server> to update them. WINE_BENCHMARK_VERBOSE=1 prints every bottle.
 */
const fixture = loadFixture();

type Minimum = {
  bottles: number;
  producer: number;
  wine: number;
  vintage: number;
  sameBottle: number;
  sameTasting: number;
};

/**
 * the scores to keep, just below what the pack achieves: bottle photos found, the fields of the names match_subjects
 * gives the bottles (of 17, 17 and 15 labelled on the Thanksgiving bottles; 10, 11 and 10 on the Mosel ones; 1, 3 and
 * none on the Noma drinks), and the pairs of photos of one bottle and of one tasting put together
 */
const MINIMUM: Record<string, Minimum> = {
  'thanksgiving-tasting-2013-11-28': {
    bottles: 16,
    producer: 13,
    wine: 8,
    vintage: 11,
    sameBottle: 0,
    sameTasting: 130,
  },
  'mosel-wine-trip-2010-08-20': { bottles: 11, producer: 5, wine: 9, vintage: 8, sameBottle: 0, sameTasting: 36 },
  'noma-australia-2016-03-24': { bottles: 3, producer: 1, wine: 1, vintage: 0, sameBottle: 1, sameTasting: 3 },
};

describe('wine benchmark', () => {
  it('should have the text embeddings of the prompts', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.WINE_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.WINE_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with WINE_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the labels, group the bottles and the tastings of real tastings', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.WINE_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.classification.bottlesFound, `${result.key}: bottles found`).toBeGreaterThanOrEqual(
        minimum.bottles,
      );
      expect(result.classification.othersAsBottles, `${result.key}: cellars and vineyards taken for bottles`).toBe(0);
      expect(result.classification.signsFound, `${result.key}: signs`).toBe(result.classification.signs);
      expect(result.named.producer.read, `${result.key}: producers read`).toBeGreaterThanOrEqual(minimum.producer);
      expect(result.named.wine.read, `${result.key}: wines read`).toBeGreaterThanOrEqual(minimum.wine);
      expect(result.named.vintage.read, `${result.key}: vintages read`).toBeGreaterThanOrEqual(minimum.vintage);
      expect(result.sameBottle.found, `${result.key}: photos of one bottle`).toBeGreaterThanOrEqual(minimum.sameBottle);
      expect(result.sameTasting.found, `${result.key}: photos of one tasting`).toBeGreaterThanOrEqual(
        minimum.sameTasting,
      );
      // two bottles are never one, and two tastings never one
      expect(result.sameBottle.wrong, `${result.key}: bottles put together`).toBe(0);
      expect(result.sameTasting.wrong, `${result.key}: tastings put together`).toBe(0);
    }
    // what the label contradicts is never sure
    expect(results.reduce((sum, result) => sum + result.sureWrong, 0)).toBe(0);
    // the tastings are named by the winery's sign, and the drinks at Noma by the Food meal of the same lunch
    expect(results.map(({ places }) => places)).toEqual([
      ['(fallback)'],
      ['Max Ferd. Richter (sign)', '(fallback)', '(fallback)'],
      ['Noma Australia (tag)', 'Noma Australia (tag)'],
    ]);
  });
});

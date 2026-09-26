import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/cookbook/benchmark.js';

/**
 * The cookbook pack on real cooking sessions (see `test/fixtures/cookbook/benchmark.ts`): a quiche from a printed
 * cookbook page photographed steeply across the table the morning after (a spinach quiche beside it), a farmer's
 * casserole from a spiral-bound cookbook in warm light (the end of a soufflé beside it, the next page cut off), and
 * simple cupcakes from a page in shallow focus with a buttercream frosting as a sub-recipe (a chocolate cake and
 * cookies of the same party among the photos). The text embeddings are cached by prompt: when the prompts or the
 * recipe reading change, run the spec once with COOKBOOK_BENCHMARK_ML=http://<machine learning server> to update them.
 * COOKBOOK_BENCHMARK_VERBOSE=1 prints every match.
 */
const fixture = loadFixture();

/** the scores to keep, just below what the pack achieves */
const MINIMUM: Record<string, { ingredients: number; quantities: number; steps: number; photos: number }> = {
  'quiche-2006-11-15': { ingredients: 9, quantities: 8, steps: 1, photos: 8 },
  'farmers-casserole-2006-12-22': { ingredients: 8, quantities: 4, steps: 1, photos: 5 },
  'simple-cupcakes-2008-04-05': { ingredients: 12, quantities: 12, steps: 5, photos: 5 },
};

describe('cookbook benchmark', () => {
  it('should have the text embeddings of the prompts and steps', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.COOKBOOK_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.COOKBOOK_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with COOKBOOK_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the recipes and match the photos of real cooking sessions', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.COOKBOOK_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.titleOk, `${result.key}: title`).toBe(true);
      expect(result.ingredients.found, `${result.key}: ingredients read`).toBeGreaterThanOrEqual(minimum.ingredients);
      expect(result.ingredients.quantities, `${result.key}: quantities read`).toBeGreaterThanOrEqual(
        minimum.quantities,
      );
      expect(result.steps.found, `${result.key}: legible steps read`).toBeGreaterThanOrEqual(minimum.steps);
      expect(result.correct, `${result.key}: photos matched`).toBeGreaterThanOrEqual(minimum.photos);
      // the recipe is the source, and no photo of the cooking is taken for one by the labels of the oven
      expect(result.classification.recipeSource, `${result.key}: the recipe is a source`).toBe(true);
      expect(result.classification.stepsAsSource, `${result.key}: photos taken for sources`).toBe(0);
    }
    // find_visits names the recipes from the stored OCR, except the casserole, whose title OCR read in one box with
    // the soufflé beside it (read_source reads it at full resolution)
    expect(results.map(({ place }) => place)).toEqual(['Quiche', undefined, 'Simple Cupcakes']);
    // what the matcher gets wrong, it has to say it is unsure of
    expect(results.reduce((sum, result) => sum + result.sureWrong, 0)).toBeLessThanOrEqual(1);
    // the neighbouring recipe is kept apart: the quiche is not mixed with the spinach quiche beside it
    expect(results.map(({ key, chosen }) => [key, chosen])).toEqual([
      ['quiche-2006-11-15', 'Quiche'],
      ['farmers-casserole-2006-12-22', "Farmer's Casserole"],
      ['simple-cupcakes-2008-04-05', 'Simple Cupcakes'],
    ]);
  });
});

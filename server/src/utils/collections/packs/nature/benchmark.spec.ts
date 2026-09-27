import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/nature/benchmark.js';

/**
 * The nature pack on real garden walks (see `test/fixtures/nature/benchmark.ts`): Kahanu Garden, Hāna (engraved
 * accession tags held up beside their trees, photographed before or after them, a species labelled on two trees, a
 * tag without its tree, and trees without a tag) and the rose border of Copped Hall (chalk labels of cultivars a few
 * seconds after each rose, a tilted label OCR reads nothing on, and poppies, irises and a rock rose without a label).
 * The text embeddings of the prompts and the species are cached by text: when the reading changes, run the spec once
 * with NATURE_BENCHMARK_ML=http://<machine learning server> to update them. NATURE_BENCHMARK_VERBOSE=1 prints every
 * pairing.
 */
const fixture = loadFixture();

/**
 * the scores to keep, just below what the pack reaches: plant photos paired with their label (or with none when no
 * label was photographed), plants without a label left off the list, the names read on the labels, photos classified
 */
const MINIMUM = {
  'kahanu-garden-hana-2012-06-06': {
    paired: 12,
    offList: 3,
    scientific: 8,
    common: 3,
    family: 7,
    cultivar: 0,
    classified: 27,
  },
  'copped-hall-roses-2025-06-01': {
    paired: 11,
    offList: 3,
    scientific: 7,
    common: 7,
    family: 0,
    cultivar: 7,
    classified: 22,
  },
} as Record<
  string,
  {
    paired: number;
    offList: number;
    scientific: number;
    common: number;
    family: number;
    cultivar: number;
    classified: number;
  }
>;

describe('nature benchmark', () => {
  it('should have the text embeddings of the prompts and the species', async () => {
    const { used, missing } = runBenchmark(fixture);
    if (process.env.NATURE_BENCHMARK_ML) {
      await updateTexts(fixture, used, process.env.NATURE_BENCHMARK_ML);
      return;
    }
    expect([...missing], 'run the spec with NATURE_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the labels and pair the plants of real garden walks', () => {
    const { results } = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.NATURE_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.paired, `${result.key}: plants paired`).toBeGreaterThanOrEqual(minimum.paired);
      expect(result.offList.kept, `${result.key}: plants without a label`).toBeGreaterThanOrEqual(minimum.offList);
      expect(result.scientific.read, `${result.key}: scientific names`).toBeGreaterThanOrEqual(minimum.scientific);
      expect(result.common.read, `${result.key}: common names`).toBeGreaterThanOrEqual(minimum.common);
      expect(result.family.read, `${result.key}: families`).toBeGreaterThanOrEqual(minimum.family);
      expect(result.cultivar.read, `${result.key}: cultivars`).toBeGreaterThanOrEqual(minimum.cultivar);
      expect(result.classified.correct, `${result.key}: photos classified`).toBeGreaterThanOrEqual(minimum.classified);
    }
    // what the matcher gets wrong, it has to say it is unsure of
    expect(results.reduce((sum, result) => sum + result.sureWrong, 0)).toBeLessThanOrEqual(1);
    // the code of the garden on its accession tags; the chalk labels of the rose border name no garden
    expect(results.map(({ place }) => place?.name)).toEqual(['Kahanu', undefined]);
  });
});

import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/garden/benchmark.js';

/**
 * The garden pack on two real gardens (see `test/fixtures/garden/benchmark.ts`): four young peach trees photographed
 * over six rounds in four years, each with an embossed aluminium tag at its foot that OCR reads nothing on (0 of 12),
 * and a vegetable garden of lettuce beds with two seed packets, which read well. What matters is that the photos
 * follow the tag they were photographed after, that a plant nothing names stays unnamed rather than guessed, that the
 * varieties the assistant reads on the tags join each tree over the years, and that the growth stages told are right.
 * The owners themselves were unsure which tree was 'Tropic Snow' ("perhaps", "probably Sweet"): either name counts.
 * The text embeddings are cached by prompt: when the prompts change, run the spec once with
 * GARDEN_BENCHMARK_ML=http://<machine learning server> to update them. GARDEN_BENCHMARK_VERBOSE=1 prints every photo.
 */
const fixture = loadFixture();

type Minimum = {
  sources: number;
  plants: number;
  read: number;
  ocrNamed: number;
  assistedNamed: number;
  assistedPairs: number;
  stages: number;
  /** stages told wrong, at most */
  stageErrors: number;
};

/**
 * the scores to keep, just below what the pack achieves: tags and packets found (of 14, two photos the ground truth
 * calls flowering trees being tags, and 2), plant photos found (of 30 and 14), varieties read on the packets, plant photos named with the OCR alone and with the varieties the
 * assistant reads on the tags, pairs of photos of one plant put together with them, and growth stages told right
 */
const MINIMUM: Record<string, Minimum> = {
  'starr-hawea-pl-tropic-peaches-2013-2016': {
    sources: 14,
    plants: 29,
    read: 0,
    ocrNamed: 0,
    assistedNamed: 20,
    assistedPairs: 48,
    stages: 13,
    stageErrors: 0,
  },
  'starr-makawao-vegetables-2008': {
    sources: 2,
    plants: 12,
    read: 2,
    ocrNamed: 0,
    assistedNamed: 0,
    assistedPairs: 0,
    stages: 3,
    stageErrors: 1,
  },
};

describe('garden benchmark', () => {
  it('should have the text embeddings of the prompts', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.GARDEN_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.GARDEN_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with GARDEN_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should follow the plants of real gardens from their tags, over the years', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.GARDEN_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.classification.sourcesFound, `${result.key}: tags and packets`).toBeGreaterThanOrEqual(
        minimum.sources,
      );
      expect(result.classification.plantsFound, `${result.key}: plant photos`).toBeGreaterThanOrEqual(minimum.plants);
      expect(result.read.names.length, `${result.key}: varieties read`).toBeGreaterThanOrEqual(minimum.read);
      expect(result.ocr.named, `${result.key}: named from OCR`).toBeGreaterThanOrEqual(minimum.ocrNamed);
      expect(result.assisted.named, `${result.key}: named from the tags`).toBeGreaterThanOrEqual(minimum.assistedNamed);
      expect(result.assisted.samePlant.found, `${result.key}: one plant over the years`).toBeGreaterThanOrEqual(
        minimum.assistedPairs,
      );
      expect(result.stages.right, `${result.key}: stages`).toBeGreaterThanOrEqual(minimum.stages);
      expect(result.stages.wrong, `${result.key}: stages told wrong`).toBeLessThanOrEqual(minimum.stageErrors);
      // two plants are never one, with the OCR alone or with the tags read
      expect(result.ocr.samePlant.wrong + result.assisted.samePlant.wrong, `${result.key}: plants put together`).toBe(
        0,
      );
      // nothing named from OCR the photos contradict, and nothing sure that is wrong
      expect(result.ocr.wrong, `${result.key}: wrong names from OCR`).toBe(0);
      expect(result.ocr.sureWrong + result.assisted.sureWrong, `${result.key}: sure and wrong`).toBe(0);
    }
  });
});

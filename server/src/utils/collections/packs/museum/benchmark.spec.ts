import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/museum/benchmark.js';

/**
 * The museum pack on real visits (see `test/fixtures/museum/benchmark.ts`): the Museu de Évora (bilingual Portuguese
 * and English labels, three of them photographed before their artwork, a bust without a label), the Musée des
 * Beaux-Arts d'Agen (French cartels, an explanatory panel, a painting shown in two details, a case of four objects
 * under one label) and the Indian Museum, Kolkata (steel plaques in three scripts). The text embeddings of the prompts
 * and the artworks are cached by text: when the reading changes, run the spec once with
 * MUSEUM_BENCHMARK_ML=http://<machine learning server> to update them. MUSEUM_BENCHMARK_VERBOSE=1 prints every pairing.
 */
const fixture = loadFixture();

/** the scores to keep, just below what the pack reaches: artworks paired with their label, and fields read */
const MINIMUM = {
  'museu-de-evora-2025-08-28': { paired: 15, titles: 14, artists: 13, dates: 14, classified: 30 },
  'musee-des-beaux-arts-agen-2018-07-25': { paired: 9, titles: 8, artists: 8, dates: 7, classified: 18 },
  'indian-museum-kolkata-2022-09-27': { paired: 12, titles: 12, artists: 0, dates: 12, classified: 26 },
} as Record<string, { paired: number; titles: number; artists: number; dates: number; classified: number }>;

describe('museum benchmark', () => {
  it('should have the text embeddings of the prompts and the artworks', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.MUSEUM_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.MUSEUM_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with MUSEUM_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the labels and pair the artworks of real museum visits', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.MUSEUM_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.paired, `${result.key}: artworks paired`).toBeGreaterThanOrEqual(minimum.paired);
      expect(result.titles, `${result.key}: titles read`).toBeGreaterThanOrEqual(minimum.titles);
      expect(result.artists.read, `${result.key}: artists read`).toBeGreaterThanOrEqual(minimum.artists);
      expect(result.dates.read, `${result.key}: dates read`).toBeGreaterThanOrEqual(minimum.dates);
      expect(result.classified.correct, `${result.key}: photos classified`).toBeGreaterThanOrEqual(minimum.classified);
    }
    // what the matcher gets wrong, it has to say it is unsure of
    expect(results.reduce((sum, result) => sum + result.sureWrong, 0)).toBeLessThanOrEqual(1);
    // the museum is named on a label in Agen; the artists repeated on the labels of Évora are not museums
    expect(results.map(({ museum }) => museum?.name)).toEqual([undefined, 'Musée des Beaux-Arts, Agen', undefined]);
    // every label was paired with an artwork, bar a case of four objects of which one was photographed
    expect(results.flatMap(({ unmatched }) => unmatched)).toEqual([]);
  });
});

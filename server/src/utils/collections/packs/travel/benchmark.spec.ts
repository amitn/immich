import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/travel/benchmark.js';

/**
 * The travel pack on two real trips (see `test/fixtures/travel/benchmark.ts`): Western Crete in October 2016 (four
 * Greek documents: two KTEL bus tickets, a Samaria National Park ticket and an Anendyk ferry ticket with a time
 * written over by hand) and Okinawa in November 2019 (two boarding passes, an Okinawa World ticket, a monorail fare
 * receipt and two monorail tickets whose date OCR does not read). The CLIP text embeddings of the prompts and the legs
 * are cached: when they change, run the spec once with TRAVEL_BENCHMARK_ML=http://<machine learning server> to update
 * them. TRAVEL_BENCHMARK_VERBOSE=1 prints every photo.
 */
const fixture = loadFixture();

/** the scores to keep: fields of the documents read right, and photos on their leg; leaks are always none */
const MINIMUM = {
  'crete-samaria-2016-10': { fields: 19, photos: 21 },
  'okinawa-2019-11': { fields: 29, photos: 21 },
} as Record<string, { fields: number; photos: number }>;

describe('travel benchmark', () => {
  it('should have the text embeddings of the prompts and the legs', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.TRAVEL_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.TRAVEL_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with TRAVEL_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the legs of real trips, assign their photos, and let out no personal field', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.TRAVEL_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      expect(result.leaks, `${result.key}: personal fields let out`).toEqual([]);
      expect(result.fieldsRight, `${result.key}: fields read`).toBeGreaterThanOrEqual(MINIMUM[result.key].fields);
      expect(result.assigned, `${result.key}: photos on their leg`).toBeGreaterThanOrEqual(MINIMUM[result.key].photos);
      // documents are sources and every other photo of the trip a subject
      expect(result.classified.documentsRight, `${result.key}: documents`).toBe(result.classified.documents);
      expect(result.classified.photosRight, `${result.key}: trip photos`).toBe(result.classified.photos);
    }
  });
});

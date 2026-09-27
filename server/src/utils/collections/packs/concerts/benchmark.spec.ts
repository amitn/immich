import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/concerts/benchmark.js';

/**
 * The concerts pack on real gigs (see `test/fixtures/concerts/benchmark.ts`): Primavera Sound 2019 (a stage banner
 * with the line-up of the week photographed on Thursday, an LED board of stage times on Saturday, and acts of other
 * stages that neither lists), and two club gigs at Neumos, Seattle (a handwritten setlist that names both acts and a
 * setlist of songs only; a typed setlist, and an opener that none names). The text embeddings of the prompts and the
 * acts are cached by text: when the reading changes, run the spec once with CONCERTS_BENCHMARK_ML=http://<machine
 * learning server> to update them. CONCERTS_BENCHMARK_VERBOSE=1 prints every match.
 */
const fixture = loadFixture();

/**
 * the scores to keep, just below what the pack reaches: stage photos matched with the act on stage (or left off the
 * list), acts of no source left off, acts and songs read on the sources, photos classified, and source pages typeset
 */
const MINIMUM = {
  'primavera-sound-2019': { matched: 11, offList: 4, acts: 5, songs: 0, classified: 16, pages: 2 },
  'neumos-seattle-2023-02-17': { matched: 7, offList: 0, acts: 2, songs: 21, classified: 8, pages: 2 },
  'neumos-seattle-2019-03-07': { matched: 7, offList: 2, acts: 1, songs: 17, classified: 8, pages: 1 },
} as Record<
  string,
  { matched: number; offList: number; acts: number; songs: number; classified: number; pages: number }
>;

describe('concerts benchmark', () => {
  it('should have the text embeddings of the prompts and the acts', async () => {
    const { used, missing } = runBenchmark(fixture);
    if (process.env.CONCERTS_BENCHMARK_ML) {
      await updateTexts(fixture, used, process.env.CONCERTS_BENCHMARK_ML);
      return;
    }
    expect([...missing], 'run the spec with CONCERTS_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the sources and match the stage photos of real gigs', () => {
    const { results } = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.CONCERTS_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.matched, `${result.key}: stage photos matched`).toBeGreaterThanOrEqual(minimum.matched);
      expect(result.offList.kept, `${result.key}: acts on no source`).toBeGreaterThanOrEqual(minimum.offList);
      expect(result.acts.read, `${result.key}: acts read`).toBeGreaterThanOrEqual(minimum.acts);
      expect(result.songs.read, `${result.key}: songs read`).toBeGreaterThanOrEqual(minimum.songs);
      expect(result.classified.correct, `${result.key}: photos classified`).toBeGreaterThanOrEqual(minimum.classified);
      expect(result.pages, `${result.key}: setlist and line-up pages`).toBeGreaterThanOrEqual(minimum.pages);
    }
    // what the matcher gets wrong, it has to say it is unsure of: the festival photos of several acts on stage at once
    expect(results.reduce((sum, result) => sum + result.sureWrong, 0)).toBeLessThanOrEqual(1);
    // no venue is legible on these sources: the festival's name is a logo, and the venue on the setlist is cut off
    expect(results.map(({ place }) => place?.name)).toEqual([undefined, undefined, undefined]);
  });
});

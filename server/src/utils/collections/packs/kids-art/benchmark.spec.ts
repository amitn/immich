import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/kids-art/benchmark.js';

/**
 * The kids' art pack on four real family archives (see `test/fixtures/kids-art/benchmark.ts`): three illustrated
 * letters of 1947-1949 (scans, two of them of two pages), a girl's drawings photographed by her grandmother, a
 * Russian schoolgirl's drawings (scans, Cyrillic writing), and ten years of two sisters' artworks photographed by their
 * father. OCR reads children's writing in fragments and no Cyrillic or Japanese, so the assistant's eyes do most of
 * the work: what matters is that the pages of a letter are one artwork, that no two artworks or two children's years
 * are put together, that what cannot be read is never named surely, and that no surname gets out. The text
 * embeddings are cached by prompt: when the prompts change, run the spec once with
 * KIDS_ART_BENCHMARK_ML=http://<machine learning server> to update them. KIDS_ART_BENCHMARK_VERBOSE=1 prints every
 * artwork.
 */
const fixture = loadFixture();

type Minimum = { found: number; sameWork: number; sameYear: number; named: number; years: number };

/**
 * the scores to keep, just below what the pack achieves: artworks found, pages of one artwork put together (the two
 * letters of two pages), pairs of artworks of one child and year in one visit (by the capture dates of photos; scans
 * have none), artworks named from what is written on them, and years read
 */
const MINIMUM: Record<string, Minimum> = {
  'letters-1947-1949': { found: 5, sameWork: 2, sameYear: 0, named: 1, years: 1 },
  'drawings-2022-2025': { found: 5, sameWork: 0, sameYear: 3, named: 0, years: 0 },
  'school-drawings-2023': { found: 5, sameWork: 0, sameYear: 0, named: 0, years: 0 },
  'family-archive-2011-2021': { found: 8, sameWork: 0, sameYear: 3, named: 0, years: 0 },
};

describe('kids art benchmark', () => {
  it('should have the text embeddings of the prompts', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.KIDS_ART_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.KIDS_ART_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with KIDS_ART_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should find the artworks, put the pages of a letter together and keep the names of the children to themselves', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.KIDS_ART_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.classification.found, `${result.key}: artworks found`).toBeGreaterThanOrEqual(minimum.found);
      expect(result.sameWork.found, `${result.key}: pages of one artwork`).toBeGreaterThanOrEqual(minimum.sameWork);
      expect(result.sameYear.found, `${result.key}: one child's year`).toBeGreaterThanOrEqual(minimum.sameYear);
      expect(result.named, `${result.key}: artworks named`).toBeGreaterThanOrEqual(minimum.named);
      expect(result.years.read, `${result.key}: years read`).toBeGreaterThanOrEqual(minimum.years);
      // two artworks are never one, and two children's years never one
      expect(result.sameWork.wrong, `${result.key}: artworks put together`).toBe(0);
      expect(result.sameYear.wrong, `${result.key}: years put together`).toBe(0);
      // what cannot be read is never sure, and what is sure is right
      expect(result.unreadable.sure, `${result.key}: unreadable artworks named surely`).toBe(0);
      expect(result.sureWrong, `${result.key}: sure names the artwork contradicts`).toBe(0);
      // no surname gets out, and the photos are artworks only
      expect(result.leaks, `${result.key}: surnames let out`).toEqual([]);
      expect(result.faces, `${result.key}: faces`).toBe(0);
    }
    // a year of artworks per calendar year of the photos; scans have the year they were imported
    expect(results.map(({ places }) => places)).toEqual([
      ["Kids' art 2026"],
      ["Kids' art 2022", "Kids' art 2025"],
      ["Kids' art 2023", "Kids' art 2026"],
      ["Kids' art 2011", "Kids' art 2016", "Kids' art 2017", "Kids' art 2020", "Kids' art 2021"],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { formatReport, loadFixture, runBenchmark, updateTexts } from 'test/fixtures/reading/benchmark.js';

/**
 * The reading pack on real books (see `test/fixtures/reading/benchmark.ts`): sixteen title pages and covers of old
 * German books photographed by a Wikipedia editor over five years (1829-1929 editions, half of them in Fraktur, with
 * library stamps), and four Western novels and a songbook open at a page in a case of the Harry Ransom Center, whose
 * building was photographed on the way in. OCR reads roman type well and Fraktur as other letters, so what matters is
 * that what is read is right, that a Fraktur page is never sure, that the cover and the title page of one book are
 * one book, and that the open songbook gets no sure name. The text embeddings are cached by prompt: when the prompts
 * change, run the spec once with READING_BENCHMARK_ML=http://<machine learning server> to update them.
 * READING_BENCHMARK_VERBOSE=1 prints every photo.
 */
const fixture = loadFixture();

type Minimum = { books: number; title: number; author: number; year: number; sameBook: number };

/**
 * the scores to keep, just below what the pack achieves: book photos found, and the titles and authors of the names
 * match_subjects gives them (of 16 on the German books, 5 of them in roman type; of 4 on the Westerns, whose songbook
 * has no title), the years read on the pages that print one, and the pairs of photos of one book put together
 */
const MINIMUM: Record<string, Minimum> = {
  'goesseln-library-books-2021-2026': { books: 16, title: 12, author: 13, year: 8, sameBook: 2 },
  'harry-ransom-center-2015-11-17': { books: 5, title: 3, author: 3, year: 0, sameBook: 0 },
};

describe('reading benchmark', () => {
  it('should have the text embeddings of the prompts', async () => {
    const results = runBenchmark(fixture);
    const missing = [...new Set(results.flatMap((result) => result.missing))];
    if (process.env.READING_BENCHMARK_ML) {
      await updateTexts(fixture, new Set(results.flatMap((result) => result.used)), process.env.READING_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with READING_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should read the covers and title pages, group the books and name the periods of real books', () => {
    const results = runBenchmark(fixture);
    process.stdout.write(`${formatReport(results, !!process.env.READING_BENCHMARK_VERBOSE)}\n`);

    for (const result of results) {
      const minimum = MINIMUM[result.key];
      expect(result.classification.booksFound, `${result.key}: books found`).toBeGreaterThanOrEqual(minimum.books);
      expect(result.classification.othersAsBooks, `${result.key}: venues taken for books`).toBe(0);
      expect(result.named.title.read, `${result.key}: titles`).toBeGreaterThanOrEqual(minimum.title);
      expect(result.named.author.read, `${result.key}: authors`).toBeGreaterThanOrEqual(minimum.author);
      expect(result.read.year.read, `${result.key}: years`).toBeGreaterThanOrEqual(minimum.year);
      expect(result.sameBook.found, `${result.key}: photos of one book`).toBeGreaterThanOrEqual(minimum.sameBook);
      // two books are never one
      expect(result.sameBook.wrong, `${result.key}: books put together`).toBe(0);
      // Fraktur and an open page are never sure
      expect(result.fraktur.sure, `${result.key}: Fraktur named surely`).toBe(0);
      expect(result.openPages.sure, `${result.key}: open pages named surely`).toBe(0);
    }
    // what the page contradicts is never sure
    expect(results.reduce((sum, result) => sum + result.sureWrong, 0)).toBe(0);
    // a period per year of the German books; the Westerns by the sign of the library, photographed on the way in
    expect(results.map(({ places }) => places)).toEqual([
      [
        'Reading 2021 (fallback)',
        'Reading 2022 (fallback)',
        'Reading 2023 (fallback)',
        'Reading 2024 (fallback)',
        'Reading 2025 (fallback)',
        'Reading 2026 (fallback)',
      ],
      ['Harry Ransom Center (sign)'],
    ]);
  });
});

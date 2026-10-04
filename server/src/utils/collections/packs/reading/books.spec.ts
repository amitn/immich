import { AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import { assignBooks, groupBooks, isSameBook, mergeReadings } from 'src/utils/collections/packs/reading/books.js';
import { BookReading, readBookPage } from 'src/utils/collections/packs/reading/title-page.js';

const box = (text: string, top: number, height = 0.03, score = 0.98) => {
  const width = Math.min(0.9, text.length * height * 0.5);
  const left = 0.5 - width / 2;
  return {
    x1: left,
    y1: top,
    x2: left + width,
    y2: top,
    x3: left + width,
    y3: top + height,
    x4: left,
    y4: top + height,
    text,
    textScore: score,
  };
};

const minute = 60_000;
const options: AssignOptions = { ...DEFAULT_MATCH_OPTIONS, baselines: [], suggestions: 3 };
const photo = (id: string, time: number, ocr: ReturnType<typeof box>[]) => ({
  id,
  time,
  embedding: new Float32Array(0),
  ocr,
});

const titlePage = [
  box('Festspiel', 0.11, 0.041),
  box('in deutschen Reimen', 0.17, 0.03),
  box('von', 0.23, 0.013),
  box('Gerhart Hauptmann', 0.26, 0.033),
  box('1913', 0.71, 0.026),
  box('S. Fischer, Verlag, Berlin', 0.76, 0.03),
];
const cover = [
  box('Festspiel', 0.07, 0.15),
  box('in deutschen Reimen', 0.2, 0.042),
  box('von', 0.24, 0.026),
  box('Gerhart Hauptmann', 0.26, 0.085),
];
const otherBook = [
  box('Satans Kinder', 0.2, 0.057),
  box('Roman', 0.33, 0.025),
  box('von', 0.39, 0.014),
  box('Stanislaw Przybyszewski', 0.44, 0.035),
  box('1897', 0.89, 0.023),
];
const sameAuthor = [
  box('Das Gericht', 0.07, 0.066),
  box('Roman von', 0.15, 0.028),
  box('Stanislaw Przybyszewski', 0.18, 0.04),
  box('1913', 0.86, 0.033),
];

describe('reading books', () => {
  it('should take the cover and the title page of one book for one book, and books of one author for two', () => {
    const [a, b, c, d] = [titlePage, cover, sameAuthor, otherBook].map((ocr) => readBookPage(ocr)!);
    expect(isSameBook(a, b)).toBe(true);
    expect(isSameBook(c, d)).toBe(false);
    const groups = groupBooks([
      { ...photo('title', 0, titlePage), reading: a },
      { ...photo('cover', 17_000, cover), reading: b },
      { ...photo('gericht', 5 * minute, sameAuthor), reading: c },
      { ...photo('satans', 7 * minute, otherBook), reading: d },
    ]);
    expect(groups.map((group) => group.map(({ id }) => id))).toEqual([['title', 'cover'], ['gericht'], ['satans']]);
  });

  it('should take each part of a book from the surest reading of it', () => {
    const merged = mergeReadings([readBookPage(titlePage)!, readBookPage(cover)!]);
    expect(merged).toMatchObject({
      title: 'Festspiel in deutschen Reimen',
      author: 'Gerhart Hauptmann',
      year: '1913',
      place: 'Berlin',
    });
  });

  it('should name each book "Title — Author", with its imprint as the description', () => {
    const { matches, entries } = assignBooks(
      [photo('title', 0, titlePage), photo('cover', 17_000, cover), photo('satans', 5 * minute, otherBook)],
      [],
      options,
    );
    expect(entries).toEqual([
      {
        name: 'Festspiel in deutschen Reimen — Gerhart Hauptmann',
        description: '1913 · S. Fischer, Verlag · Berlin',
        sourceId: 'title',
      },
      { name: 'Satans Kinder — Stanislaw Przybyszewski', description: 'Roman · 1897', sourceId: 'satans' },
    ]);
    expect(matches.map(({ ids, item, unsure }) => ({ ids, item, unsure }))).toEqual([
      { ids: ['title', 'cover'], item: 0, unsure: false },
      { ids: ['satans'], item: 1, unsure: false },
    ]);
  });

  it('should match the books with a reading list, and leave a page it cannot read unnamed', () => {
    const { matches, entries } = assignBooks(
      [photo('title', 0, titlePage), photo('blank', minute, [])],
      [{ name: 'Festspiel in deutschen Reimen — Gerhart Hauptmann' }, { name: 'Der Paria — Michael Beer' }],
      options,
    );
    expect(entries).toBeUndefined();
    expect(matches[0]).toMatchObject({ ids: ['title'], item: 0, score: 1, unsure: false });
    expect(matches[1]).toEqual({ ids: ['blank'], score: 0, unsure: true, suggestions: [] });
  });

  it('should never be sure of a book when no reading of it was', () => {
    const unsure: BookReading = { ...readBookPage(titlePage)!, sure: false };
    expect(mergeReadings([unsure, { ...unsure }])?.sure).toBe(false);
  });
});

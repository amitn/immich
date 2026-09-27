import { TASTING_NOTE_LAYOUT } from 'src/utils/book/layouts.js';
import { getCollectionTagRules, validateCollectionPack } from 'src/utils/collections/pack.js';
import { getBookCaption, isUnreadableBook, reviewReadingBook } from 'src/utils/collections/packs/reading/book.js';
import { scoreReadingText } from 'src/utils/collections/packs/reading/classify.js';
import { bookPrompt, readingPack } from 'src/utils/collections/packs/reading/pack.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import { getCollectionPack, getCollectionPacks } from 'src/utils/collections/registry.js';
import { getEntryTag, getSourceTag, parseCollectionTag } from 'src/utils/collections/tags.js';
import { getFallbackVisitNames, groupVisits, summarizeVisit } from 'src/utils/collections/visits.js';

const box = (text: string, left: number, top: number, height = 0.03, score = 0.98) => {
  const right = left + text.length * height * 0.45;
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: score };
};

const summary = { lines: 0, prices: 0, items: 0, receiptWords: 0, placeWord: false, largestText: 0 };

const at = (iso: string) => new Date(`${iso}Z`).getTime();

describe('reading pack', () => {
  it('should be registered, valid beside the other packs', () => {
    expect(getCollectionPack('reading')).toBe(readingPack);
    expect(validateCollectionPack(readingPack, getCollectionPacks())).toEqual([]);
    expect(readingPack.book.preset).toMatchObject({ id: 'reading', name: 'Reading journal' });
    expect(readingPack.book.theme).toMatchObject({ look: 'printed', noteHeading: 'Notes' });
    expect(readingPack.source.onSubjects).toBe(true);
    expect(readingPack.agent.instructions).toContain('pack "reading"');
  });

  it('should tag the books "Reading/<Year or place>/<Title — Author>" and a list "…/Reading list"', () => {
    const rules = getCollectionTagRules(readingPack);
    const tag = getEntryTag(rules, 'Reading 2022', 'Wanderungen in den Dolomiten — Paul Grohmann');
    expect(tag).toBe('Reading/Reading 2022/Wanderungen in den Dolomiten — Paul Grohmann');
    expect(parseCollectionTag(rules, tag)).toEqual({
      place: 'Reading 2022',
      kind: 'entry',
      entry: 'Wanderungen in den Dolomiten — Paul Grohmann',
    });
    expect(getSourceTag(rules, 'Harry Ransom Center')).toBe('Reading/Harry Ransom Center/Reading list');
    expect(readingPack.describe('Der Paria — Michael Beer', 'Reading 2024')).toBe('Der Paria — Michael Beer');
    expect(bookPrompt({ name: 'Der Paria — Michael Beer' })).toBe(
      'a photo of the cover of the book Der Paria by Michael Beer',
    );
  });

  it('should group the books of a calendar year into one reading period, whatever the gaps', () => {
    const photos = [
      { id: 'a', time: at('2021-09-15T18:19:58'), kind: 'subject' as const },
      { id: 'b', time: at('2021-10-21T16:32:30'), kind: 'subject' as const },
      { id: 'c', time: at('2022-07-09T15:08:06'), kind: 'subject' as const },
      { id: 'd', time: at('2022-11-24T18:47:34'), kind: 'subject' as const },
    ];
    const visits = groupVisits(photos, readingPack.visits.options);
    expect(visits.map((visit) => visit.map(({ id }) => id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const names = getFallbackVisitNames(
      visits.map((visit) => summarizeVisit(visit)),
      readingPack.place.fallbackName,
    );
    expect(names).toEqual(['Reading 2021', 'Reading 2022']);
  });

  it('should read the name of a library on its sign, but not the title of a page', () => {
    const [sign] = findPlaceNames(
      [
        {
          assetId: 'sign',
          kind: 'sign',
          ocr: [box('HARRY RANSOM', 0.31, 0.49, 0.024), box('CENTER', 0.33, 0.52, 0.025)],
        },
      ],
      readingPack.place,
    );
    expect(sign).toMatchObject({ name: 'Harry Ransom Center', source: 'sign' });
    expect(
      findPlaceNames(
        [{ assetId: 'list', kind: 'source', ocr: [box('WANDERUNGEN IN DEN DOLOMITEN', 0.2, 0.1, 0.05)] }],
        readingPack.place,
      ),
    ).toEqual([]);
  });

  it('should never take a title page for a reading list by its text', () => {
    expect(scoreReadingText({ ...summary, lines: 14, items: 1 }).source).toBe(0);
    expect(scoreReadingText({ ...summary, lines: 8, items: 6 }).source).toBeGreaterThan(0.5);
  });

  it('should set a journal page from the name, the date it was read and the note', () => {
    const time = new Date('2022-07-09T15:08:06Z').getTime();
    const book = 'Wanderungen in den Dolomiten — Paul Grohmann';
    expect(getBookCaption(book, { layout: TASTING_NOTE_LAYOUT, takenAt: time, description: book })).toBe(
      'Title: Wanderungen in den Dolomiten\nAuthor: Paul Grohmann\nRead: 9 July 2022',
    );
    expect(
      getBookCaption(book, {
        layout: TASTING_NOTE_LAYOUT,
        takenAt: time,
        description: 'The first climbs of the Marmolada.',
      }),
    ).toBe(
      'Title: Wanderungen in den Dolomiten\nAuthor: Paul Grohmann\nRead: 9 July 2022\n\nThe first climbs of the Marmolada.',
    );
    expect(getBookCaption(book, { layout: 'dish' })).toBe(book);
  });

  it('should report books without a readable name', () => {
    expect(isUnreadableBook('Untitled')).toBe(true);
    expect(isUnreadableBook('TTLTCLH — Dante')).toBe(true);
    expect(isUnreadableBook('Der Paria — Michael Beer')).toBe(false);
    const issues = reviewReadingBook({
      pages: [],
      photos: [],
      chapters: [
        {
          place: 'Reading 2021',
          placed: [
            { entry: 'Unknown', assetIds: ['a'] },
            { entry: 'Der Paria — Michael Beer', assetIds: ['b', 'c'] },
          ],
          available: [],
          pages: [3],
        },
      ],
    });
    expect(issues.map(({ severity, assetIds }) => ({ severity, assetIds }))).toEqual([
      { severity: 'medium', assetIds: ['a'] },
      { severity: 'low', assetIds: ['c'] },
    ]);
  });
});

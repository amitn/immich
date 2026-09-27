import { getCollectionTagRules, redactText, validateCollectionPack } from 'src/utils/collections/pack.js';
import { getArtworkCaption, reviewKidsArtBook } from 'src/utils/collections/packs/kids-art/book.js';
import { kidsArtPack } from 'src/utils/collections/packs/kids-art/pack.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import { getCollectionPack, getCollectionPacks } from 'src/utils/collections/registry.js';
import { getEntryTag, getSourceTag } from 'src/utils/collections/tags.js';
import { getFallbackVisitNames, groupVisits, summarizeVisit } from 'src/utils/collections/visits.js';

const at = (iso: string) => new Date(`${iso}Z`).getTime();

const box = (text: string, top: number, height = 0.05) => {
  const right = 0.1 + text.length * height * 0.45;
  return { x1: 0.1, y1: top, x2: right, y2: top, x3: right, y3: top + height, x4: 0.1, y4: top + height, text };
};

const photo = (id: string, faces = 0) => ({
  id,
  takenAt: 0,
  collection: { pack: 'kids-art', place: 'Hanako, 2017', kind: 'entry' as const, entry: 'Felt book (age 8)' },
  faces: Array.from({ length: faces }, () => ({ x: 0.4, y: 0.2, width: 0.1, height: 0.1 })),
});

describe("kids' art pack", () => {
  it('should be registered, valid beside the other packs, with a pack id of dashes', () => {
    expect(getCollectionPack('kids-art')).toBe(kidsArtPack);
    expect(validateCollectionPack(kidsArtPack, getCollectionPacks())).toEqual([]);
    expect(kidsArtPack.book.preset).toMatchObject({ id: 'kids-art', name: 'Refrigerator gallery' });
    expect(kidsArtPack.book.theme?.look).toBe('mounted');
    expect(kidsArtPack.privacy).toMatchObject({ location: false });
    expect(kidsArtPack.agent.instructions).toContain('pack "kids-art"');
  });

  it('should tag the artworks "Kids art/<Child or family, year>/<Title (age N)>", with first names only', () => {
    const rules = getCollectionTagRules(kidsArtPack);
    const place = redactText(kidsArtPack, 'Vera Petrova, 2023');
    expect(place).toBe('Vera, 2023');
    expect(getEntryTag(rules, place, redactText(kidsArtPack, 'Two foxes under green leaves (age 8)'))).toBe(
      'Kids art/Vera, 2023/Two foxes under green leaves (age 8)',
    );
    expect(getSourceTag(rules, 'The Tanaka family, 2011–2021')).toBe('Kids art/The Tanaka family, 2011–2021/Note');
    expect(kidsArtPack.describe('A card for Vera Petrova (age 9)', 'Vera, 2023')).toBe('A card for Vera (age 9)');
  });

  it('should group the artworks of a calendar year, and never read the name of a child as a place', () => {
    const visits = groupVisits(
      [
        { id: 'a', time: at('2020-07-06T21:50:37'), kind: 'subject' as const },
        { id: 'b', time: at('2020-11-21T14:39:43'), kind: 'subject' as const },
        { id: 'c', time: at('2021-02-07T22:46:28'), kind: 'subject' as const },
      ],
      kidsArtPack.visits.options,
    );
    expect(visits.map((visit) => visit.map(({ id }) => id))).toEqual([['a', 'b'], ['c']]);
    expect(
      getFallbackVisitNames(
        visits.map((visit) => summarizeVisit(visit)),
        kidsArtPack.place.fallbackName,
      ),
    ).toEqual(["Kids' art 2020", "Kids' art 2021"]);
    expect(
      findPlaceNames([{ assetId: 'note', kind: 'source', ocr: [box('HANAKO TANAKA', 0.1)] }], kidsArtPack.place),
    ).toEqual([]);
  });

  it('should caption an artwork like the label on its back', () => {
    expect(getArtworkCaption('Two foxes under green leaves (age 8)', { takenAt: at('2025-01-30T14:42:09') })).toBe(
      'Two foxes under green leaves\nage 8 · January 2025',
    );
    expect(getArtworkCaption('Buon Natale (1947)', { takenAt: at('2026-09-27T15:07:25') })).toBe('Buon Natale\n1947');
  });

  it('should warn about a face, a full name and a map in a book, privacy first', () => {
    const issues = reviewKidsArtBook({
      pages: [
        { layout: 'map', assets: [] },
        { layout: 'dish', caption: 'Drawn by Hanako Tanaka', assets: [{ assetId: 'b' }] },
      ],
      photos: [photo('a'), photo('b', 1)],
      chapters: [
        {
          place: 'Hanako, 2017',
          placed: [{ entry: 'Untitled', assetIds: ['c'] }],
          available: [],
          pages: [2],
        },
      ],
    });
    expect(issues.map(({ severity, type, pages, assetIds }) => ({ severity, type, pages, assetIds }))).toEqual([
      { severity: 'high', type: 'privacy', pages: [2], assetIds: ['b'] },
      { severity: 'high', type: 'privacy', pages: [2], assetIds: undefined },
      { severity: 'medium', type: 'privacy', pages: [1], assetIds: undefined },
      { severity: 'medium', type: 'missing-dish-name', pages: [2], assetIds: ['c'] },
    ]);
    expect(reviewKidsArtBook({ pages: [], photos: [photo('a')], chapters: [] })).toEqual([]);
  });
});

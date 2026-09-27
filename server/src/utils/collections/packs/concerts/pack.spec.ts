import { getCollectionTagRules, validateCollectionPack } from 'src/utils/collections/pack.js';
import { formatSetlistPage, getActChapterTitle } from 'src/utils/collections/packs/concerts/book.js';
import { concertsPack, formatConcertDay, getConcertFallbackName } from 'src/utils/collections/packs/concerts/pack.js';
import { cleanVenueLine } from 'src/utils/collections/packs/concerts/venue.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import { BUILT_IN_COLLECTION_PACKS } from 'src/utils/collections/registry.js';
import { findSourceLeaf, getEntryTag, getSourceTag, parseCollectionTag } from 'src/utils/collections/tags.js';

const box = (text: string, left: number, top: number, height = 0.03) => {
  const right = Math.min(1, left + text.length * height * 0.5);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.97 };
};

const lines = (texts: string[], { left = 0.15, top = 0.1, height = 0.03, gap = 0.015 } = {}) =>
  texts.map((text, index) => box(text, left, top + index * (height + gap), height));

describe('concerts pack', () => {
  it('should be a valid pack of its own', () => {
    expect(validateCollectionPack(concertsPack, BUILT_IN_COLLECTION_PACKS)).toEqual([]);
    expect(concertsPack.book.preset.id).toBe('concerts');
    expect(concertsPack.book.theme).toEqual(expect.objectContaining({ id: 'gig-poster', look: 'printed' }));
  });

  it('should tag setlists and line-ups as sources, and an act called like one as an act', () => {
    const rules = getCollectionTagRules(concertsPack);
    expect(getSourceTag(rules, 'Neumos, 17 Feb 2023')).toBe('Concerts/Neumos, 17 Feb 2023/Setlist');
    expect(getSourceTag(rules, 'Primavera Sound 2019', 'line-up')).toBe('Concerts/Primavera Sound 2019/Line-up');
    expect(parseCollectionTag(rules, 'Concerts/Primavera Sound 2019/Line-up')).toEqual({
      place: 'Primavera Sound 2019',
      kind: 'source',
    });
    expect(parseCollectionTag(rules, 'Concerts/Primavera Sound 2019/Kali Uchis')).toEqual({
      place: 'Primavera Sound 2019',
      kind: 'entry',
      entry: 'Kali Uchis',
    });
    expect(getEntryTag(rules, 'Neumos', 'Setlist')).toBe('Concerts/Neumos/Setlist (stage shot)');
    expect(findSourceLeaf(rules, ' LINE-UP ')).toBe('Line-up');
    expect(findSourceLeaf(rules, 'Kali Uchis')).toBeUndefined();
  });

  it('should name a gig without a venue by its city and day, and describe its photos', () => {
    expect(formatConcertDay('2019-03-07')).toBe('7 Mar 2019');
    expect(getConcertFallbackName({ day: '2019-03-07', start: '2019-03-07T21:29:31' })).toBe('Concert, 7 Mar 2019');
    expect(getConcertFallbackName({ city: 'Barcelona', day: '2019-06-01', start: '2019-06-01T19:47:03' })).toBe(
      'Concert in Barcelona, 1 Jun 2019',
    );
    expect(concertsPack.describe('Kali Uchis', 'Primavera Sound 2019')).toBe('Kali Uchis · Primavera Sound 2019');
    expect(getActChapterTitle('Kali Uchis', 'Primavera Sound 2019')).toBe('Kali Uchis · Primavera Sound 2019');
  });

  it('should read the venue of a setlist header, and no act or song as one', () => {
    expect(cleanVenueLine('SEATTLE WASHINGTON · NEUMOS')).toBe('NEUMOS');
    const ocr = lines([
      'SIDNEY GISH w/ THE BETHS',
      'FRIDAY FEB 17 2023',
      'SEATTLE WASHINGTON · NEUMOS',
      'STRFKR',
      'RAT',
    ]);
    const [place] = findPlaceNames([{ assetId: 'setlist', kind: 'source', ocr }], concertsPack.place);
    expect(place).toEqual(expect.objectContaining({ name: 'Neumos', source: 'source' }));
    expect(
      findPlaceNames([{ assetId: 'songs', kind: 'source', ocr: lines(['OHIO', 'TOLD YOU']) }], concertsPack.place),
    ).toEqual([]);
  });

  it('should typeset a setlist with what its header says, and its songs numbered', () => {
    const ocr = lines([
      'CHERRY GLAZERR - SEATTLE - MARCHT',
      'OHIO',
      'HAD TEN DOLLAZ',
      '---INTERLUDE',
      'DISTRESSOR',
      'TOLD YOU',
    ]);
    // the act titles the chapter the page opens
    expect(formatSetlistPage(ocr, { place: 'Neumos, 7 Mar 2019' })).toEqual({
      text: 'Setlist\nMarch 7 · Seattle\n\n1. Ohio\n2. Had Ten Dollaz\nInterlude\n3. Distressor\n4. Told You',
    });
  });

  it('should typeset a line-up by day, in the order of the night', () => {
    const ocr = [
      box('NIGHT PRO', 0.34, 0.25, 0.06),
      box('DISSABTE / SABADO / SATURDAY', 0.34, 0.4, 0.018),
      box('00:00 - F5', 0.34, 0.43, 0.018),
      box('19:30 - DTSQ', 0.34, 0.46, 0.018),
      box('20:30 - PHORO', 0.34, 0.49, 0.018),
    ];
    expect(formatSetlistPage(ocr, { place: 'Primavera Sound 2019' })).toEqual({
      text: 'Line-up\nNight Pro\n\nSaturday:\n19:30 DTSQ\n20:30 Phoro\n00:00 F5',
    });
    expect(formatSetlistPage(lines(['OHIO']), { place: 'Neumos' })).toBeUndefined();
  });

  it('should score the text of setlists and line-ups as sources', () => {
    const summary = { lines: 12, prices: 0, items: 2, receiptWords: 0, placeWord: false, largestText: 0.05 };
    expect(concertsPack.classify.scoreText!(summary).source).toBeGreaterThanOrEqual(0.8);
    expect(concertsPack.classify.scoreText!({ ...summary, items: 0 }).source).toBeLessThan(0.5);
    expect(concertsPack.classify.subjectTextFactor!(14)).toBe(1);
  });
});

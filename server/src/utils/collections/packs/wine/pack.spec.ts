import { describe, expect, it } from 'vitest';
import { getCollectionTagRules, validateCollectionPack } from 'src/utils/collections/pack.js';
import { scoreWineText } from 'src/utils/collections/packs/wine/classify.js';
import { winePack } from 'src/utils/collections/packs/wine/pack.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import { getCollectionPack, getCollectionPacks } from 'src/utils/collections/registry.js';
import { combineSourceOcr, getEntriesFocus } from 'src/utils/collections/source.js';
import { getEntryTag, getSourceTag, parseCollectionTag } from 'src/utils/collections/tags.js';
import { findLinkedPlace } from 'src/utils/collections/visits.js';

const box = (text: string, left: number, top: number, height = 0.03, score = 0.98) => {
  const right = left + text.length * height * 0.45;
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: score };
};

const summary = { lines: 0, prices: 0, items: 0, receiptWords: 0, placeWord: false, largestText: 0 };

describe('wine pack', () => {
  it('should be registered, valid beside the other packs', () => {
    expect(getCollectionPack('wine')).toBe(winePack);
    expect(validateCollectionPack(winePack, getCollectionPacks())).toEqual([]);
    expect(winePack.book.preset.id).toBe('wine');
    expect(winePack.book.theme?.look).toBe('printed');
    expect(winePack.agent.instructions).toContain('pack "wine"');
  });

  it('should tag the bottles "Wine/<Tasting>/<Producer · Wine · Vintage>" and the list "Wine/<Tasting>/Wine list"', () => {
    const rules = getCollectionTagRules(winePack);
    const tag = getEntryTag(
      rules,
      'Max Ferd. Richter',
      'Max Ferd. Richter · Wehlener Sonnenuhr Riesling Kabinett · 2009',
    );
    expect(tag).toBe('Wine/Max Ferd. Richter/Max Ferd. Richter · Wehlener Sonnenuhr Riesling Kabinett · 2009');
    expect(parseCollectionTag(rules, tag)).toEqual({
      place: 'Max Ferd. Richter',
      kind: 'entry',
      entry: 'Max Ferd. Richter · Wehlener Sonnenuhr Riesling Kabinett · 2009',
    });
    expect(getSourceTag(rules, 'Noma Australia')).toBe('Wine/Noma Australia/Wine list');
    expect(winePack.describe('Kudos · Pinot Noir · 2012', 'Thanksgiving tasting')).toBe('Kudos · Pinot Noir · 2012');
  });

  it('should take a list for a source by its text, never a label', () => {
    expect(scoreWineText({ ...summary, lines: 6, items: 1, largestText: 0.1 }).source).toBe(0);
    expect(scoreWineText({ ...summary, lines: 14, items: 10, prices: 8 }).source).toBeGreaterThan(0.8);
    // a label in large letters with "Winery" is a bottle before it is a sign
    expect(scoreWineText({ ...summary, lines: 2, placeWord: true, largestText: 0.12 }).sign).toBeLessThanOrEqual(0.5);
  });

  it('should read the name of a winery on its sign, but not a grape or a region', () => {
    const [sign] = findPlaceNames(
      [{ assetId: 'sign', kind: 'sign', ocr: [box('MAX FERD.RICHTER', 0.44, 0.34, 0.05)] }],
      winePack.place,
    );
    expect(sign).toMatchObject({ name: 'Max Ferd. Richter', source: 'sign' });
    expect(
      findPlaceNames([{ assetId: 'list', kind: 'source', ocr: [box('RIESLING', 0.3, 0.1, 0.05)] }], winePack.place),
    ).toEqual([]);
    expect(winePack.place.lookup?.filters).toEqual(
      expect.arrayContaining([
        { key: 'craft', values: ['winery', 'brewery'] },
        { key: 'shop', values: ['wine'] },
      ]),
    );
    expect(winePack.place.fallbackName({ day: '2013-11-28', start: '2013-11-28T12:02:45' })).toBe(
      'Tasting on 2013-11-28',
    );
  });

  it('should keep the words of a label only the stored OCR read', () => {
    const tiled = [box('CAIRDEAS', 0.47, 0.59, 0.136), box('NELLIE MAE', 0.58, 0.73, 0.038)];
    const stored = [
      box('CAIRDEAS', 0.47, 0.59, 0.13),
      // below the name, which the tiles missed
      box('WINERY', 0.55, 0.69, 0.02),
      box('NELLIE MAE', 0.58, 0.73, 0.036),
    ];
    expect(combineSourceOcr(stored, tiled).map(({ text }) => text)).toEqual(['CAIRDEAS', 'NELLIE MAE', 'WINERY']);
  });

  it('should zoom on where the label was read, with room around it', () => {
    expect(getEntriesFocus([{ box: [0.37, 0.68, 0.62, 0.9] }])).toEqual({
      x: 0.27,
      y: 0.592,
      width: 0.45,
      height: 0.396,
    });
    // a label read on the whole photo, or nothing read: no zoom
    expect(getEntriesFocus([{ box: [0, 0, 1, 1] }])).toBeUndefined();
    expect(getEntriesFocus([])).toBeUndefined();
  });

  it('should find the place another pack named at the time of a visit', () => {
    const HOUR = 60 * 60 * 1000;
    const photos = [
      { id: 'crab', time: 1.5 * HOUR, place: 'Noma Australia' },
      { id: 'menu', time: 5 * HOUR, place: 'Noma Australia' },
      { id: 'pastrami', time: 50 * HOUR, place: "Katz's Delicatessen" },
    ];
    expect(findLinkedPlace({ start: HOUR, end: 1.1 * HOUR }, photos)).toEqual({
      name: 'Noma Australia',
      assetIds: ['crab'],
    });
    expect(findLinkedPlace({ start: 20 * HOUR, end: 21 * HOUR }, photos)).toBeUndefined();
  });
});

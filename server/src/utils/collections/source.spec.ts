import { describe, expect, it } from 'vitest';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { chooseSourceOcr, mergeSourceEntries } from 'src/utils/collections/source.js';

/** an OCR box of `text` at (left, top), about as wide as the text in a font of `height` */
const box = (text: string, left: number, top: number, height = 0.022, width?: number): OcrBoxInput => {
  const right = left + (width ?? text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.95 };
};

describe('chooseSourceOcr', () => {
  it('should prefer the tiled reading unless it read much less text', () => {
    const stored = [box('Spaghetti alle vongole', 0.1, 0.1), box('Caponata', 0.1, 0.2)];
    const tiles = [box('Spaghetti alle vongole', 0.1, 0.1), box('Caponata siciliana', 0.1, 0.2)];
    expect(chooseSourceOcr(stored, tiles)).toBe('tiles');
    expect(chooseSourceOcr(stored, tiles.slice(1))).toBe('stored');
  });
});

const item = (name: string) => ({ name, column: 0, box: [0, 0, 1, 1] as [number, number, number, number] });

describe('mergeSourceEntries', () => {
  it('should list the items of the pages of a menu once, in order', () => {
    const merged = mergeSourceEntries([
      { assetId: 'a', items: [item('Oysters and Pearls'), item('Salad')] },
      { assetId: 'b', items: [item('"OYSTERS AND PEARLS"'), item('Salad'), item('Lamb')] },
    ]);
    expect(merged.map(({ sourceId, item }) => [sourceId, item.name])).toEqual([
      ['a', 'Oysters and Pearls'],
      ['a', 'Salad'],
      ['b', 'Lamb'],
    ]);
  });

  it('should give the items of the longest column their place in it', () => {
    const merged = mergeSourceEntries([
      { assetId: 'a', items: [item('Oysters and Pearls'), item('Salad'), item('Lamb')] },
      { assetId: 'b', items: [{ ...item('Juice'), column: 1 }] },
    ]);
    expect(merged.map(({ item, course }) => [item.name, course])).toEqual([
      ['Oysters and Pearls', 0],
      ['Salad', 1],
      ['Lamb', 2],
      ['Juice', undefined],
    ]);
  });
});

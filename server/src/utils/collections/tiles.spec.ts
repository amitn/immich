import { describe, expect, it } from 'vitest';
import { OcrOutput, getOcrTiles, mergeOcrPasses, stitchText } from 'src/utils/collections/tiles.js';

/** an OCR output with axis-aligned boxes given as [text, left, top, right, bottom] normalized to the pass */
const output = (...boxes: Array<[string, number, number, number, number]>): OcrOutput => ({
  text: boxes.map(([text]) => text),
  box: boxes.flatMap(([, left, top, right, bottom]) => [left, top, right, top, right, bottom, left, bottom]),
  boxScore: boxes.map(() => 0.9),
  textScore: boxes.map(() => 0.95),
});

describe('getOcrTiles', () => {
  it('should not tile a small photo', () => {
    expect(getOcrTiles(1440, 1080)).toEqual([]);
  });

  it('should cover a large photo with overlapping tiles', () => {
    const tiles = getOcrTiles(4104, 2736);
    expect(tiles).toHaveLength(6);
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(4104);
      expect(tile.y + tile.height).toBeLessThanOrEqual(2736);
    }
    // the tiles overlap
    expect(tiles[1].x).toBeLessThan(tiles[0].x + tiles[0].width);
    expect(tiles[3].y).toBeLessThan(tiles[0].y + tiles[0].height);
    // and reach the far corner
    expect(tiles.at(-1)!.x + tiles.at(-1)!.width).toBe(4104);
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(2736);
  });
});

describe('mergeOcrPasses', () => {
  const width = 2000;
  const height = 1000;
  const whole = { x: 0, y: 0, width, height };
  const left = { x: 0, y: 0, width: 1100, height };
  const right = { x: 900, y: 0, width: 1100, height };

  it('should map tile boxes onto the photo', () => {
    const [box] = mergeOcrPasses(width, height, [{ rect: right, output: output(['Cannolo', 0.5, 0.1, 0.8, 0.14]) }]);
    expect(box.x1).toBeCloseTo((900 + 0.5 * 1100) / 2000, 6);
    expect(box.x2).toBeCloseTo((900 + 0.8 * 1100) / 2000, 6);
    expect(box.y1).toBeCloseTo(0.1, 6);
    expect(box.text).toBe('Cannolo');
  });

  it('should prefer the tiles over the whole photo, and the whole photo over text cut by a tile edge', () => {
    const boxes = mergeOcrPasses(width, height, [
      {
        rect: whole,
        output: output(
          ['Spaghetti alle vongole 14,00', 0.4, 0.3, 0.6, 0.33],
          ['Caponata 8,00', 0.1, 0.5, 0.25, 0.53],
          ['KATZS', 0.1, 0.05, 0.3, 0.1],
        ),
      },
      {
        rect: left,
        output: output(
          // cut by the right edge of the tile
          ['Spaghetti alle vong', 0.72, 0.3, 1, 0.33],
          ['Caponata siciliana 8,00', 0.18, 0.5, 0.46, 0.53],
          ["KATZ'S", 0.18, 0.05, 0.55, 0.1],
        ),
      },
      { rect: right, output: output(['alle vongole 14,00', 0, 0.3, 0.2, 0.33]) },
    ]);

    expect(boxes.map(({ text }) => text)).toEqual([
      "KATZ'S",
      'Spaghetti alle vongole 14,00',
      'Caponata siciliana 8,00',
    ]);
  });

  it('should keep text only one pass read', () => {
    const boxes = mergeOcrPasses(width, height, [
      { rect: whole, output: output(['MENU', 0.4, 0.02, 0.6, 0.08]) },
      { rect: left, output: output(['Matzo Ball Soup 9,95', 0.2, 0.4, 0.5, 0.43]) },
      { rect: right, output: output(["Katz's Pastrami 26,95", 0.3, 0.4, 0.7, 0.43]) },
    ]);
    expect(boxes.map(({ text }) => text)).toEqual(['MENU', 'Matzo Ball Soup 9,95', "Katz's Pastrami 26,95"]);
  });

  it('should take a box that ends within a text height of a tile edge for cut text', () => {
    // detection boxes keep a margin: "alle vongole 14,00" starts 1% into the right tile, not at its edge
    const boxes = mergeOcrPasses(width, height, [
      { rect: whole, output: output(['Spaghetti alle vongole 14,00', 0.4, 0.3, 0.6, 0.33]) },
      { rect: right, output: output(['vongole 14,00', 0.012, 0.3, 0.2, 0.33]) },
    ]);
    expect(boxes.map(({ text }) => text)).toEqual(['Spaghetti alle vongole 14,00']);
  });

  it('should join text cut by the edges of two tiles where they read the same characters', () => {
    // no whole-photo reading of the line: the two cut pieces are joined
    const boxes = mergeOcrPasses(width, height, [
      { rect: left, output: output(['Abalone schnitz', 0.7, 0.5, 0.998, 0.52]) },
      { rect: right, output: output(['hnitzel and bush condiments', 0.002, 0.5, 0.35, 0.52]) },
    ]);
    expect(boxes.map(({ text }) => text)).toEqual(['Abalone schnitzel and bush condiments']);
    expect(boxes[0].x1).toBeCloseTo((0.7 * 1100) / 2000, 3);
    expect(boxes[0].x2).toBeCloseTo((900 + 0.35 * 1100) / 2000, 3);
  });
});

describe('stitchText', () => {
  it('should join two pieces of a line at the characters both read', () => {
    expect(stitchText('Abalone schnitz', 'hnitzel and bush', 0.35)).toBe('Abalone schnitzel and bush');
    // one character read differently
    expect(stitchText('Peanut milk and freekah "B', 'nd Ireekah "Baytime"', 0.4)).toBe(
      'Peanut milk and freekah "Baytime"',
    );
  });

  it('should not join pieces that disagree', () => {
    expect(stitchText('Spaghetti alle', 'Caponata siciliana', 0.3)).toBeUndefined();
  });
});

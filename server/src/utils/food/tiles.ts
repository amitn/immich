import { OcrBoxInput } from 'src/utils/food/ocr.js';

/** a rectangle of a photo in pixels */
export type PixelRect = { x: number; y: number; width: number; height: number };

/** OCR output as the machine learning service returns it: 8 coordinates per box, normalized to the image sent */
export type OcrOutput = { text: string[]; box: number[]; boxScore: number[]; textScore: number[] };

export type OcrPass = { rect: PixelRect; output: OcrOutput };

export const DEFAULT_TILE_SIZE = 1600;
export const DEFAULT_TILE_OVERLAP = 0.15;

/**
 * Overlapping tiles about `tileSize` pixels square that cover a photo, so that small print can be read at full
 * resolution; none for a photo that fits in one tile.
 */
export const getOcrTiles = (
  width: number,
  height: number,
  { tileSize = DEFAULT_TILE_SIZE, overlap = DEFAULT_TILE_OVERLAP }: { tileSize?: number; overlap?: number } = {},
): PixelRect[] => {
  const columns = Math.max(1, Math.round(width / tileSize));
  const rows = Math.max(1, Math.round(height / tileSize));
  if (columns * rows === 1) {
    return [];
  }

  const tileWidth = Math.min(width, Math.ceil((width / columns) * (1 + overlap)));
  const tileHeight = Math.min(height, Math.ceil((height / rows) * (1 + overlap)));
  const stepX = columns > 1 ? (width - tileWidth) / (columns - 1) : 0;
  const stepY = rows > 1 ? (height - tileHeight) / (rows - 1) : 0;

  const tiles: PixelRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push({
        x: Math.round(column * stepX),
        y: Math.round(row * stepY),
        width: tileWidth,
        height: tileHeight,
      });
    }
  }
  return tiles;
};

type Candidate = {
  box: OcrBoxInput;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** the box touches an edge of its tile that is inside the photo, so its text may be cut */
  clipped: boolean;
  /** pixels of the pass it comes from: smaller passes read at a higher resolution */
  area: number;
};

const EDGE = 0.004;

const area = (a: { left: number; top: number; right: number; bottom: number }) =>
  Math.max(0, a.right - a.left) * Math.max(0, a.bottom - a.top);

const intersection = (a: Candidate, b: Candidate) =>
  area({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });

/** whether two boxes are (mostly) the same text read twice */
const isDuplicate = (a: Candidate, b: Candidate) => {
  const overlap = intersection(a, b);
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 && overlap / smaller > 0.5;
};

/**
 * Joins OCR passes over tiles (and the whole photo) into one list of boxes normalized to the photo. Where passes
 * read the same text, the box read at the highest resolution wins, unless it was cut by the edge of its tile; then a
 * box that holds the whole text (from an overlapping tile or the whole photo) wins.
 */
export const mergeOcrPasses = (width: number, height: number, passes: OcrPass[]): OcrBoxInput[] => {
  const candidates: Candidate[] = [];
  for (const { rect, output } of passes) {
    const inner = {
      left: rect.x > 0,
      top: rect.y > 0,
      right: rect.x + rect.width < width,
      bottom: rect.y + rect.height < height,
    };
    for (const [index, text] of output.text.entries()) {
      const coordinates = output.box.slice(index * 8, index * 8 + 8);
      if (coordinates.length < 8 || !text?.trim()) {
        continue;
      }
      const xs = [coordinates[0], coordinates[2], coordinates[4], coordinates[6]];
      const ys = [coordinates[1], coordinates[3], coordinates[5], coordinates[7]];
      const clipped =
        (inner.left && Math.min(...xs) <= EDGE) ||
        (inner.right && Math.max(...xs) >= 1 - EDGE) ||
        (inner.top && Math.min(...ys) <= EDGE) ||
        (inner.bottom && Math.max(...ys) >= 1 - EDGE);
      const toX = (value: number) => (rect.x + value * rect.width) / width;
      const toY = (value: number) => (rect.y + value * rect.height) / height;
      const box: OcrBoxInput = {
        x1: toX(coordinates[0]),
        y1: toY(coordinates[1]),
        x2: toX(coordinates[2]),
        y2: toY(coordinates[3]),
        x3: toX(coordinates[4]),
        y3: toY(coordinates[5]),
        x4: toX(coordinates[6]),
        y4: toY(coordinates[7]),
        text,
        boxScore: output.boxScore[index] ?? 0,
        textScore: output.textScore[index] ?? 0,
      };
      candidates.push({
        box,
        left: Math.min(box.x1, box.x2, box.x3, box.x4),
        right: Math.max(box.x1, box.x2, box.x3, box.x4),
        top: Math.min(box.y1, box.y2, box.y3, box.y4),
        bottom: Math.max(box.y1, box.y2, box.y3, box.y4),
        clipped,
        area: rect.width * rect.height,
      });
    }
  }

  const ranked = candidates.toSorted(
    (a, b) =>
      Number(a.clipped) - Number(b.clipped) ||
      a.area - b.area ||
      b.box.text.length - a.box.text.length ||
      (b.box.textScore ?? 0) - (a.box.textScore ?? 0),
  );
  const kept: Candidate[] = [];
  for (const candidate of ranked) {
    if (kept.every((other) => !isDuplicate(other, candidate))) {
      kept.push(candidate);
    }
  }
  return kept.map(({ box }) => box).toSorted((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
};

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
  /** the box ends near an edge of its tile that is inside the photo, so its text may be cut there */
  clippedLeft: boolean;
  clippedRight: boolean;
  clippedVertically: boolean;
  clipped: boolean;
  /** pixels of the pass it comes from: smaller passes read at a higher resolution */
  area: number;
  pass: number;
};

/** a box this close to an inner edge of its tile, in text heights, may be cut: detection boxes have a margin */
const EDGE_HEIGHTS = 1.2;
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

/** edit distance of two strings */
export const editDistance = (a: string, b: string) => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
};

/**
 * Joins the text of a box cut by the right edge of its tile with the text of a box cut by the left edge of the next
 * tile, where the two read the same characters: "Abalone schnit" + "chnitzel and bush" → "Abalone schnitzel and bush".
 * The overlap is found in the text, around where the boxes overlap on the photo; undefined when the texts don't agree.
 */
export const stitchText = (left: string, right: string, overlapFraction: number) => {
  const expected = Math.round(overlapFraction * left.length);
  const min = Math.max(3, Math.floor(0.4 * expected));
  const max = Math.min(left.length, right.length, Math.ceil(1.6 * expected) + 3);
  let best: { length: number; cost: number } | undefined;
  for (let length = min; length <= max; length++) {
    const cost = editDistance(left.slice(-length).toLowerCase(), right.slice(0, length).toLowerCase()) / length;
    if (cost <= 0.25 && (!best || cost < best.cost || (cost === best.cost && length > best.length))) {
      best = { length, cost };
    }
  }
  return best ? `${left}${right.slice(best.length)}` : undefined;
};

const verticalOverlap = (a: Candidate, b: Candidate) => {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const shorter = Math.min(a.bottom - a.top, b.bottom - b.top);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
};

/** a box cut on its right side and a box of another pass cut on its left side, that read the same line */
const stitch = (a: Candidate, b: Candidate): Candidate | undefined => {
  if (
    a.pass === b.pass ||
    !a.clippedRight ||
    !b.clippedLeft ||
    a.left >= b.left ||
    a.right >= b.right ||
    b.left >= a.right ||
    verticalOverlap(a, b) < 0.5
  ) {
    return;
  }
  const text = stitchText(a.box.text, b.box.text, (a.right - b.left) / (a.right - a.left));
  if (!text) {
    return;
  }
  const box: OcrBoxInput = {
    x1: a.box.x1,
    y1: a.box.y1,
    x2: b.box.x2,
    y2: b.box.y2,
    x3: b.box.x3,
    y3: b.box.y3,
    x4: a.box.x4,
    y4: a.box.y4,
    text,
    boxScore: Math.min(a.box.boxScore ?? 0, b.box.boxScore ?? 0),
    textScore: Math.min(a.box.textScore ?? 0, b.box.textScore ?? 0),
  };
  return {
    box,
    left: a.left,
    right: b.right,
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
    clippedLeft: a.clippedLeft,
    clippedRight: b.clippedRight,
    clippedVertically: a.clippedVertically || b.clippedVertically,
    clipped: a.clippedLeft || b.clippedRight || a.clippedVertically || b.clippedVertically,
    area: Math.max(a.area, b.area),
    pass: -1,
  };
};

/**
 * Joins OCR passes over tiles (and the whole photo) into one list of boxes normalized to the photo. Where passes
 * read the same text, the box read at the highest resolution wins, unless it may have been cut by the edge of its
 * tile (it ends within about a text height of an edge inside the photo); then the pieces of text cut by the edges of
 * two overlapping tiles are joined where they read the same characters, or a box that holds the whole text (from an
 * overlapping tile or the whole photo) wins.
 */
export const mergeOcrPasses = (width: number, height: number, passes: OcrPass[]): OcrBoxInput[] => {
  const candidates: Candidate[] = [];
  for (const [pass, { rect, output }] of passes.entries()) {
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
      // the text height in pixels, along the left edge of the box
      const textHeight = Math.hypot((xs[3] - xs[0]) * rect.width, (ys[3] - ys[0]) * rect.height);
      const marginX = Math.max(EDGE, (EDGE_HEIGHTS * textHeight) / rect.width);
      const marginY = Math.max(EDGE, (0.5 * textHeight) / rect.height);
      const clippedLeft = inner.left && Math.min(...xs) <= marginX;
      const clippedRight = inner.right && Math.max(...xs) >= 1 - marginX;
      const clippedVertically =
        (inner.top && Math.min(...ys) <= marginY) || (inner.bottom && Math.max(...ys) >= 1 - marginY);
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
        clippedLeft,
        clippedRight,
        clippedVertically,
        clipped: clippedLeft || clippedRight || clippedVertically,
        area: rect.width * rect.height,
        pass,
      });
    }
  }

  // text cut by the edges of neighbouring tiles, joined again
  const stitched: Candidate[] = [];
  for (const a of candidates) {
    for (const b of candidates) {
      const joined = stitch(a, b);
      if (joined) {
        stitched.push(joined);
      }
    }
  }
  // a line cut twice (three tiles wide) is joined once more
  const twice: Candidate[] = [];
  for (const a of stitched) {
    for (const b of candidates) {
      const joined = stitch(a, b) ?? stitch(b, a);
      if (joined) {
        twice.push(joined);
      }
    }
  }
  stitched.push(...twice);

  const ranked = [...candidates, ...stitched].toSorted(
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

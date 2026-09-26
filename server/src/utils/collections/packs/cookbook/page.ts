import { MIN_TEXT_SCORE, OcrBoxInput, TextLine, deskewBoxes, median, toTextBox } from 'src/utils/collections/ocr.js';

/*
 * The text of a photo of a cookbook page. Recipe pages are photographed at an angle, close up and across the page,
 * so the lines of text are tilted by up to 45 degrees and fan out in perspective (the lines at the far edge are more
 * tilted than those at the near edge): no single rotation levels them. The page is read in the frame of each line
 * instead: boxes on the line of a box are beside it along its own direction, the next line of its column is below it
 * across that direction.
 */

type Point = { x: number; y: number };

/** an OCR box in page units (x scaled by the aspect ratio, so that distances are the same in both directions) */
export type PagePiece = {
  text: string;
  score: number;
  /** the middle of the left and right edges */
  start: Point;
  end: Point;
  /** the direction of the text, and across it (down the page) */
  along: Point;
  across: Point;
  height: number;
  /** normalized 0..1 bounding box on the photo: left, top, right, bottom */
  box: [number, number, number, number];
};

export type PageLine = PagePiece & {
  pieces: PagePiece[];
  /** where the line starts along and across the page's median direction, for reading order */
  x: number;
  y: number;
  /** where it ends along that direction */
  right: number;
  /** how far below the line before it in its column, in text heights (Infinity for the first line) */
  gap: number;
  /** the line touches an edge of the photo, so its text may be cut there */
  edge: boolean;
};

export type PageColumn = { lines: PageLine[]; x: number; y: number; right: number; bottom: number };

export type PageText = {
  /** columns in reading order: left to right in bands, top to bottom within a band */
  columns: PageColumn[];
  /** the median height of the text */
  lineHeight: number;
};

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const length = (a: Point) => Math.hypot(a.x, a.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** a tilt beyond this many radians (about 50 degrees) is text on its side: a chapter tab, a spine */
const MAX_TILT = 0.87;
/** a box this close to an edge of the photo touches it */
const EDGE = 0.01;

/**
 * The boxes of a tilted page rotated so that its median line is level: `deskewBoxes` leaves tilts over 20 degrees
 * alone, which a recipe page photographed across the table often has.
 */
export const levelBoxes = <T extends OcrBoxInput>(boxes: T[], aspectRatio = 1): T[] => {
  const angles = boxes.flatMap((box) => {
    const dx = (box.x2 - box.x1) * aspectRatio;
    const dy = box.y2 - box.y1;
    const height = Math.hypot((box.x4 - box.x1) * aspectRatio, box.y4 - box.y1);
    return Math.hypot(dx, dy) > 2 * height ? [Math.atan2(dy, dx)] : [];
  });
  const angle = median(angles);
  if (angles.length < 3 || Math.abs(angle) <= (20 * Math.PI) / 180 || Math.abs(angle) > MAX_TILT) {
    return deskewBoxes(boxes, aspectRatio);
  }
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const cx = aspectRatio / 2;
  const rotate = (x: number, y: number) => {
    const px = x * aspectRatio - cx;
    const py = y - 0.5;
    return [(px * cos - py * sin + cx) / aspectRatio, px * sin + py * cos + 0.5];
  };
  return boxes.map((box) => {
    const [x1, y1] = rotate(box.x1, box.y1);
    const [x2, y2] = rotate(box.x2, box.y2);
    const [x3, y3] = rotate(box.x3, box.y3);
    const [x4, y4] = rotate(box.x4, box.y4);
    return { ...box, x1, y1, x2, y2, x3, y3, x4, y4 };
  });
};

const toPiece = (box: OcrBoxInput, aspectRatio: number): PagePiece | undefined => {
  const { text, score } = toTextBox(box);
  if (!text || score < MIN_TEXT_SCORE) {
    return;
  }
  const p1 = { x: box.x1 * aspectRatio, y: box.y1 };
  const p2 = { x: box.x2 * aspectRatio, y: box.y2 };
  const p3 = { x: box.x3 * aspectRatio, y: box.y3 };
  const p4 = { x: box.x4 * aspectRatio, y: box.y4 };
  const start = mid(p1, p4);
  const end = mid(p2, p3);
  const height = (length(sub(p4, p1)) + length(sub(p3, p2))) / 2;
  const span = length(sub(end, start));
  if (height <= 0 || span <= 0) {
    return;
  }
  const along = { x: (end.x - start.x) / span, y: (end.y - start.y) / span };
  const xs = [box.x1, box.x2, box.x3, box.x4];
  const ys = [box.y1, box.y2, box.y3, box.y4];
  return {
    text,
    score,
    start,
    end,
    along,
    across: { x: -along.y, y: along.x },
    height,
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
};

/** a short box (a quantity, a step number) takes the direction of the nearest wide box: its own is noise */
const orientShortPieces = (pieces: PagePiece[]) => {
  const wide = pieces.filter((piece) => length(sub(piece.end, piece.start)) >= 2.5 * piece.height);
  if (wide.length === 0) {
    return pieces;
  }
  return pieces.map((piece) => {
    if (wide.includes(piece)) {
      return piece;
    }
    const center = mid(piece.start, piece.end);
    const nearest = wide.toSorted(
      (a, b) => length(sub(mid(a.start, a.end), center)) - length(sub(mid(b.start, b.end), center)),
    )[0];
    const span = length(sub(piece.end, piece.start));
    const start = { x: center.x - (nearest.along.x * span) / 2, y: center.y - (nearest.along.y * span) / 2 };
    const end = { x: center.x + (nearest.along.x * span) / 2, y: center.y + (nearest.along.y * span) / 2 };
    return { ...piece, start, end, along: nearest.along, across: nearest.across };
  });
};

/** where `point` is in the frame of `piece`: along its text from its end, and across it from its middle */
const frame = (piece: Pick<PagePiece, 'start' | 'along' | 'across'>, origin: Point, point: Point) => {
  const offset = sub(point, origin);
  return { along: dot(offset, piece.along), across: dot(offset, piece.across) };
};

/**
 * OCR reads a line of print in one box, so the boxes to join are a quantity or a step number read apart from its
 * text ("3" "cup chopped ham"), at most this many text heights before it, or the pieces of a line cut by the tiles,
 * which touch; anything further is the next column, however narrow the gutter
 */
const NUMBER_GAP = 1.3;
const PIECE_GAP = 0.5;
const SHORT = /^[\d\s%'’/½⅓⅔¼¾⅛⅜⅝⅞.,)-]{1,4}$|^\S{1,2}$/u;

/** how well `next` continues the line of `piece` to its right, lower is better; undefined when it does not */
const lineGap = (piece: PagePiece, next: PagePiece) => {
  const ratio = Math.max(piece.height, next.height) / Math.min(piece.height, next.height);
  if (piece === next || ratio > 1.6) {
    return;
  }
  const { along, across } = frame(piece, piece.end, next.start);
  const height = Math.max(piece.height, next.height);
  // boxes of text in different sizes are one line only when they touch: a title beside the text of another column
  // is not, a line read in two boxes that perspective made different sizes is
  const maxGap = ratio > 1.3 ? 0.2 : SHORT.test(piece.text) ? NUMBER_GAP : PIECE_GAP;
  if (along < -0.8 * height || along > maxGap * height || Math.abs(across) > 0.45 * height) {
    return;
  }
  return Math.max(0, along) + 2 * Math.abs(across);
};

const toLine = (pieces: PagePiece[]): Omit<PageLine, 'x' | 'y' | 'right' | 'gap' | 'edge'> => {
  const first = pieces[0];
  const last = pieces.at(-1)!;
  const widest = pieces.toSorted(
    (a, b) => length(sub(b.end, b.start)) / b.height - length(sub(a.end, a.start)) / a.height,
  )[0];
  return {
    ...first,
    pieces,
    text: pieces.map((piece) => piece.text).join(' '),
    score: Math.min(...pieces.map((piece) => piece.score)),
    end: last.end,
    along: widest.along,
    across: widest.across,
    height: median(pieces.map((piece) => piece.height)),
    box: [
      Math.min(...pieces.map((piece) => piece.box[0])),
      Math.min(...pieces.map((piece) => piece.box[1])),
      Math.max(...pieces.map((piece) => piece.box[2])),
      Math.max(...pieces.map((piece) => piece.box[3])),
    ],
  };
};

/** chains of items where each is the other's best continuation (lower gap is better) */
const chain = <T>(items: T[], gap: (a: T, b: T) => number | undefined): T[][] => {
  const next = new Map<T, { item: T; gap: number }>();
  const previous = new Map<T, { item: T; gap: number }>();
  for (const a of items) {
    for (const b of items) {
      const value = a === b ? undefined : gap(a, b);
      if (value === undefined) {
        continue;
      }
      if (!next.has(a) || value < next.get(a)!.gap) {
        next.set(a, { item: b, gap: value });
      }
      if (!previous.has(b) || value < previous.get(b)!.gap) {
        previous.set(b, { item: a, gap: value });
      }
    }
  }
  const chains: T[][] = [];
  const used = new Set<T>();
  for (const item of items) {
    if (used.has(item)) {
      continue;
    }
    // walk back to the start of the chain
    let first = item;
    const seen = new Set([first]);
    for (;;) {
      const back = previous.get(first)?.item;
      if (!back || used.has(back) || seen.has(back) || next.get(back)?.item !== first) {
        break;
      }
      first = back;
      seen.add(first);
    }
    const members = [first];
    used.add(first);
    let current = first;
    for (;;) {
      const forward = next.get(current)?.item;
      if (!forward || used.has(forward) || previous.get(forward)?.item !== current) {
        break;
      }
      members.push(forward);
      used.add(forward);
      current = forward;
    }
    chains.push(members);
  }
  return chains;
};

/** the next line of a column is at most this many line heights below, the next paragraph at most this many */
const LINE_GAP = 3.2;
const PARAGRAPH_GAP = 7;

/** how well `lower` continues the column of `upper` below it, lower is better; undefined when it does not */
const columnGap = (upper: PageLine, lower: PageLine, maxGap = LINE_GAP) => {
  const height = Math.max(upper.height, lower.height);
  if (height > 2.6 * Math.min(upper.height, lower.height)) {
    return;
  }
  const start = frame(upper, upper.start, lower.start);
  const end = frame(upper, upper.start, lower.end);
  const upperLength = dot(sub(upper.end, upper.start), upper.along);
  if (start.across < 0.5 * upper.height || start.across > maxGap * height) {
    return;
  }
  // the lines overlap along the text: left-aligned, indented or centred
  const overlap = Math.min(end.along, upperLength) - Math.max(start.along, 0);
  if (overlap < 0.3 * Math.min(upperLength, end.along - start.along) || start.along < -4 * height) {
    return;
  }
  return start.across + 0.3 * Math.abs(start.along);
};

/**
 * The lines and columns of a recipe page, in reading order. Boxes that read text on its side (a chapter tab) are left
 * out.
 */
export const readPage = (ocr: OcrBoxInput[], aspectRatio = 1): PageText => {
  const leveled = levelBoxes(ocr, aspectRatio);
  const pieces = orientShortPieces(
    leveled.flatMap((box) => {
      const piece = toPiece(box, aspectRatio);
      return piece && Math.abs(Math.atan2(piece.along.y, piece.along.x)) <= MAX_TILT ? [piece] : [];
    }),
  );
  const lineHeight = median(pieces.map((piece) => piece.height));

  // the median direction of the page, for the reading order
  const angle = median(pieces.map((piece) => Math.atan2(piece.along.y, piece.along.x)));
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const down = { x: -axis.y, y: axis.x };

  const lines: PageLine[] = chain(pieces, lineGap).map((members) => {
    const line = toLine(members);
    const [left, top, right, bottom] = line.box;
    return {
      ...line,
      x: dot(line.start, axis),
      y: dot(line.start, down),
      right: dot(line.end, axis),
      gap: Infinity,
      edge: left <= EDGE || top <= EDGE || right >= 1 - EDGE || bottom >= 1 - EDGE,
    };
  });

  // the parts of a column a paragraph gap apart (the ingredients and the steps below them) are joined again
  const parts = chain(lines, columnGap);
  const columns: PageColumn[] = chain(parts, (upper, lower) => columnGap(upper.at(-1)!, lower[0], PARAGRAPH_GAP)).map(
    (members) => {
      const column = members.flat();
      for (const [index, line] of column.entries()) {
        const previous = column[index - 1];
        line.gap = previous ? frame(previous, previous.start, line.start).across / previous.height : Infinity;
      }
      return {
        lines: column,
        x: Math.min(...column.map((line) => line.x)),
        y: column[0].y,
        right: Math.max(...column.map((line) => line.right)),
        bottom: column.at(-1)!.y,
      };
    },
  );

  return { columns: toReadingOrder(columns), lineHeight };
};

/**
 * Columns in reading order: bands of columns that share a stretch of the page from left to right, and within a band
 * from top to bottom.
 */
const toReadingOrder = (columns: PageColumn[]) => {
  const bands: PageColumn[][] = [];
  for (const column of columns.toSorted((a, b) => a.x - b.x)) {
    const band = bands.find((members) =>
      members.some((other) => Math.min(other.right, column.right) > Math.max(other.x, column.x)),
    );
    if (band) {
      band.push(column);
    } else {
      bands.push([column]);
    }
  }
  return bands
    .map((members) => members.toSorted((a, b) => a.y - b.y))
    .toSorted((a, b) => Math.min(...a.map(({ x }) => x)) - Math.min(...b.map(({ x }) => x)))
    .flat();
};

/** where a line starts in the frame of another, in its text heights: along its text, and across it (down) */
export const getOffset = (from: PageLine, to: PageLine) => {
  const { along, across } = frame(from, from.start, to.start);
  return { along: along / from.height, across: across / from.height };
};

/** a page line as a `TextLine`, normalized to the photo */
export const toTextLine = (line: PageLine): Pick<TextLine, 'text' | 'left' | 'top' | 'right' | 'bottom'> => ({
  text: line.text,
  left: line.box[0],
  top: line.box[1],
  right: line.box[2],
  bottom: line.box[3],
});

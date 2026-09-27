import { maxBy, minBy } from 'lodash-es';

export type CropBox = { x1: number; y1: number; x2: number; y2: number };

export type CropFace = CropBox & {
  /** where the face looks, from -1 (towards the left edge) to 1 (towards the right edge), if known */
  direction?: number;
};

export type CropRect = { x: number; y: number; width: number; height: number };

export type CropSuggestionOptions = {
  width: number;
  height: number;
  aspectRatio: number | string;
  faces?: CropFace[];
  /** point of interest used when there are no faces, in pixels; defaults to the image centre */
  saliency?: { x: number; y: number };
  /** headroom above the top face as a fraction of its height; side and body room scale with it */
  marginRatio?: number;
};

export type CropSuggestion = {
  feasible: boolean;
  rect: CropRect;
  aspectRatio: number;
  reason: string;
  /** indexes of the faces fully inside the crop */
  includedFaces: number[];
  /** indexes of the faces left out of the crop */
  droppedFaces: number[];
};

const DEFAULT_MARGIN_RATIO = 0.6;
/** faces smaller than this fraction of the main face may be cut; they are background faces */
const MINOR_FACE_RATIO = 0.3;
/** the eyes sit this far down the face box */
const EYE_LINE = 0.4;
/** shift of the crop centre towards the direction the faces look, as a fraction of the crop */
const LEAD_ROOM = 0.1;
const EPSILON = 0.5;

const ASPECT_RATIO_REGEX = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/i;

export const parseAspectRatio = (value: number | string): number => {
  let ratio: number;
  if (typeof value === 'number') {
    ratio = value;
  } else {
    const match = value.match(ASPECT_RATIO_REGEX);
    ratio = match ? Number(match[1]) / Number(match[2]) : Number(value.trim());
  }

  if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 10) {
    throw new Error(`Invalid aspect ratio: ${value}. Use a ratio like "4:3" or a number like 1.5`);
  }

  return ratio;
};

export const normalizeRect = (rect: CropRect, width: number, height: number): CropRect => ({
  x: rect.x / width,
  y: rect.y / height,
  width: rect.width / width,
  height: rect.height / height,
});

/** Scales a box from `source` dimensions (e.g. the preview that face detection ran on) into `target` dimensions */
export const scaleBox = <T extends CropBox>(
  box: T,
  source: { width: number; height: number },
  target: { width: number; height: number },
): T => {
  const scaleX = source.width ? target.width / source.width : 1;
  const scaleY = source.height ? target.height / source.height : 1;
  return { ...box, x1: box.x1 * scaleX, y1: box.y1 * scaleY, x2: box.x2 * scaleX, y2: box.y2 * scaleY };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type Axis = 'x' | 'y';

type Span = {
  index: number;
  start: number;
  end: number;
  /** size of the face along the other axis */
  cross: number;
  importance: number;
  direction?: number;
};

const toSpan = (face: CropFace, index: number, axis: Axis, width: number, height: number): Span => {
  const faceWidth = face.x2 - face.x1;
  const faceHeight = face.y2 - face.y1;
  const dx = ((face.x1 + face.x2) / 2 - width / 2) / (width / 2);
  const dy = ((face.y1 + face.y2) / 2 - height / 2) / (height / 2);
  const distance = Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);

  return {
    index,
    start: axis === 'x' ? face.x1 : face.y1,
    end: axis === 'x' ? face.x2 : face.y2,
    cross: axis === 'x' ? faceHeight : faceWidth,
    importance: faceWidth * faceHeight * (1 - 0.5 * distance),
    direction: face.direction,
  };
};

const contains = (position: number, length: number, span: Span) =>
  position <= span.start + EPSILON && position + length >= span.end - EPSILON;

const cuts = (position: number, length: number, span: Span) => {
  const overlap = Math.min(position + length, span.end) - Math.max(position, span.start);
  return overlap > EPSILON && !contains(position, length, span);
};

/** Positions in `[lo, hi]` where no protected face outside the crop is cut, as closed intervals */
const allowedIntervals = (lo: number, hi: number, length: number, excluded: Span[]) => {
  let intervals: Array<[number, number]> = [[lo, hi]];
  for (const span of excluded) {
    // the crop cuts the face for positions in (start - length, end)
    const forbiddenLo = span.start - length + EPSILON;
    const forbiddenHi = span.end - EPSILON;
    intervals = intervals.flatMap(([a, b]): Array<[number, number]> => {
      if (forbiddenHi <= a || forbiddenLo >= b) {
        return [[a, b]];
      }
      const pieces: Array<[number, number]> = [];
      if (forbiddenLo > a) {
        pieces.push([a, forbiddenLo - EPSILON]);
      }
      if (forbiddenHi < b) {
        pieces.push([forbiddenHi + EPSILON, b]);
      }
      return pieces;
    });
  }
  return intervals.filter(([a, b]) => b >= a);
};

type Placement = { position: number; included: Span[]; cut: Span[] };

const place = (spans: Span[], main: Span, protectedSpans: Set<Span>, length: number, size: number) => {
  const max = size - length;
  const candidates = new Set<number>([0, max]);
  for (const span of spans) {
    for (const value of [span.start, span.end - length, span.end, span.start - length]) {
      candidates.add(clamp(value, 0, max));
    }
  }

  let best: (Placement & { score: number }) | undefined;
  for (const position of candidates) {
    if (!contains(position, length, main)) {
      continue;
    }

    const cut = spans.filter((span) => protectedSpans.has(span) && cuts(position, length, span));
    const included = spans.filter((span) => contains(position, length, span));
    const score = included.reduce((sum, span) => sum + span.importance, 0);
    // never cutting a face matters more than keeping more of them
    if (!best || cut.length < best.cut.length || (cut.length === best.cut.length && score > best.score)) {
      best = { position, included, cut, score };
    }
  }

  return best!;
};

const getMargins = (included: Span[], axis: Axis, marginRatio: number) => {
  const first = minBy(included, (span) => span.start)!;
  const last = maxBy(included, (span) => span.end)!;

  if (axis === 'x') {
    // side room, relative to face width (the extent along x)
    const side = (2 / 3) * marginRatio;
    return { before: side * (first.end - first.start), after: side * (last.end - last.start) };
  }

  // headroom above the top face, body room below the bottom face
  return {
    before: marginRatio * (first.end - first.start),
    after: (5 / 3) * marginRatio * (last.end - last.start),
  };
};

const getDesiredPosition = (included: Span[], axis: Axis, length: number, marginRatio: number) => {
  const start = Math.min(...included.map((span) => span.start));
  const end = Math.max(...included.map((span) => span.end));
  const weight = included.reduce((sum, span) => sum + span.importance, 0) || 1;

  let desired: number;
  if (axis === 'x') {
    const directions = included.map((span) => span.direction);
    const direction = directions.every((value) => value !== undefined)
      ? included.reduce((sum, span) => sum + clamp(span.direction!, -1, 1) * span.importance, 0) / weight
      : 0;
    desired = (start + end) / 2 + direction * LEAD_ROOM * length - length / 2;
  } else {
    const eyeLine =
      included.reduce((sum, span) => sum + (span.start + EYE_LINE * (span.end - span.start)) * span.importance, 0) /
      weight;
    desired = eyeLine - length / 3;
  }

  const { before, after } = getMargins(included, axis, marginRatio);
  const softLo = end + after - length;
  const softHi = start - before;
  if (softLo <= softHi) {
    return clamp(desired, softLo, softHi);
  }

  // not enough room for the full margins: share what is left in proportion
  const slack = Math.max(0, length - (end - start));
  return start - (slack * before) / (before + after || 1);
};

const toRect = (axis: Axis | null, position: number, cropWidth: number, cropHeight: number): CropRect => ({
  x: axis === 'x' ? position : 0,
  y: axis === 'y' ? position : 0,
  width: cropWidth,
  height: cropHeight,
});

const finalize = (rect: CropRect, width: number, height: number): CropRect => {
  const w = clamp(Math.round(rect.width), 1, width);
  const h = clamp(Math.round(rect.height), 1, height);
  return {
    x: clamp(Math.round(rect.x), 0, width - w),
    y: clamp(Math.round(rect.y), 0, height - h),
    width: w,
    height: h,
  };
};

/**
 * Finds the largest crop of the given aspect ratio that keeps every face whole, leaving headroom above the faces and
 * some body room below them. The subject is centred horizontally (with lead room towards where the faces look) and
 * the eye line sits on the upper third. Faces that cannot fit are dropped, least important first, and a crop that
 * cannot hold the main face is reported as not feasible.
 */
export const suggestCrop = ({
  width,
  height,
  aspectRatio,
  faces = [],
  saliency,
  marginRatio = DEFAULT_MARGIN_RATIO,
}: CropSuggestionOptions): CropSuggestion => {
  if (width <= 0 || height <= 0) {
    throw new Error('Image dimensions are required to suggest a crop');
  }

  const ratio = parseAspectRatio(aspectRatio);
  const isWider = width / height > ratio;
  const cropWidth = isWider ? height * ratio : width;
  const cropHeight = isWider ? height : width / ratio;
  const axis: Axis | null = width - cropWidth >= 1 ? 'x' : height - cropHeight >= 1 ? 'y' : null;
  const length = axis === 'x' ? cropWidth : cropHeight;
  const size = axis === 'x' ? width : height;

  const validFaces = faces
    .map((face, index) => ({
      ...face,
      index,
      x1: clamp(face.x1, 0, width),
      x2: clamp(face.x2, 0, width),
      y1: clamp(face.y1, 0, height),
      y2: clamp(face.y2, 0, height),
    }))
    .filter((face) => face.x2 > face.x1 && face.y2 > face.y1);
  const allIndexes = validFaces.map((face) => face.index);

  const result = (
    rect: CropRect,
    feasible: boolean,
    reason: string,
    includedFaces: number[] = allIndexes,
  ): CropSuggestion => {
    const finalRect = finalize(rect, width, height);
    const included = new Set(includedFaces);
    return {
      feasible,
      rect: finalRect,
      aspectRatio: ratio,
      reason,
      includedFaces: [...included].sort((a, b) => a - b),
      droppedFaces: allIndexes.filter((index) => !included.has(index)),
    };
  };

  if (!axis) {
    return result(toRect(null, 0, cropWidth, cropHeight), true, 'The image already has this aspect ratio');
  }

  if (validFaces.length === 0) {
    const point = saliency ?? { x: width / 2, y: height / 2 };
    const center = axis === 'x' ? point.x : point.y;
    const position = clamp(center - length / 2, 0, size - length);
    const reason = saliency ? 'No faces; centred on the most salient region' : 'No faces; centred on the image';
    return result(toRect(axis, position, cropWidth, cropHeight), true, reason, []);
  }

  const spans = validFaces.map((face) => toSpan(face, face.index, axis, width, height));
  const main = maxBy(spans, (span) => span.importance)!;

  if (main.end - main.start > length + EPSILON) {
    const position = clamp((main.start + main.end) / 2 - length / 2, 0, size - length);
    return result(
      toRect(axis, position, cropWidth, cropHeight),
      false,
      `The main face does not fit in a ${formatRatio(ratio)} crop of this image`,
      [],
    );
  }

  const mainHeight = axis === 'x' ? main.cross : main.end - main.start;
  const protectedSpans = new Set(
    spans.filter((span) => (axis === 'x' ? span.cross : span.end - span.start) >= MINOR_FACE_RATIO * mainHeight),
  );

  const placement = place(spans, main, protectedSpans, length, size);
  const included = placement.included;
  const includedSet = new Set(included);
  const excludedProtected = spans.filter((span) => protectedSpans.has(span) && !includedSet.has(span));

  const lo = Math.max(0, Math.max(...included.map((span) => span.end)) - length);
  const hi = Math.min(size - length, ...included.map((span) => span.start));
  const intervals = allowedIntervals(lo, hi, length, excludedProtected);
  const interval = intervals.find(
    ([a, b]) => placement.position >= a - EPSILON && placement.position <= b + EPSILON,
  ) ?? [placement.position, placement.position];

  const desired = getDesiredPosition(included, axis, length, marginRatio);
  const position = clamp(desired, interval[0], interval[1]);
  const rect = toRect(axis, position, cropWidth, cropHeight);
  const includedFaces = included.map((span) => span.index);

  if (placement.cut.length > 0) {
    return result(
      rect,
      false,
      `Every ${formatRatio(ratio)} crop that keeps the main face cuts through another face`,
      includedFaces,
    );
  }

  const dropped = spans.length - included.length;
  const reason =
    dropped === 0
      ? spans.length === 1
        ? 'The face fits with room around it'
        : `All ${spans.length} faces fit`
      : `Kept ${included.length} of ${spans.length} faces; the others do not fit in a ${formatRatio(ratio)} crop`;

  return result(rect, true, reason, includedFaces);
};

const formatRatio = (ratio: number) => {
  for (const [w, h] of [
    [1, 1],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [16, 9],
    [9, 16],
    [5, 4],
    [4, 5],
  ]) {
    if (Math.abs(ratio - w / h) < 0.005) {
      return `${w}:${h}`;
    }
  }
  return ratio.toFixed(2);
};

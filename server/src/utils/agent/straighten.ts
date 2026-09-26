import type { CropBox, CropRect } from 'src/utils/agent/crop.js';

/** straightening is for small tilts; larger rotations lose too much of the photo */
export const MAX_STRAIGHTEN_DEGREES = 20;

/** below this, a correction isn't visible */
export const MIN_VISIBLE_TILT_DEGREES = 0.4;

/** tilt estimates with less confidence than this are not worth acting on without looking */
export const TILT_CONFIDENCE_THRESHOLD = 0.3;

const MAX_DETECTED_TILT = 10;

/** handheld photos are rarely off by more than this; larger "tilts" are usually perspective lines */
const MAX_RECOMMENDED_TILT = 8;

/** when the lines already line up this well without rotating, the photo is level and the peak is perspective */
const LEVEL_SHARE = 0.6;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Size of the canvas after rotating a `width`×`height` image by `angle` degrees (clockwise when positive, like sharp).
 */
export const getRotatedCanvasSize = (width: number, height: number, angle: number) => {
  const cos = Math.abs(Math.cos(toRadians(angle)));
  const sin = Math.abs(Math.sin(toRadians(angle)));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
};

/**
 * Scale of the largest rectangle with the image's own aspect ratio that fits inside the rotated image, centered, so
 * the straightened photo has no blank corners. It only depends on the aspect ratio and the angle.
 */
export const getStraightenScale = (width: number, height: number, angle: number) => {
  const cos = Math.abs(Math.cos(toRadians(angle)));
  const sin = Math.abs(Math.sin(toRadians(angle)));
  return Math.min(width / (width * cos + height * sin), height / (width * sin + height * cos));
};

/** Size of the straightened photo, in pixels of the upright original. */
export const getStraightenedSize = (width: number, height: number, angle: number) => {
  const scale = getStraightenScale(width, height, angle);
  return { width: width * scale, height: height * scale };
};

/** Where the straightened photo sits inside the rotated canvas (e.g. the output of sharp's `rotate`). */
export const getStraightenedFrame = (
  canvas: { width: number; height: number },
  source: { width: number; height: number },
  angle: number,
) => {
  const size = getStraightenedSize(source.width, source.height, angle);
  return {
    x: (canvas.width - size.width) / 2,
    y: (canvas.height - size.height) / 2,
    width: size.width,
    height: size.height,
  };
};

/** Maps a point of the upright original to the straightened photo. */
export const toStraightened = (point: { x: number; y: number }, width: number, height: number, angle: number) => {
  const radians = toRadians(angle);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - width / 2;
  const dy = point.y - height / 2;
  const size = getStraightenedSize(width, height, angle);
  // image coordinates point down, so this matrix turns the picture clockwise for positive angles
  return { x: dx * cos - dy * sin + size.width / 2, y: dx * sin + dy * cos + size.height / 2 };
};

/**
 * Maps a box (e.g. a face) of the upright original to the straightened photo: the bounding box of its rotated
 * corners, clipped to the photo. Returns null when the box ends up outside the straightened photo.
 */
export const boxToStraightened = (box: CropBox, width: number, height: number, angle: number): CropBox | null => {
  const corners = [
    { x: box.x1, y: box.y1 },
    { x: box.x2, y: box.y1 },
    { x: box.x1, y: box.y2 },
    { x: box.x2, y: box.y2 },
  ].map((corner) => toStraightened(corner, width, height, angle));

  const size = getStraightenedSize(width, height, angle);
  const x1 = Math.max(0, Math.min(...corners.map(({ x }) => x)));
  const y1 = Math.max(0, Math.min(...corners.map(({ y }) => y)));
  const x2 = Math.min(size.width, Math.max(...corners.map(({ x }) => x)));
  const y2 = Math.min(size.height, Math.max(...corners.map(({ y }) => y)));
  return x2 - x1 >= 1 && y2 - y1 >= 1 ? { x1, y1, x2, y2 } : null;
};

/** A crop of the straightened photo, as a rectangle in the rotated canvas of a (possibly differently sized) image. */
export const toCanvasRect = (
  crop: CropRect | null,
  canvas: { width: number; height: number },
  source: { width: number; height: number },
  angle: number,
): CropRect => {
  const frame = getStraightenedFrame(canvas, source, angle);
  if (!crop) {
    return frame;
  }
  return { x: frame.x + crop.x, y: frame.y + crop.y, width: crop.width, height: crop.height };
};

export type TiltEstimate = {
  /** clockwise rotation in degrees that makes the dominant lines level or plumb; 0 when nothing was found */
  angle: number;
  /** 0..1, how clearly one tilt stands out among the strong edges of the photo */
  confidence: number;
  /** whether straightening by `angle` is recommended */
  recommended: boolean;
};

/**
 * Estimates how much a photo is tilted from its near-horizontal and near-vertical edges (horizons, buildings, poles,
 * door frames): a histogram of edge directions within ±12° of level or plumb, weighted by edge strength.
 */
const getBest = (scores: { angle: number; score: number }[]) => {
  let best = scores[0];
  for (const entry of scores) {
    if (entry.score > best.score) {
      best = entry;
    }
  }
  return best;
};

/** the strong edge points, relative to the image centre, of level (horizontal) and plumb (vertical) edges */
type EdgePoints = { levelX: Float64Array; levelY: Float64Array; plumbX: Float64Array; plumbY: Float64Array };

/** how tightly the edge points line up into rows (level edges) and columns (plumb edges) after rotating by `angle` */
const alignmentScore = (points: EdgePoints, angle: number, bins: { rows: Float64Array; columns: Float64Array }) => {
  const radians = toRadians(angle);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const { rows, columns } = bins;
  // the points are within `offset` of the centre, so the bins are indexed from there
  const offset = (rows.length - 1) / 2;
  rows.fill(0);
  columns.fill(0);
  const { levelX, levelY, plumbX, plumbY } = points;
  for (let i = 0; i < levelX.length; i++) {
    rows[Math.round(levelX[i] * sin + levelY[i] * cos) + offset]++;
  }
  for (let i = 0; i < plumbX.length; i++) {
    columns[Math.round(plumbX[i] * cos - plumbY[i] * sin) + offset]++;
  }
  let score = 0;
  for (let i = 0; i < rows.length; i++) {
    score += rows[i] * rows[i] + columns[i] * columns[i];
  }
  return score;
};

/**
 * Estimates how much a photo is tilted from its near-horizontal and near-vertical edges (horizons, buildings, poles,
 * door frames), like deskewing a scanned page: the strong edge points are rotated by candidate angles, and the angle
 * at which they line up most tightly into rows and columns wins.
 */
export const estimateTilt = ({
  data,
  width,
  height,
}: {
  data: Uint8Array;
  width: number;
  height: number;
}): TiltEstimate => {
  const none = { angle: 0, confidence: 0, recommended: false };
  if (width < 16 || height < 16) {
    return none;
  }

  const candidates: { dx: number; dy: number; level: boolean; magnitude: number }[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const [nw, n, ne] = [data[i - width - 1], data[i - width], data[i - width + 1]];
      const [w, e] = [data[i - 1], data[i + 1]];
      const [sw, s, se] = [data[i + width - 1], data[i + width], data[i + width + 1]];
      const gx = ne + 2 * e + se - nw - 2 * w - sw;
      const gy = sw + 2 * s + se - nw - 2 * n - ne;
      // the squared magnitude is compared first: most pixels are flat
      if (gx * gx + gy * gy < 3600) {
        continue;
      }
      const magnitude = Math.hypot(gx, gy);

      // keep edges within the detectable tilt of level (vertical gradient) or plumb (horizontal gradient)
      const level = Math.abs(gy) >= Math.abs(gx);
      const offset =
        (Math.atan2(level ? Math.abs(gx) : Math.abs(gy), level ? Math.abs(gy) : Math.abs(gx)) * 180) / Math.PI;
      if (offset > MAX_DETECTED_TILT + 3) {
        continue;
      }
      candidates.push({ dx: x - width / 2, dy: y - height / 2, level, magnitude });
    }
  }

  if (candidates.length < 200) {
    return none;
  }

  // only the strongest edges tell where the lines are
  const threshold = candidates.map(({ magnitude }) => magnitude).sort((a, b) => a - b)[
    Math.floor(candidates.length * 0.6)
  ];
  const strong = candidates.filter(({ magnitude }) => magnitude >= threshold);
  const level = strong.filter((point) => point.level);
  const plumb = strong.filter((point) => !point.level);
  const points: EdgePoints = {
    levelX: Float64Array.from(level, ({ dx }) => dx),
    levelY: Float64Array.from(level, ({ dy }) => dy),
    plumbX: Float64Array.from(plumb, ({ dx }) => dx),
    plumbY: Float64Array.from(plumb, ({ dy }) => dy),
  };
  const radius = Math.ceil(Math.hypot(width, height) / 2) + 1;
  const bins = { rows: new Float64Array(2 * radius + 1), columns: new Float64Array(2 * radius + 1) };

  const scan = (from: number, to: number, step: number) => {
    const scores: { angle: number; score: number }[] = [];
    for (let angle = from; angle <= to + 1e-9; angle += step) {
      scores.push({ angle, score: alignmentScore(points, angle, bins) });
    }
    return scores;
  };

  const coarse = scan(-MAX_DETECTED_TILT, MAX_DETECTED_TILT, 0.25);
  const bestCoarse = getBest(coarse);
  const fine = scan(bestCoarse.angle - 0.3, bestCoarse.angle + 0.3, 0.02);
  const best = getBest(fine);

  // how far the winning angle stands out from a typical one
  const typical = coarse.map(({ score }) => score).sort((a, b) => a - b)[Math.floor(coarse.length / 2)];
  const confidence = typical > 0 ? Math.max(0, Math.min(1, 1 - typical / best.score) * 1.25 - 0.25) : 0;
  const angle = Math.round(best.angle * 100) / 100 || 0;
  const isLevel = alignmentScore(points, 0, bins) / best.score >= LEVEL_SHARE;

  return {
    angle,
    confidence: Math.round(Math.max(0, confidence) * 100) / 100,
    recommended:
      !isLevel &&
      confidence >= TILT_CONFIDENCE_THRESHOLD &&
      Math.abs(angle) >= MIN_VISIBLE_TILT_DEGREES &&
      Math.abs(angle) <= MAX_RECOMMENDED_TILT,
  };
};

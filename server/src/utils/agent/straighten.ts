import type { CropBox, CropRect } from 'src/utils/agent/crop.js';

/** straightening is for small tilts; larger rotations lose too much of the photo */
export const MAX_STRAIGHTEN_DEGREES = 20;

/** below this, a correction isn't visible */
export const MIN_VISIBLE_TILT_DEGREES = 0.4;

/** tilt estimates with less confidence than this are not worth acting on without looking */
export const TILT_CONFIDENCE_THRESHOLD = 0.3;

const MAX_DETECTED_TILT = 12;

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
type EdgePoint = { dx: number; dy: number; weight: number; level: boolean };

/** how tightly the edge points line up into rows (level edges) and columns (plumb edges) after rotating by `angle` */
const alignmentScore = (points: EdgePoint[], angle: number) => {
  const radians = toRadians(angle);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rows = new Map<number, number>();
  const columns = new Map<number, number>();
  for (const { dx, dy, weight, level } of points) {
    if (level) {
      const row = Math.round(dx * sin + dy * cos);
      rows.set(row, (rows.get(row) ?? 0) + weight);
    } else {
      const column = Math.round(dx * cos - dy * sin);
      columns.set(column, (columns.get(column) ?? 0) + weight);
    }
  }
  let score = 0;
  for (const value of rows.values()) {
    score += value * value;
  }
  for (const value of columns.values()) {
    score += value * value;
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

  const candidates: (EdgePoint & { magnitude: number })[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (dx: number, dy: number) => data[(y + dy) * width + x + dx];
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 60) {
        continue;
      }

      // keep edges within the detectable tilt of level (vertical gradient) or plumb (horizontal gradient)
      const level = Math.abs(gy) >= Math.abs(gx);
      const offset =
        (Math.atan2(level ? Math.abs(gx) : Math.abs(gy), level ? Math.abs(gy) : Math.abs(gx)) * 180) / Math.PI;
      if (offset > MAX_DETECTED_TILT + 3) {
        continue;
      }
      candidates.push({ dx: x - width / 2, dy: y - height / 2, weight: 1, level, magnitude });
    }
  }

  if (candidates.length < 200) {
    return none;
  }

  // only the strongest edges tell where the lines are
  const threshold = candidates.map(({ magnitude }) => magnitude).sort((a, b) => a - b)[
    Math.floor(candidates.length * 0.6)
  ];
  const points = candidates.filter(({ magnitude }) => magnitude >= threshold);

  const scan = (from: number, to: number, step: number) => {
    const scores: { angle: number; score: number }[] = [];
    for (let angle = from; angle <= to + 1e-9; angle += step) {
      scores.push({ angle, score: alignmentScore(points, angle) });
    }
    return scores;
  };

  const coarse = scan(-MAX_DETECTED_TILT, MAX_DETECTED_TILT, 0.25);
  const bestCoarse = coarse.reduce((best, entry) => (entry.score > best.score ? entry : best));
  const fine = scan(bestCoarse.angle - 0.3, bestCoarse.angle + 0.3, 0.02);
  const best = fine.reduce((best, entry) => (entry.score > best.score ? entry : best));

  // how far the winning angle stands out from a typical one
  const typical = coarse.map(({ score }) => score).sort((a, b) => a - b)[Math.floor(coarse.length / 2)];
  const confidence = typical > 0 ? Math.max(0, Math.min(1, 1 - typical / best.score) * 1.25 - 0.25) : 0;
  const angle = Math.round(best.angle * 100) / 100 || 0;

  return {
    angle,
    confidence: Math.round(Math.max(0, confidence) * 100) / 100,
    recommended: confidence >= TILT_CONFIDENCE_THRESHOLD && Math.abs(angle) >= MIN_VISIBLE_TILT_DEGREES,
  };
};

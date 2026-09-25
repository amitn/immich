import { CropRect, normalizeRect, parseAspectRatio, suggestCrop } from 'src/utils/agent/crop.js';
import {
  ImageAnalysis,
  ScoreFace,
  aestheticScore,
  colorfulnessScore,
  compositionScore,
  contrastScore,
  exposureScore,
  faceScore,
  overallScore,
  sharpnessScore,
  vividnessScore,
} from 'src/utils/agent/scoring.js';
import { boxToStraightened, getStraightenedSize } from 'src/utils/agent/straighten.js';
import { EnhanceCorrectionType, EnhanceStrength } from 'src/utils/enhance.js';

/** How a photo can be improved: straightened first, then cropped, then enhanced */
export type ImproveRecipe = {
  enhance?: { strength: EnhanceStrength };
  /** degrees, clockwise when positive */
  rotate?: number;
  /** fractions (0..1) of the photo, of the straightened one when `rotate` is set */
  crop?: CropRect;
};

export type ImproveEstimate = {
  /** overall score of the photo as it is */
  now: number;
  /** overall score after the fixes of `recipe`; equal to `now` when nothing helps */
  potential: number;
  gain: number;
  /** empty when no fix helps measurably */
  recipe: ImproveRecipe;
};

export type ScoreExtra = { isFavorite?: boolean; rating?: number | null };

export type Size = { width: number; height: number };

/** a single fix (straighten, crop or enhance) has to add at least this much to the overall score */
export const IMPROVE_STEP_MARGIN = 0.01;
/** below this total gain a photo is left alone */
export const IMPROVE_MIN_GAIN = 0.02;
/** candidates simulated per pick in stage 2 */
export const IMPROVE_POOL_FACTOR = 2.5;
export const IMPROVE_MAX_POOL = 300;
/** larger measured tilts are mostly perspective lines (a table, a shop front), so they are not fixed automatically */
export const IMPROVE_MAX_ROTATE = 4;
/** a crop without a target aspect keeps the original shape and at least this share of the area */
export const TIGHTEN_MIN_KEEP = 0.85;
const TIGHTEN_KEEPS = [TIGHTEN_MIN_KEEP, 0.92] as const;
/** the predicted composition score must improve this much for a tightening crop to be tried */
const TIGHTEN_MIN_COMPOSITION_GAIN = 0.1;
/** a crop for a target aspect may lose up to this share of the photo */
const ASPECT_MAX_LOSS = 0.45;
/** without a known print size a crop must keep 12×8 inches at 150 dpi */
export const MIN_CROP_PIXELS = { long: 1800, short: 1200 };
export const MIN_PRINT_DPI = 150;
/** headroom above a face that a crop must keep, as a share of the face height */
const FACE_HEADROOM = 0.25;
/** faces smaller than this share of the largest face's height may be left out of a crop */
const MINOR_FACE = 0.3;

/** corrections that change the scored metrics; noise reduction and sharpening only matter at full size */
export const SIMULATED_CORRECTIONS: EnhanceCorrectionType[] = [
  'whiteBalance',
  'levels',
  'exposure',
  'localContrast',
  'saturation',
];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** the overall score of `scorePhoto`, unrounded */
export const getOverallScore = (analysis: ImageAnalysis | null, faces: ScoreFace[], extra: ScoreExtra = {}) =>
  overallScore({
    sharpness: analysis ? sharpnessScore(analysis.laplacianVariance) : 0.5,
    exposure: analysis ? exposureScore(analysis) : 0.5,
    aesthetic: analysis ? aestheticScore(analysis) : 0.5,
    faceScore: faceScore(faces).faceScore,
    ...extra,
  });

/**
 * Stage 1: the overall score without the weaknesses the app can fix. A dark or bright mean (unless extreme), low
 * contrast, muted colours and a weak composition are scored as if corrected, and small faces as if a tightening crop
 * enlarged them when the photo has the pixels for it. Clipped highlights and shadows, colourfulness, blur and the
 * faces of small photos stay as they are.
 */
export const getPoolScore = (
  analysis: ImageAnalysis | null,
  faces: ScoreFace[],
  extra: ScoreExtra = {},
  size?: Size,
) => {
  if (!analysis) {
    return getOverallScore(null, faces, extra);
  }

  const clipTerm = clamp(1 - 2 * (analysis.shadowClip + analysis.highlightClip));
  const fixableMean = analysis.meanLuma >= 0.1 && analysis.meanLuma <= 0.9;
  const exposure = Math.max(exposureScore(analysis), fixableMean ? 0.9 * clipTerm : 0);
  const contrast = analysis.contrast >= 0.03 ? Math.max(contrastScore(analysis.contrast), 0.9) : 0;
  const vividness = analysis.saturation >= 0.04 ? Math.max(vividnessScore(analysis.saturation), 0.8) : 0;
  const composition = Math.max(compositionScore(analysis.focusX, analysis.focusY), 0.8);
  const aesthetic = clamp(
    0.35 * colorfulnessScore(analysis.colorfulness) + 0.25 * contrast + 0.2 * vividness + 0.2 * composition,
  );

  const croppable =
    !!size && hasPrintResolution({ width: 1, height: 1, x: 0, y: 0 }, size, undefined, TIGHTEN_MIN_KEEP);
  const people = faceScore(
    croppable ? faces.map((face) => scaleFace(face, 1 / Math.sqrt(TIGHTEN_MIN_KEEP))) : faces,
  ).faceScore;

  return overallScore({
    sharpness: sharpnessScore(analysis.laplacianVariance),
    exposure,
    aesthetic,
    faceScore: people,
    ...extra,
  });
};

const scaleFace = (face: ScoreFace, scale: number): ScoreFace => {
  const cx = (face.x1 + face.x2) / 2;
  const cy = (face.y1 + face.y2) / 2;
  const w = ((face.x2 - face.x1) * scale) / 2;
  const h = ((face.y2 - face.y1) * scale) / 2;
  return { ...face, x1: cx - w, y1: cy - h, x2: cx + w, y2: cy + h };
};

/** what straightening a recommended tilt is worth: the scored metrics can't see a crooked horizon */
export const getTiltValue = (angle: number) => Math.min(0.06, 0.02 + 0.01 * Math.abs(angle));

/**
 * The score of a simulated fix. Blur can't be fixed (and sharpening would only fake detail), so the sharpness of the
 * photo as it is counts; straightening adds the value of a level horizon.
 */
export const getPotentialScore = (
  simulated: ImageAnalysis,
  now: ImageAnalysis,
  faces: ScoreFace[],
  extra: ScoreExtra,
  recipe: ImproveRecipe,
) =>
  getOverallScore({ ...simulated, laplacianVariance: now.laplacianVariance }, faces, extra) +
  (recipe.rotate ? getTiltValue(recipe.rotate) : 0);

/** normalized face boxes of the photo, mapped into the straightened and cropped photo; faces outside are dropped */
export const mapFaces = (faces: ScoreFace[], recipe: Pick<ImproveRecipe, 'rotate' | 'crop'>, size: Size) => {
  const { width, height } = size.width > 0 && size.height > 0 ? size : { width: 1000, height: 1000 };
  let frame = { width, height };
  let boxes = faces.map((face) => ({
    face,
    box: { x1: face.x1 * width, y1: face.y1 * height, x2: face.x2 * width, y2: face.y2 * height } as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    } | null,
  }));

  if (recipe.rotate) {
    const angle = recipe.rotate;
    boxes = boxes.map(({ face, box }) => ({ face, box: box && boxToStraightened(box, width, height, angle) }));
    frame = getStraightenedSize(width, height, angle);
  }

  const crop = recipe.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const left = crop.x * frame.width;
  const top = crop.y * frame.height;
  const cropWidth = crop.width * frame.width;
  const cropHeight = crop.height * frame.height;

  const result: ScoreFace[] = [];
  for (const { face, box } of boxes) {
    if (!box) {
      continue;
    }
    const x1 = clamp((box.x1 - left) / cropWidth);
    const y1 = clamp((box.y1 - top) / cropHeight);
    const x2 = clamp((box.x2 - left) / cropWidth);
    const y2 = clamp((box.y2 - top) / cropHeight);
    if (x2 - x1 > 0.001 && y2 - y1 > 0.001) {
      result.push({ ...face, x1, y1, x2, y2 });
    }
  }
  return result;
};

/**
 * Whether a crop keeps enough pixels: 150 dpi at the print size when it is known, otherwise 12×8 inches at 150 dpi.
 * `keep` shrinks the crop further, e.g. to ask whether a tightening crop would still be large enough.
 */
export const hasPrintResolution = (crop: CropRect, size: Size, printMm?: Size, keep = 1) => {
  if (!(size.width > 0 && size.height > 0)) {
    return false;
  }
  const scale = Math.sqrt(keep);
  const width = crop.width * size.width * scale;
  const height = crop.height * size.height * scale;
  if (printMm && printMm.width > 0 && printMm.height > 0) {
    return Math.min(width / (printMm.width / 25.4), height / (printMm.height / 25.4)) >= MIN_PRINT_DPI;
  }
  return Math.max(width, height) >= MIN_CROP_PIXELS.long && Math.min(width, height) >= MIN_CROP_PIXELS.short;
};

const faceHeight = (face: ScoreFace) => face.y2 - face.y1;

/** whether straightening keeps every face whole: none is lost or ends up at the edge of the straightened photo */
export const keepsFacesStraightened = (faces: ScoreFace[], rotate: number, size: Size) => {
  const mapped = mapFaces(faces, { rotate }, size);
  const edge = 0.002;
  return (
    mapped.length === faces.length &&
    mapped.every((face) => face.x1 > edge && face.y1 > edge && face.x2 < 1 - edge && face.y2 < 1 - edge)
  );
};

/** whether a crop keeps every main face whole with headroom, and cuts no other face */
const keepsFaces = (rect: CropRect, faces: ScoreFace[]) => {
  const largest = Math.max(0, ...faces.map((face) => faceHeight(face)));
  const epsilon = 1e-6;
  return faces.every((face) => {
    const inside =
      face.x1 >= rect.x - epsilon &&
      face.x2 <= rect.x + rect.width + epsilon &&
      face.y1 - FACE_HEADROOM * faceHeight(face) >= rect.y - epsilon &&
      face.y2 <= rect.y + rect.height + epsilon;
    if (inside) {
      return true;
    }
    const outside =
      face.x2 <= rect.x || face.x1 >= rect.x + rect.width || face.y2 <= rect.y || face.y1 >= rect.y + rect.height;
    return outside && faceHeight(face) < MINOR_FACE * largest;
  });
};

/** the composition score of the detail centroid once the photo is cropped to `rect` */
const predictComposition = (focus: { x: number; y: number }, rect: CropRect) =>
  compositionScore(clamp((focus.x - rect.x) / rect.width), clamp((focus.y - rect.y) / rect.height));

/**
 * A crop that keeps the shape of the photo and 85% or 92% of its area, placed to bring the detail (`focus`) closer to
 * a rule-of-thirds point without cutting faces. Null unless the predicted composition clearly improves.
 */
export const chooseTighteningCrop = ({
  focus,
  faces,
}: {
  focus: { x: number; y: number };
  faces: ScoreFace[];
}): CropRect | null => {
  const current = compositionScore(focus.x, focus.y);
  let best: { rect: CropRect; score: number } | undefined;
  for (const keep of TIGHTEN_KEEPS) {
    const side = Math.sqrt(keep);
    for (const fy of [0, 0.5, 1]) {
      for (const fx of [0, 0.5, 1]) {
        const rect = { x: round(fx * (1 - side), 4), y: round(fy * (1 - side), 4), width: side, height: side };
        if (!keepsFaces(rect, faces)) {
          continue;
        }
        const score = predictComposition(focus, rect);
        if (!best || score > best.score + 1e-9) {
          best = { rect: { ...rect, width: round(side, 4), height: round(side, 4) }, score };
        }
      }
    }
  }
  return best && best.score >= current + TIGHTEN_MIN_COMPOSITION_GAIN ? best.rect : null;
};

/** a face-aware crop for a target aspect ratio (see `suggestCrop`), or null when it cuts faces or loses too much */
export const chooseAspectCrop = ({
  size,
  aspectRatio,
  focus,
  faces,
}: {
  size: Size;
  aspectRatio: number | string;
  focus: { x: number; y: number };
  faces: ScoreFace[];
}): CropRect | null => {
  if (!(size.width > 0 && size.height > 0)) {
    return null;
  }
  const { width, height } = size;
  const suggestion = suggestCrop({
    width,
    height,
    aspectRatio: parseAspectRatio(aspectRatio),
    faces: faces.map((face) => ({
      x1: face.x1 * width,
      y1: face.y1 * height,
      x2: face.x2 * width,
      y2: face.y2 * height,
    })),
    saliency: { x: focus.x * width, y: focus.y * height },
  });
  const rect = normalizeRect(suggestion.rect, width, height);
  if (!suggestion.feasible || rect.width * rect.height < 1 - ASPECT_MAX_LOSS || rect.width * rect.height > 0.999) {
    return null;
  }
  return { x: round(rect.x, 4), y: round(rect.y, 4), width: round(rect.width, 4), height: round(rect.height, 4) };
};

export const isEmptyRecipe = (recipe: ImproveRecipe) => !recipe.enhance && !recipe.rotate && !recipe.crop;

/** a stable key of a recipe, for caching the analysis of its result */
export const getRecipeKey = (recipe: ImproveRecipe) =>
  [
    recipe.rotate ? `r${recipe.rotate}` : '',
    recipe.crop
      ? `c${[recipe.crop.x, recipe.crop.y, recipe.crop.width, recipe.crop.height].map((value) => round(value, 4)).join(',')}`
      : '',
    recipe.enhance ? `e${recipe.enhance.strength}` : '',
  ].join('');

/** the stage 1 pool: about 2.5 photos per pick, at least the picks and at most 300 */
export const getPoolSize = (count: number, candidates: number) =>
  Math.min(candidates, Math.max(count, Math.min(IMPROVE_MAX_POOL, Math.ceil(count * IMPROVE_POOL_FACTOR))));

/** an estimate with the gain, and without the fixes when they don't add up to `IMPROVE_MIN_GAIN` */
export const toEstimate = (now: number, potential: number, recipe: ImproveRecipe): ImproveEstimate => {
  const gain = potential - now;
  if (gain < IMPROVE_MIN_GAIN || isEmptyRecipe(recipe)) {
    return { now: round(now), potential: round(now), gain: 0, recipe: {} };
  }
  return { now: round(now), potential: round(potential), gain: round(gain), recipe };
};

/** the recipe as the agent sees it, with its gain */
export const toRecipeResult = (estimate: ImproveEstimate) => ({ ...estimate.recipe, gain: estimate.gain });

const CORRECTION_NAMES: Record<EnhanceCorrectionType, string> = {
  denoise: 'noise reduction',
  whiteBalance: 'white balance',
  levels: 'levels',
  exposure: 'exposure',
  localContrast: 'local contrast',
  saturation: 'vibrance',
  sharpen: 'sharpening',
};

/** e.g. "Improved from IMG_0001.jpg: straightened 2.4°, cropped, auto-enhanced (levels, white balance)" */
export const describeImprovement = (
  fileName: string,
  { rotate, cropped, corrections }: { rotate?: number; cropped: boolean; corrections: EnhanceCorrectionType[] },
) => {
  const parts: string[] = [];
  if (rotate) {
    parts.push(`straightened ${Math.round(Math.abs(rotate) * 10) / 10}°`);
  }
  if (cropped) {
    parts.push('cropped');
  }
  if (corrections.length > 0) {
    parts.push(`auto-enhanced (${corrections.map((type) => CORRECTION_NAMES[type]).join(', ')})`);
  }
  return `Improved from ${fileName}: ${parts.join(', ')}`;
};

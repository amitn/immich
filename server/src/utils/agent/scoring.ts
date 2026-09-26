/** raw metrics returned by `MediaRepository.analyzeImage` */
export type ImageAnalysis = {
  width: number;
  height: number;
  /** variance of the 3x3 Laplacian on the 8-bit greyscale image */
  laplacianVariance: number;
  /** mean luminance, 0..1 */
  meanLuma: number;
  /** fraction of near-black pixels, 0..1 */
  shadowClip: number;
  /** fraction of near-white pixels, 0..1 */
  highlightClip: number;
  /** Hasler–Süsstrunk colourfulness of the 8-bit RGB image: ~15 slightly, ~33 moderately, ~59 quite, ~82 highly colourful */
  colorfulness: number;
  /** standard deviation of the luminance, 0..1 (global contrast) */
  contrast: number;
  /** mean HSV saturation, 0..1 */
  saturation: number;
  /** centroid of the Laplacian energy (where the sharp detail is), as fractions of the width and height */
  focusX: number;
  focusY: number;
};

export type ScoreFace = {
  /** box normalized to 0..1 */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  personId?: string | null;
  name?: string | null;
};

export type PhotoScore = {
  sharpness: number;
  exposure: number;
  faces: number;
  /** largest face area / image area */
  faceArea: number;
  faceScore: number;
  /** colourfulness, contrast, vividness and composition, see `aestheticScore` */
  aesthetic: number;
  overall: number;
};

export type OverallInput = {
  sharpness: number;
  exposure: number;
  faceScore: number;
  /** default 0.5 */
  aesthetic?: number;
  isFavorite?: boolean;
  rating?: number | null;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

const SHARP_LOW = 20;
const SHARP_HIGH = 1500;

/** log curve: 0 for a flat image, ~0.5 at a variance of 150, 1 at 1500 or more */
export const sharpnessScore = (laplacianVariance: number) =>
  clamp(Math.log10(1 + Math.max(0, laplacianVariance) / SHARP_LOW) / Math.log10(1 + SHARP_HIGH / SHARP_LOW));

/** 1 for a mid-tone mean with no clipping; drops for dark/bright means and for clipped shadows/highlights */
export const exposureScore = ({
  meanLuma,
  shadowClip,
  highlightClip,
}: Pick<ImageAnalysis, 'meanLuma' | 'shadowClip' | 'highlightClip'>) => {
  const meanTerm = clamp(1 - ((meanLuma - 0.5) / 0.4) ** 2);
  const clipTerm = clamp(1 - 2 * (shadowClip + highlightClip));
  return clamp(meanTerm * clipTerm);
};

/** 0 without faces, otherwise 0.5..1 growing with the size of the largest face (15% of the frame or more is 1) */
export const faceScore = (faces: ScoreFace[]) => {
  const faceArea = Math.max(0, ...faces.map((face) => clamp(face.x2 - face.x1) * clamp(face.y2 - face.y1)));
  return {
    faces: faces.length,
    faceArea,
    faceScore: faces.length === 0 ? 0 : clamp(0.5 + 0.5 * Math.sqrt(faceArea / 0.15)),
  };
};

/** 0 for a grey image, 1 from "quite colourful" (a Hasler–Süsstrunk colourfulness of 70) on */
export const colorfulnessScore = (colorfulness: number) => clamp(colorfulness / 70);

/** grows to 1 at a luminance standard deviation of 0.22, and drops again for harsh contrast above 0.32 */
export const contrastScore = (contrast: number) =>
  contrast <= 0.32 ? clamp(contrast / 0.22) : clamp(1 - (contrast - 0.32) * 2.5);

/** vivid but not garish: 1 at a mean saturation of 0.4, 0 for grey and for fully saturated images */
export const vividnessScore = (saturation: number) => clamp(1 - ((saturation - 0.4) / 0.4) ** 2);

const THIRDS = [1 / 3, 2 / 3];

/** 1 when the sharp detail is on a rule-of-thirds point, 0.6 when it is centred, less when it is off towards an edge */
export const compositionScore = (focusX: number, focusY: number) => {
  const thirds = Math.min(...THIRDS.flatMap((x) => THIRDS.map((y) => Math.hypot(focusX - x, focusY - y))));
  const centre = Math.hypot(focusX - 0.5, focusY - 0.5);
  return clamp(Math.max(1 - thirds / 0.25, 0.6 * (1 - centre / 0.25)));
};

/** aesthetic = 0.35 colourfulness + 0.25 contrast + 0.2 vividness + 0.2 composition */
export const aestheticScore = ({
  colorfulness,
  contrast,
  saturation,
  focusX,
  focusY,
}: Pick<ImageAnalysis, 'colorfulness' | 'contrast' | 'saturation' | 'focusX' | 'focusY'>) =>
  clamp(
    0.35 * colorfulnessScore(colorfulness) +
      0.25 * contrastScore(contrast) +
      0.2 * vividnessScore(saturation) +
      0.2 * compositionScore(focusX, focusY),
  );

/**
 * overall = 0.4 sharpness + 0.25 exposure + 0.25 aesthetic + 0.10 faces
 *   + 0.10 when favorited, + 0.03 per rating star above/below 3
 */
export const overallScore = ({ sharpness, exposure, faceScore, aesthetic = 0.5, isFavorite, rating }: OverallInput) => {
  let score = 0.4 * sharpness + 0.25 * exposure + 0.25 * aesthetic + 0.1 * faceScore;
  if (isFavorite) {
    score += 0.1;
  }
  if (rating) {
    score += 0.03 * (rating - 3);
  }
  return clamp(score);
};

export const scorePhoto = (
  analysis: ImageAnalysis | null,
  faces: ScoreFace[],
  extra: { isFavorite?: boolean; rating?: number | null } = {},
): PhotoScore => {
  // without an image, assume average technical quality so metadata signals still rank photos
  const sharpness = analysis ? sharpnessScore(analysis.laplacianVariance) : 0.5;
  const exposure = analysis ? exposureScore(analysis) : 0.5;
  const aesthetic = analysis ? aestheticScore(analysis) : 0.5;
  const people = faceScore(faces);
  const overall = overallScore({ sharpness, exposure, aesthetic, faceScore: people.faceScore, ...extra });

  return {
    sharpness: round(sharpness),
    exposure: round(exposure),
    faces: people.faces,
    faceArea: round(people.faceArea),
    faceScore: round(people.faceScore),
    aesthetic: round(aesthetic),
    overall: round(overall),
  };
};

/** normalizes a face box in preview pixels to 0..1 */
export const normalizeFaceBox = (face: {
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  imageWidth: number;
  imageHeight: number;
}) => {
  const width = face.imageWidth || 1;
  const height = face.imageHeight || 1;
  return {
    x1: round(clamp(face.boundingBoxX1 / width), 3),
    y1: round(clamp(face.boundingBoxY1 / height), 3),
    x2: round(clamp(face.boundingBoxX2 / width), 3),
    y2: round(clamp(face.boundingBoxY2 / height), 3),
  };
};

/**
 * Automatic orientation detection: photos stored sideways (turned 90° or 270°) or upside down (180°), from the CLIP
 * embeddings of the preview turned four ways, the faces found in it and the direction of its text (OCR). Only confident
 * cases are suggested; see `test/fixtures/orientation/benchmark.ts` for how well it does on real photos.
 *
 * A view is the stored preview turned clockwise by a rotation. The hypothesis "u" says that the view turned by u is
 * upright, so that turning the photo clockwise by u fixes it.
 */

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** CLIP text prompts of the three classes a view can be in, averaged per class */
export const ORIENTATION_PROMPTS = {
  upright: ['a photo'],
  sideways: ['a sideways photo', 'a photo turned on its side', 'a photo rotated 90 degrees'],
  upsideDown: ['an upside-down photo', 'a photo that is upside down'],
} as const;

export const getOrientationPromptTexts = () => Object.values(ORIENTATION_PROMPTS).flat();

type OrientationClass = keyof typeof ORIENTATION_PROMPTS;
const CLASSES: OrientationClass[] = ['upright', 'sideways', 'upsideDown'];

export type OrientationPrompts = Record<OrientationClass, Float32Array>;

/** a face box in a view, normalized to it */
export type OrientationFace = { x1: number; y1: number; x2: number; y2: number; score: number };

/** an OCR box in a view, normalized to it: its corners from the top left of the text, clockwise */
export type OrientationText = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
  textScore: number;
  /** characters read */
  length: number;
};

export type OrientationSource = {
  /** size of the stored preview (the view at 0°) */
  width: number;
  height: number;
  /** L2-normalized CLIP image embedding of a view */
  getClip: (rotation: Rotation) => Promise<Float32Array>;
  /** faces found in a view; null when face detection is off. The view at 0° is what the library stores */
  getFaces: (rotation: Rotation) => Promise<OrientationFace[] | null>;
  /** text read in a view; null when OCR is off. The view at 0° is what the library stores */
  getText: (rotation: Rotation) => Promise<OrientationText[] | null>;
};

export type OrientationOptions = {
  /** CLIP logit scale of the class probabilities */
  temperature: number;
  /** a stored view this likely upright (by CLIP alone) is not turned, unless faces or text say otherwise */
  prefilter: number;
  /** a turn this likely (by CLIP) is looked at more closely with faces and text */
  candidate: number;
  /** a turn is suggested when it is this likely with all the evidence */
  confident: number;
  /** evidence weights, in nats per unit */
  faceWeight: number;
  textWeight: number;
  /** faces below this score are ignored */
  minFaceScore: number;
};

export const DEFAULT_ORIENTATION_OPTIONS: OrientationOptions = {
  temperature: 100,
  prefilter: 0.62,
  candidate: 0.3,
  confident: 0.7,
  faceWeight: 2,
  textWeight: 1,
  minFaceScore: 0.7,
};

export type OrientationResult = {
  /** the clockwise turn that makes the photo upright, 0 when it is upright */
  rotate: Rotation;
  /** a turn confident enough to suggest */
  flagged: boolean;
  /** probability of the suggested turn, 0 to 1 */
  confidence: number;
  /** why, in words */
  reasons: string[];
  /** CLIP probability of every turn (0, 90, 180, 270), when the views were compared */
  clip?: number[];
  /** what was looked at: the stored view only, the four CLIP views, or faces and text of the candidate too */
  stage: 'prefilter' | 'clip' | 'evidence';
  /** machine learning requests made */
  requests: number;
};

const dot = (a: Float32Array, b: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
};

const normalize = (vector: Float32Array) => {
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
};

/** the class embeddings: the mean of the prompts of each class */
export const getOrientationPrompts = (texts: Map<string, Float32Array> | Record<string, Float32Array>) => {
  const get = (text: string) => (texts instanceof Map ? texts.get(text) : texts[text]);
  const result = {} as OrientationPrompts;
  for (const name of CLASSES) {
    const vectors = ORIENTATION_PROMPTS[name].map((text) => {
      const vector = get(text);
      if (!vector) {
        throw new Error(`Missing the text embedding of "${text}"`);
      }
      return normalize(vector);
    });
    const mean = new Float32Array(vectors[0].length);
    for (const vector of vectors) {
      for (let i = 0; i < mean.length; i++) {
        mean[i] += vector[i];
      }
    }
    result[name] = normalize(mean);
  }
  return result;
};

const logSoftmax = (logits: number[]) => {
  const max = Math.max(...logits);
  const total = Math.log(logits.reduce((sum, value) => sum + Math.exp(value - max), 0)) + max;
  return logits.map((value) => value - total);
};

/** log probabilities of the classes of one view */
const classify = (embedding: Float32Array, prompts: OrientationPrompts, temperature: number) => {
  const [upright, sideways, upsideDown] = logSoftmax(
    CLASSES.map((name) => temperature * dot(embedding, prompts[name])),
  );
  return { upright, sideways, upsideDown };
};

/** the class a view is in under a hypothesis: the view `quarterTurns` quarter turns from upright */
const classOf = (quarterTurns: number): OrientationClass =>
  quarterTurns === 0 ? 'upright' : quarterTurns === 2 ? 'upsideDown' : 'sideways';

const quarters = (rotation: number) => (((Math.round(rotation / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;

const normalizeProbabilities = (logs: number[]) => {
  const max = Math.max(...logs);
  const values = logs.map((value) => Math.exp(value - max));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
};

/**
 * The CLIP probability of every hypothesis (0, 90, 180, 270) from the four views: under hypothesis u, the view u is
 * upright, the views u ± 90 are sideways and the view u + 180 is upside down
 */
export const getClipPosterior = (views: Float32Array[], prompts: OrientationPrompts, temperature: number) => {
  const classes = views.map((view) => classify(view, prompts, temperature));
  return normalizeProbabilities(
    ROTATIONS.map((_, u) => classes.reduce((sum, logs, r) => sum + logs[classOf((r - u + 4) % 4)], 0)),
  );
};

/** the size of a view of the stored preview */
const viewSize = (source: Pick<OrientationSource, 'width' | 'height'>, rotation: Rotation) =>
  quarters(rotation) % 2 === 0
    ? { width: source.width || 1, height: source.height || 1 }
    : { width: source.height || 1, height: source.width || 1 };

/**
 * How much the faces of a view say it is upright: faces that are taller than wide count +1, faces lying on their side
 * (wider than tall) −0.5; face detection rarely finds faces that are upside down or on their side. The faces the
 * library stores have no score, but passed the same minimum
 */
export const getFaceScore = (
  faces: OrientationFace[],
  size: { width: number; height: number },
  minScore = DEFAULT_ORIENTATION_OPTIONS.minFaceScore,
) => {
  let score = 0;
  for (const face of faces) {
    if (face.score < minScore) {
      continue;
    }
    const width = (face.x2 - face.x1) * size.width;
    const height = (face.y2 - face.y1) * size.height;
    score += width <= height * 1.05 ? 1 : -0.5;
  }
  return score;
};

/** whether a text box runs along the view (read left to right), rather than up or down it */
const isHorizontal = (box: OrientationText, size: { width: number; height: number }) => {
  const along = Math.hypot((box.x2 - box.x1) * size.width, (box.y2 - box.y1) * size.height);
  const across = Math.hypot((box.x4 - box.x1) * size.width, (box.y4 - box.y1) * size.height);
  return along >= across;
};

/** the text a view reads well: characters of the lines that run left to right, weighted by how sure OCR is of them */
export const getTextScore = (text: OrientationText[], size: { width: number; height: number }) =>
  text.filter((box) => isHorizontal(box, size)).reduce((sum, box) => sum + box.textScore * box.length, 0);

/** the share of the text boxes of a view that run up or down it, and how many there are */
export const getVerticalText = (text: OrientationText[], size: { width: number; height: number }) => {
  const vertical = text.filter((box) => !isHorizontal(box, size)).length;
  return { count: text.length, share: text.length > 0 ? vertical / text.length : 0 };
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Detects a photo stored sideways or upside down, keeping the machine learning requests bounded: the stored view's CLIP
 * embedding, faces and text are usually known already; when CLIP sees an ordinary upright photo in it (and neither its
 * faces nor its text lie on their side), nothing more is asked. Otherwise the three other views are encoded, and when
 * one of them is the likely upright one, its faces and text are read to confirm (at most 5 requests).
 */
export const detectOrientation = async (
  source: OrientationSource,
  prompts: OrientationPrompts,
  options: OrientationOptions = DEFAULT_ORIENTATION_OPTIONS,
): Promise<OrientationResult> => {
  let requests = 0;
  const stored = await source.getClip(0);
  const storedFaces = await source.getFaces(0);
  const storedText = await source.getText(0);
  const storedSize = viewSize(source, 0);

  const faceScore0 = storedFaces ? getFaceScore(storedFaces, storedSize, options.minFaceScore) : 0;
  const vertical = storedText ? getVerticalText(storedText, storedSize) : { count: 0, share: 0 };
  const sidewaysHint = faceScore0 < 0 || (vertical.count >= 3 && vertical.share >= 0.6);

  const storedClass = classify(stored, prompts, options.temperature);
  if (Math.exp(storedClass.upright) >= options.prefilter && !sidewaysHint) {
    return {
      rotate: 0,
      flagged: false,
      confidence: Math.exp(storedClass.upright),
      reasons: [],
      stage: 'prefilter',
      requests,
    };
  }

  const views = [stored];
  for (const rotation of ROTATIONS.slice(1)) {
    views.push(await source.getClip(rotation));
    requests++;
  }
  const clip = getClipPosterior(views, prompts, options.temperature);
  const best = clip.indexOf(Math.max(...clip));
  const rotate = ROTATIONS[best];
  if (best === 0 || clip[best] < options.candidate) {
    return {
      rotate: 0,
      flagged: false,
      confidence: clip[best],
      reasons: [],
      clip,
      stage: 'clip',
      requests,
    };
  }

  const reasons = [`CLIP: upright when turned ${rotate}° (${percent(clip[best])})`];
  let evidence = 0;

  if (storedFaces) {
    const faces = await source.getFaces(rotate);
    requests++;
    const faceScore = faces ? getFaceScore(faces, viewSize(source, rotate), options.minFaceScore) : 0;
    const delta = faceScore - faceScore0;
    if (delta > 0) {
      reasons.push(`faces: upright when turned`);
    } else if (delta < 0) {
      reasons.push(`faces: upright as stored`);
    }
    evidence += options.faceWeight * delta;
  }

  if (storedText) {
    const text = await source.getText(rotate);
    requests++;
    const read = text ? getTextScore(text, viewSize(source, rotate)) : 0;
    const read0 = getTextScore(storedText, storedSize);
    const delta = Math.log1p(read) - Math.log1p(read0);
    if (delta > 0.5) {
      reasons.push(`text: reads when turned (${Math.round(read)} vs ${Math.round(read0)} characters)`);
    } else if (delta < -0.5) {
      reasons.push(`text: reads as stored (${Math.round(read0)} vs ${Math.round(read)} characters)`);
    }
    evidence += options.textWeight * delta;
  }

  // the evidence moves the odds of the turn against keeping the photo as it is
  const logs = clip.map((p) => Math.log(Math.max(p, 1e-9)));
  logs[best] += evidence;
  const posterior = normalizeProbabilities(logs);
  const confidence = posterior[best];
  return {
    rotate,
    flagged: confidence >= options.confident,
    confidence,
    reasons,
    clip,
    stage: 'evidence',
    requests,
  };
};

/**
 * The edits of an asset with a clockwise turn added after them. Edits are applied in order (crop first), and only one
 * turn is allowed, so the turn is folded into the existing one: a mirror after the turn reverses its direction. A turn
 * that ends at 0° is dropped.
 */
export const addRotation = <
  T extends { action: string; parameters: Record<string, unknown> } = {
    action: string;
    parameters: Record<string, unknown>;
  },
>(
  edits: T[],
  rotate: Rotation,
): T[] => {
  const index = edits.findIndex((edit) => edit.action === 'rotate');
  if (index === -1) {
    return rotate === 0 ? edits : [...edits, { action: 'rotate', parameters: { angle: rotate } } as unknown as T];
  }

  const mirrorsAfter = edits.slice(index + 1).filter((edit) => edit.action === 'mirror').length;
  const current = Number(edits[index].parameters.angle) || 0;
  const angle = (((current + (mirrorsAfter % 2 === 0 ? rotate : -rotate)) % 360) + 360) % 360;
  if (angle === 0) {
    return edits.filter((_, i) => i !== index);
  }
  return edits.map((edit, i) => (i === index ? ({ ...edit, parameters: { angle } } as T) : edit));
};

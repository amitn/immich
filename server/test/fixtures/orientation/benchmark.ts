import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  DEFAULT_ORIENTATION_OPTIONS,
  OrientationFace,
  OrientationOptions,
  OrientationResult,
  OrientationText,
  ROTATIONS,
  Rotation,
  detectOrientation,
  getOrientationPrompts,
} from 'src/utils/orientation.js';

/**
 * A benchmark of the orientation detection (`src/utils/orientation.ts`) on real photos turned synthetically: 37 upright
 * photos of the demo library (21 of a trip to Sicily, five of them with people, and 16 of three restaurant meals: the
 * outside, signs, menus and dishes seen from above), each turned by 0, 90, 180 and 270 degrees as a 1440 px preview.
 * For every turn, `capture-benchmark.mjs` stored the CLIP image embedding (ViT-B-32__openai), the faces found
 * (buffalo_l) and the OCR boxes (PP-OCRv5_mobile) from a machine learning server, and the CLIP text embeddings of the
 * prompts. A photo stored at turn t sees the views t, t + 90, t + 180 and t + 270, and should be turned back by −t.
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons: Sicily (2009) by gnuckx, CC BY 2.0
 * (https://creativecommons.org/licenses/by/2.0); Katz's Delicatessen (2013), The French Laundry (2014) and Noma
 * Australia (2016) by City Foodsters, CC BY 2.0. It holds no images, only their embeddings, faces and text boxes.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

type View = { clip: string; faces: OrientationFace[]; ocr: OrientationText[] };

export type Photo = { key: string; kind: 'sicily' | 'food'; width: number; height: number; rotations: View[] };

export type Fixture = {
  clipModel: string;
  faceModel: string;
  ocrModel: string;
  photos: Photo[];
  texts: Record<string, string>;
};

export const loadFixture = (): Fixture => JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());

export const decode = (base64: string) => {
  const buffer = Buffer.from(base64, 'base64');
  const values = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  const vector = Float32Array.from(values, (value) => value / 32_767);
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
};

export type Outcome = {
  key: string;
  kind: Photo['kind'];
  /** how the photo is stored */
  stored: Rotation;
  result: OrientationResult;
  /** the turn that fixes it */
  expected: Rotation;
};

export type BenchmarkResult = {
  outcomes: Outcome[];
  upright: { photos: number; flagged: number; requests: number };
  rotated: { photos: number; correct: number; wrong: number; missed: number; requests: number };
  byKind: Record<string, { upright: number; falsePositives: number; rotated: number; correct: number; wrong: number }>;
};

export const runBenchmark = async (
  fixture: Fixture,
  options: OrientationOptions = DEFAULT_ORIENTATION_OPTIONS,
): Promise<BenchmarkResult> => {
  const prompts = getOrientationPrompts(
    Object.fromEntries(Object.entries(fixture.texts).map(([text, vector]) => [text, decode(vector)])),
  );
  const outcomes: Outcome[] = [];
  for (const photo of fixture.photos) {
    const clips = photo.rotations.map(({ clip }) => decode(clip));
    for (const stored of ROTATIONS) {
      const view = (rotation: Rotation) => ((stored + rotation) / 90) % 4;
      const sideways = stored === 90 || stored === 270;
      const result = await detectOrientation(
        {
          width: sideways ? photo.height : photo.width,
          height: sideways ? photo.width : photo.height,
          getClip: (rotation) => Promise.resolve(clips[view(rotation)]),
          getFaces: (rotation) => Promise.resolve(photo.rotations[view(rotation)].faces),
          getText: (rotation) => Promise.resolve(photo.rotations[view(rotation)].ocr),
        },
        prompts,
        options,
      );
      outcomes.push({ key: photo.key, kind: photo.kind, stored, result, expected: ((360 - stored) % 360) as Rotation });
    }
  }

  const upright = outcomes.filter(({ stored }) => stored === 0);
  const rotated = outcomes.filter(({ stored }) => stored !== 0);
  const isCorrect = ({ result, expected }: Outcome) => result.flagged && result.rotate === expected;
  const isWrong = ({ result, expected }: Outcome) => result.flagged && result.rotate !== expected;
  const requests = (list: Outcome[]) => list.reduce((sum, { result }) => sum + result.requests, 0);

  const byKind: BenchmarkResult['byKind'] = {};
  for (const kind of new Set(outcomes.map((outcome) => outcome.kind))) {
    const of = (list: Outcome[]) => list.filter((outcome) => outcome.kind === kind);
    byKind[kind] = {
      upright: of(upright).length,
      falsePositives: of(upright).filter(({ result }) => result.flagged).length,
      rotated: of(rotated).length,
      correct: of(rotated).filter((outcome) => isCorrect(outcome)).length,
      wrong: of(rotated).filter((outcome) => isWrong(outcome)).length,
    };
  }

  return {
    outcomes,
    upright: {
      photos: upright.length,
      flagged: upright.filter(({ result }) => result.flagged).length,
      requests: requests(upright),
    },
    rotated: {
      photos: rotated.length,
      correct: rotated.filter((outcome) => isCorrect(outcome)).length,
      wrong: rotated.filter((outcome) => isWrong(outcome)).length,
      missed: rotated.filter(({ result }) => !result.flagged).length,
      requests: requests(rotated),
    },
    byKind,
  };
};

const share = (part: number, whole: number) => `${part}/${whole} (${Math.round((100 * part) / Math.max(1, whole))}%)`;

export const formatReport = (result: BenchmarkResult, verbose = false) => {
  const lines = [
    `orientation: rotated ${share(result.rotated.correct, result.rotated.photos)} fixed, ` +
      `${result.rotated.wrong} wrong turns, ${result.rotated.missed} missed; ` +
      `upright ${share(result.upright.flagged, result.upright.photos)} flagged; ` +
      `${(result.upright.requests / Math.max(1, result.upright.photos)).toFixed(1)} requests per upright photo, ` +
      `${(result.rotated.requests / Math.max(1, result.rotated.photos)).toFixed(1)} per rotated one`,
    ...Object.entries(result.byKind).map(
      ([kind, value]) =>
        `  ${kind}: rotated ${share(value.correct, value.rotated)} fixed, ${value.wrong} wrong; ` +
        `upright ${value.falsePositives}/${value.upright} flagged`,
    ),
  ];
  if (verbose) {
    for (const { key, stored, result: detection, expected } of result.outcomes) {
      lines.push(
        `  ${key} stored ${stored}: ${detection.flagged ? `turn ${detection.rotate}` : 'keep'} ` +
          `(${detection.stage}, ${Math.round(detection.confidence * 100)}%, expected ${expected}) ` +
          detection.reasons.join('; '),
      );
    }
  }
  return lines.join('\n');
};

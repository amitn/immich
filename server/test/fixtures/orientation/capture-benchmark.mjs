#!/usr/bin/env node
// Captures the inputs of the orientation benchmark (`src/utils/orientation.benchmark.spec.ts`) from a machine learning
// server, read-only: for every upright photo, turned by 0, 90, 180 and 270 degrees (clockwise) as a preview of 1440 px,
// its CLIP image embedding, the faces found in it and its OCR boxes; and the CLIP text embeddings of the prompts. The
// photos are turned synthetically, so one capture gives the four ways a photo can be stored.
//
//   IMMICH_ML_URL=http://127.0.0.1:3003 node test/fixtures/orientation/capture-benchmark.mjs \
//     sicily=~/demo-sicily/a.jpg food=~/demo-food/noma/01.jpg ... (or @list.txt of kind=path lines)
//
// Environment: IMMICH_ML_URL (http://127.0.0.1:3003), CLIP_MODEL (ViT-B-32__openai), FACE_MODEL (buffalo_l),
// OCR_MODEL (PP-OCRv5_mobile). The file names are not stored.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json.gz');
const ml = process.env.IMMICH_ML_URL ?? 'http://127.0.0.1:3003';
const clipModel = process.env.CLIP_MODEL ?? 'ViT-B-32__openai';
const faceModel = process.env.FACE_MODEL ?? 'buffalo_l';
const ocrModel = process.env.OCR_MODEL ?? 'PP-OCRv5_mobile';
/** the long edge of an Immich preview */
const PREVIEW_SIZE = 1440;

/** the prompts the detector may compare the photos with (see `ORIENTATION_PROMPTS` in `src/utils/orientation.ts`) */
const PROMPTS = [
  'a photo',
  'an upright photo',
  'a photo taken the right way up',
  'a rotated photo',
  'a sideways photo',
  'a photo turned on its side',
  'a photo rotated 90 degrees',
  'an upside-down photo',
  'a photo that is upside down',
];

/** embeddings as int16 (value * 32767), base64 */
const encodeVector = (values) =>
  Buffer.from(Int16Array.from(values, (value) => Math.round(value * 32_767)).buffer).toString('base64');

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const predict = async (entries, payload) => {
  const form = new FormData();
  form.append('entries', JSON.stringify(entries));
  if (payload.text === undefined) {
    form.append('image', new Blob([payload.image]));
  } else {
    form.append('text', payload.text);
  }
  const response = await fetch(new URL('predict', ml), { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`predict: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const parseVector = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

const clip = async (image) =>
  parseVector((await predict({ clip: { visual: { modelName: clipModel } } }, { image })).clip);

const faces = async (image) => {
  const response = await predict(
    {
      'facial-recognition': {
        detection: { modelName: faceModel, options: { minScore: 0.7 } },
        recognition: { modelName: faceModel },
      },
    },
    { image },
  );
  const { imageWidth: width, imageHeight: height } = response;
  return response['facial-recognition'].map(({ boundingBox: box, score }) => ({
    x1: round(box.x1 / width, 4),
    y1: round(box.y1 / height, 4),
    x2: round(box.x2 / width, 4),
    y2: round(box.y2 / height, 4),
    score: round(score, 3),
  }));
};

const ocr = async (image) => {
  const response = await predict(
    {
      ocr: {
        detection: { modelName: ocrModel, options: { minScore: 0.5, maxResolution: 736 } },
        recognition: { modelName: ocrModel, options: { minScore: 0.8 } },
      },
    },
    { image },
  );
  const { text, box, boxScore, textScore } = response.ocr;
  return text.map((value, i) => {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = box.slice(i * 8, i * 8 + 8).map((v) => round(v, 4));
    return {
      x1,
      y1,
      x2,
      y2,
      x3,
      y3,
      x4,
      y4,
      boxScore: round(boxScore[i], 3),
      textScore: round(textScore[i], 3),
      length: value.length,
    };
  });
};

const capture = async (items) => {
  const photos = [];
  const counts = {};
  for (const item of items) {
    const [kind, path] = item.split('=');
    counts[kind] = (counts[kind] ?? 0) + 1;
    const upright = await sharp(path)
      .rotate()
      .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const rotations = [];
    for (const angle of [0, 90, 180, 270]) {
      const image = angle === 0 ? upright : await sharp(upright).rotate(angle).jpeg({ quality: 85 }).toBuffer();
      rotations.push({ clip: encodeVector(await clip(image)), faces: await faces(image), ocr: await ocr(image) });
    }
    const { width, height } = await sharp(upright).metadata();
    photos.push({ key: `${kind}-${String(counts[kind]).padStart(2, '0')}`, kind, width, height, rotations });
    console.log(photos.at(-1).key, rotations.map((r) => `${r.faces.length}f ${r.ocr.length}t`).join(' | '));
  }

  const texts = {};
  for (const prompt of PROMPTS) {
    const response = await predict({ clip: { textual: { modelName: clipModel } } }, { text: prompt });
    texts[prompt] = encodeVector(parseVector(response.clip));
  }
  return { clipModel, faceModel, ocrModel, photos, texts };
};

// `@list.txt` reads kind=path lines from a file
const items = process.argv
  .slice(2)
  .flatMap((arg) => (arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8').split('\n').filter(Boolean) : [arg]));
const fixture = await capture(items);
writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
console.log(`saved ${FIXTURE}`);

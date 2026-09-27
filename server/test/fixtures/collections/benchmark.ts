import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

/*
 * What the concerts and nature benchmarks share (see `test/fixtures/{concerts,nature}/benchmark.ts`): their fixtures
 * hold the CLIP embeddings of the photos and of the texts of the pack as int16 (value * 32767) in base64, and the texts
 * are added from a machine learning server when the pack's prompts or readings change.
 */

export type TextFixture = { clipModel: string; texts: Record<string, string> };

export const loadGzipJson = <T>(url: URL): T => JSON.parse(gunzipSync(readFileSync(url)).toString()) as T;

/** an L2-normalized embedding */
export const decode = (base64: string) => {
  const buffer = Buffer.from(base64, 'base64');
  const values = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  const vector = Float32Array.from(values, (value) => value / 32_767);
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
};

const encode = (values: number[]) => {
  const vector = Int16Array.from(values, (value) => Math.round(value * 32_767));
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
};

export const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, value, index) => sum + value * b[index], 0);

/**
 * Adds the missing text embeddings to the fixture at `url`, from the machine learning server at `ml`, and drops the
 * ones no longer used
 */
export const updateTexts = async <T extends TextFixture>(url: URL, fixture: T, used: Set<string>, ml: string) => {
  for (const text of used) {
    if (fixture.texts[text]) {
      continue;
    }
    const form = new FormData();
    form.append('entries', JSON.stringify({ clip: { textual: { modelName: fixture.clipModel, options: {} } } }));
    form.append('text', text);
    const response = await fetch(new URL('predict', ml), { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(`Unable to encode "${text}": ${response.status}`);
    }
    const { clip } = (await response.json()) as { clip: string };
    fixture.texts[text] = encode(JSON.parse(clip));
  }
  fixture.texts = Object.fromEntries(Object.entries(fixture.texts).filter(([text]) => used.has(text)));
  writeFileSync(url, gzipSync(JSON.stringify(fixture), { level: 9 }));
};

/** the text embeddings of a benchmark run: the ones it used, and the ones the fixture lacks */
export const getTextEmbedder = (texts: Record<string, string>) => {
  const decoded = new Map(Object.entries(texts).map(([text, value]) => [text, decode(value)]));
  const used = new Set<string>();
  const missing = new Set<string>();
  const embed = (text: string) => {
    used.add(text);
    const embedding = decoded.get(text);
    if (!embedding) {
      missing.add(text);
    }
    return embedding ?? new Float32Array(512);
  };
  return { embed, used, missing };
};

export const normalizeName = (text: string) =>
  text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll('&', 'and')
    .replaceAll(/[^\p{L}\d]+/gu, '');

const bigrams = (text: string) => Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2));

/** the Dice coefficient of the letter pairs of two texts */
export const dice = (a: string, b: string) => {
  const x = bigrams(a);
  const pool = bigrams(b);
  const total = x.length + pool.length;
  let shared = 0;
  for (const gram of x) {
    const index = pool.indexOf(gram);
    if (index === -1) {
      continue;
    }

    shared++;
    pool.splice(index, 1);
  }
  return total > 0 ? (2 * shared) / total : 0;
};

/**
 * a name read is the expected one, give or take OCR noise and what it left out: "Sidney Gih" for "Sidney Gish",
 * "Beths" for "The Beths", "Cherryglazerr" for "Cherry Glazerr", "Pretudice" for "Prejudice"
 */
export const isSameName = (expected: string, read: string, threshold = 0.7) => {
  const a = normalizeName(expected);
  const b = normalizeName(read);
  if (!a || !b) {
    return false;
  }
  return a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) || dice(a, b) >= threshold;
};

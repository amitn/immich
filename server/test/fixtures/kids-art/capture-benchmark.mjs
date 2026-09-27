#!/usr/bin/env node
// Captures the inputs of the kids' art benchmark (`src/utils/collections/packs/kids-art/benchmark.spec.ts`) from a
// running Immich instance, read-only, as `test/fixtures/reading/capture-benchmark.mjs` does: the capture times, CLIP
// image embeddings, stored OCR and face counts of every artwork (SELECT), and the tiled full-resolution OCR of each
// (machine learning OCR on crops of the originals in the set's folder). The CLIP text embeddings of the prompts are
// added by the spec (KIDS_ART_BENCHMARK_ML).
//
// Children's names never reach the fixture. Every name of `NAMES` (the children, their families, the people the
// letters are written to) is replaced in the OCR and the ground truth by a placeholder name, as read and misread by
// a letter or two, and the sets are stored under neutral keys; the file names are only used to find the photos. The
// script fails when a name is still in the fixture.
//
//   node test/fixtures/kids-art/capture-benchmark.mjs ~/immich-acp-dev/demo-kids-art/*/
//
// Environment: as the reading capture (IMMICH_USER, IMMICH_ML_URL, DB_URL, CLIP_MODEL, OCR_MODEL), and
// KIDS_ART_NAMES_FILE: a JSON file outside the repository with the names of each folder, { "<folder>": { "key":
// "<neutral key>", "names": [["<name as written>", "<placeholder>"], ...] } }.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import postgres from 'postgres';
import { getAsset, readTiles } from '../reading/capture-benchmark.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json.gz');
const clipModel = process.env.CLIP_MODEL ?? 'ViT-B-32__openai';
const ocrModel = process.env.OCR_MODEL ?? 'PP-OCRv5_mobile';
const NAMES = JSON.parse(readFileSync(process.env.KIDS_ART_NAMES_FILE, 'utf8'));

const fold = (text) =>
  text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase();

const editDistance = (a, b) => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
};

/**
 * a word that is a name, or a name read with a few letters wrong ("Ullerto" or "dollerto" for the name it replaces):
 * more is replaced than needed rather than less
 */
const isName = (word, name) => {
  const [a, b] = [fold(word), fold(name)];
  if (a === b) {
    return true;
  }
  return b.length >= 5 && a.length >= 4 && editDistance(a, b) <= (b.length >= 7 ? 3 : 2);
};

/**
 * the text with every name replaced by its placeholder, in the case it is written in: as written, or (in the OCR)
 * misread
 */
const scrub = (text, names, fuzzy) => {
  let result = text;
  // names of several words (or syllables) first, as written
  for (const [name, placeholder] of names.filter(([name]) => /\s/.test(name))) {
    result = result.replaceAll(new RegExp(name.replaceAll(/\s+/g, String.raw`\s*`), 'giu'), placeholder);
  }
  const single = names.filter(([name]) => !/\s/.test(name));
  return result.replaceAll(/[\p{L}]+/gu, (word) => {
    const found =
      single.find(([name]) => fold(word) === fold(name)) ??
      (fuzzy ? single.find(([name]) => isName(word, name)) : undefined);
    if (!found) {
      return word;
    }
    const placeholder = found[1];
    return word === word.toUpperCase() ? placeholder.toUpperCase() : placeholder;
  });
};

/** the text of OCR (read, and misread) is scrubbed of names read with a few letters wrong too */
const OCR_KEYS = new Set(['ocr', 'passes']);

const scrubValue = (value, names, fuzzy = false) => {
  if (typeof value === 'string') {
    return scrub(value, names, fuzzy);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, names, fuzzy));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubValue(item, names, fuzzy || OCR_KEYS.has(key))]),
    );
  }
  return value;
};

const main = async (folders) => {
  const sql = postgres(process.env.DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/immich');
  const sets = [];
  for (const folder of folders) {
    const { key, names } = NAMES[basename(resolve(folder))];
    const expected = JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'));
    const photos = [];
    for (const [index, work] of expected.works.entries()) {
      const asset = await getAsset(sql, work.file);
      const started = Date.now();
      const tiled = await readTiles(join(folder, work.file));
      photos.push({
        n: String(index + 1).padStart(2, '0'),
        work: work.entry,
        ...(work.page && { page: work.page }),
        // a scan: the capture time is when it was imported
        scan: !work.dateTimeOriginal,
        text: work.text,
        names: work.namesOnArtwork,
        time: asset.time,
        faces: asset.faces,
        embedding: asset.embedding,
        ocr: asset.ocr,
        ...tiled,
        tiledMs: Date.now() - started,
      });
      console.log(key, work.entry, photos.at(-1).tiledMs);
    }
    photos.sort((a, b) => a.time - b.time || a.n.localeCompare(b.n));
    const works = Object.fromEntries(
      // the artist is kept as its placeholder, to score the grouping by child
      Object.entries(expected.entries).map(([id, { title, artist, age, date }]) => [id, { title, artist, age, date }]),
    );
    sets.push(scrubValue({ key, works, photos }, names));
  }
  await sql.end();

  const fixture = { clipModel, ocrModel, sets, texts: {} };
  // the text of the fixture, without the embeddings (base64, whose letters could spell anything)
  const text = JSON.stringify(fixture, (key, value) => (key === 'embedding' ? undefined : value));
  const words = new Set(fold(text).match(/\p{L}+/gu));
  const left = Object.values(NAMES)
    .flatMap(({ names }) => names.map(([name]) => name))
    .filter((name) => fold(name).split(/\s+/).length === 1 && words.has(fold(name)));
  if (left.length > 0) {
    throw new Error(`names left in the fixture: ${left.length}`);
  }
  return fixture;
};

const fixture = await main(process.argv.slice(2));
writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
console.log(`saved ${FIXTURE}`);

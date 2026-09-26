#!/usr/bin/env node
// Captures the inputs of the wine benchmark (`src/utils/collections/packs/wine/benchmark.spec.ts`) from a running
// Immich instance, read-only: the stored OCR of every photo (GET /assets/:id/ocr), the tiled full-resolution OCR of the
// bottle and sign photos (machine learning OCR on crops of the originals, as `CollectionService.getDetailedOcr` reads
// them) and how long it took, the CLIP image embeddings of every photo (SELECT from smart_search), their capture times,
// and the times and places of the photos another pack (Food) tagged on the same days (SELECT, for the link of a
// tasting to a meal). The CLIP text embeddings of the prompts are added by the spec (WINE_BENCHMARK_ML).
//
// Every tasting is a folder with the originals and an `expected.json`: the labels of each bottle photo (producer,
// wine, vintage and region as printed, null where not visible), the signs and the other shots. The file names are
// only used to find the photos, never stored.
//
//   IMMICH_API_KEY_FILE=demo-user.txt node test/fixtures/wine/capture-benchmark.mjs ~/demo-wine/*/
//
// Environment: IMMICH_URL (http://127.0.0.1:2283/api), IMMICH_API_KEY (or IMMICH_API_KEY_FILE), IMMICH_ML_URL
// (http://127.0.0.1:3003), DB_URL (postgres://postgres:postgres@127.0.0.1:5432/immich), CLIP_MODEL (ViT-B-32__openai),
// OCR_MODEL (PP-OCRv5_mobile).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import postgres from 'postgres';
import sharp from 'sharp';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json.gz');
const api = process.env.IMMICH_URL ?? 'http://127.0.0.1:2283/api';
const ml = process.env.IMMICH_ML_URL ?? 'http://127.0.0.1:3003';
const clipModel = process.env.CLIP_MODEL ?? 'ViT-B-32__openai';
const ocrModel = process.env.OCR_MODEL ?? 'PP-OCRv5_mobile';
const readKey = (file) => {
  const text = readFileSync(file, 'utf8');
  return (/^apikey=(.*)$/m.exec(text)?.[1] ?? text).trim();
};
const apiKey = process.env.IMMICH_API_KEY_FILE ? readKey(process.env.IMMICH_API_KEY_FILE) : process.env.IMMICH_API_KEY;
const headers = { 'x-api-key': apiKey ?? '', accept: 'application/json' };

// the same reading as CollectionService.getDetailedOcr
const SOURCE_DECODE_SIZE = 4096;
const SOURCE_TILE_SIZE = 1600;
const TILE_OVERLAP = 0.15;
const SOURCE_WHOLE_SIZE = 2048;
const SOURCE_WHOLE_RESOLUTION = 1280;
const OCR = { minDetectionScore: 0.5, minRecognitionScore: 0.6, maxResolution: 736 };

/** embeddings as int16 (value * 32767), base64 */
const encodeVector = (values) =>
  Buffer.from(Int16Array.from(values, (value) => Math.round(value * 32_767)).buffer).toString('base64');

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const getJson = async (path) => {
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GET ${path}: ${response.status}`);
  }
  return response.json();
};

const ocr = async (image, maxResolution) => {
  const form = new FormData();
  form.append(
    'entries',
    JSON.stringify({
      ocr: {
        detection: { modelName: ocrModel, options: { minScore: OCR.minDetectionScore, maxResolution } },
        recognition: { modelName: ocrModel, options: { minScore: OCR.minRecognitionScore } },
      },
    }),
  );
  form.append('image', new Blob([image]));
  const response = await fetch(new URL('predict', ml), { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`predict: ${response.status} ${await response.text()}`);
  }
  const { text, box, boxScore, textScore } = (await response.json()).ocr;
  return {
    text,
    box: box.map((value) => round(value, 5)),
    boxScore: boxScore.map((value) => round(value, 3)),
    textScore: textScore.map((value) => round(value, 3)),
  };
};

/** the tiles of CollectionService.getDetailedOcr (see getOcrTiles in src/utils/collections/tiles.ts) */
const getTiles = (width, height, tileSize, overlap) => {
  const columns = Math.max(1, Math.round(width / tileSize));
  const rows = Math.max(1, Math.round(height / tileSize));
  if (columns * rows === 1) {
    return [];
  }
  const tileWidth = Math.min(width, Math.ceil((width / columns) * (1 + overlap)));
  const tileHeight = Math.min(height, Math.ceil((height / rows) * (1 + overlap)));
  const stepX = columns > 1 ? (width - tileWidth) / (columns - 1) : 0;
  const stepY = rows > 1 ? (height - tileHeight) / (rows - 1) : 0;
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push({ x: Math.round(column * stepX), y: Math.round(row * stepY), width: tileWidth, height: tileHeight });
    }
  }
  return tiles;
};

const readTiles = async (path) => {
  const { data, info } = await sharp(path).rotate().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const crop = async (rect, maxSize) => {
    const left = Math.min(Math.max(Math.round(rect.x), 0), width - 1);
    const top = Math.min(Math.max(Math.round(rect.y), 0), height - 1);
    return sharp(data, { raw: { width, height, channels } })
      .extract({
        left,
        top,
        width: Math.max(1, Math.min(Math.round(rect.width), width - left)),
        height: Math.max(1, Math.min(Math.round(rect.height), height - top)),
      })
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
  };
  const read = async (rect, maxSize, maxResolution) => {
    const fit = Math.min(1, maxSize / Math.max(rect.width, rect.height));
    const shortSide = Math.round(Math.min(rect.width, rect.height) * fit);
    const output = await ocr(
      await crop(rect, maxSize),
      Math.max(OCR.maxResolution, Math.min(maxResolution, shortSide)),
    );
    return { rect, output };
  };

  const scale = Math.min(1, SOURCE_DECODE_SIZE / Math.max(width, height));
  const tiles = getTiles(width * scale, height * scale, SOURCE_TILE_SIZE, TILE_OVERLAP).map((tile) => ({
    x: tile.x / scale,
    y: tile.y / scale,
    width: tile.width / scale,
    height: tile.height / scale,
  }));
  const passes = [await read({ x: 0, y: 0, width, height }, SOURCE_WHOLE_SIZE, SOURCE_WHOLE_RESOLUTION)];
  for (const tile of tiles) {
    passes.push(await read(tile, Math.ceil(SOURCE_TILE_SIZE * (1 + TILE_OVERLAP)), SOURCE_TILE_SIZE));
  }
  return { width, height, passes };
};

const toBoxes = (rows) =>
  rows.map(({ x1, y1, x2, y2, x3, y3, x4, y4, text, boxScore, textScore }) => ({
    ...Object.fromEntries(Object.entries({ x1, y1, x2, y2, x3, y3, x4, y4 }).map(([k, v]) => [k, round(v, 5)])),
    text,
    boxScore: round(boxScore, 3),
    textScore: round(textScore, 3),
  }));

const DAY = 24 * 60 * 60 * 1000;

const capture = async (folders) => {
  const { assets } = await fetch(`${api}/search/metadata`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ size: 1000, withExif: true }),
  }).then((response) => response.json());
  const byFile = new Map(assets.items.map((asset) => [asset.originalFileName, asset]));
  const sql = postgres(process.env.DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/immich');

  const sessions = [];
  for (const folder of folders) {
    const expected = JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'));
    const files = [
      ...expected.bottles.map(({ file, labels }) => ({ file, kind: 'bottle', labels })),
      ...expected.signs.map((file) => ({ file, kind: 'sign' })),
      ...expected.other.map(({ file, kind }) => ({ file, kind })),
    ];
    const photos = [];
    for (const { file, kind, labels } of files) {
      const asset = byFile.get(file);
      if (!asset) {
        throw new Error(`${file} is not in the library`);
      }
      const [row] = await sql`select embedding::text as embedding from smart_search where "assetId" = ${asset.id}`;
      const photo = {
        // the number of the photo in its folder, e.g. 07
        n: file.slice(0, 2),
        kind,
        time: new Date(asset.localDateTime).getTime(),
        ...(labels && { labels }),
        embedding: encodeVector(JSON.parse(row.embedding)),
        ocr: toBoxes(await getJson(`/assets/${asset.id}/ocr`)),
      };
      if (kind === 'bottle' || kind === 'sign') {
        const started = Date.now();
        Object.assign(photo, await readTiles(join(folder, file)));
        photo.tiledMs = Date.now() - started;
      }
      photos.push(photo);
      console.log(basename(folder), kind, file.slice(0, 50), photo.tiledMs ?? '');
    }
    photos.sort((a, b) => a.time - b.time);

    // the photos of other packs (Food) on the same days, by the local time and place of their tags
    const first = Math.min(...photos.map(({ time }) => time));
    const last = Math.max(...photos.map(({ time }) => time));
    const tagged = await sql`
      select a."localDateTime" as time, t.value from asset a
      join tag_asset ta on ta."assetId" = a.id join tag t on t.id = ta."tagId"
      where t.value like 'Food/%' and a."deletedAt" is null
        and a."localDateTime" between ${new Date(first - DAY)} and ${new Date(last + DAY)}`;
    const linked = tagged
      .map(({ time, value }) => ({ time: new Date(time).getTime(), tag: value.split('/').slice(0, 2).join('/') }))
      .toSorted((a, b) => a.time - b.time);

    sessions.push({ key: basename(resolve(folder)), title: expected.session, photos, linked });
  }
  await sql.end();
  return { clipModel, ocrModel, sessions, texts: {} };
};

const fixture = await capture(process.argv.slice(2));
writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
console.log(`saved ${FIXTURE}`);

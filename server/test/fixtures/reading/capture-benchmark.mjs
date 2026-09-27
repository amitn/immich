#!/usr/bin/env node
// Captures the inputs of the reading benchmark (`src/utils/collections/packs/reading/benchmark.spec.ts`) from a running
// Immich instance, read-only: the photos of each set are found by their file names in the database (SELECT), with
// their capture times, sizes and CLIP image embeddings (SELECT from smart_search) and their stored OCR (SELECT from
// asset_ocr); the book photos are also read with the tiled full-resolution OCR of `CollectionService.getDetailedOcr`
// (machine learning OCR on crops of the originals in the set's folder). The CLIP text embeddings of the prompts are
// added by the spec (READING_BENCHMARK_ML).
//
// Every set is a folder with the originals and an `expected.json`: the books (title, author, year, publisher, place)
// and, for each photo, the book it shows (null for a venue) and its kind (title page, cover, open book, venue). The
// file names are only used to find the photos, never stored.
//
//   node test/fixtures/reading/capture-benchmark.mjs ~/immich-acp-dev/demo-reading/*/
//
// Environment: IMMICH_USER (demo@immich.dev), IMMICH_ML_URL (http://127.0.0.1:3003),
// DB_URL (postgres://postgres:postgres@127.0.0.1:5432/immich), CLIP_MODEL (ViT-B-32__openai), OCR_MODEL
// (PP-OCRv5_mobile).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import postgres from 'postgres';
import sharp from 'sharp';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json.gz');
const ml = process.env.IMMICH_ML_URL ?? 'http://127.0.0.1:3003';
const clipModel = process.env.CLIP_MODEL ?? 'ViT-B-32__openai';
const ocrModel = process.env.OCR_MODEL ?? 'PP-OCRv5_mobile';
const user = process.env.IMMICH_USER ?? 'demo@immich.dev';

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

export const readTiles = async (path) => {
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

/** the asset of a file of the user, its capture time, CLIP embedding and stored OCR */
export const getAsset = async (sql, file) => {
  const [asset] = await sql`
    select a.id, a."localDateTime" from asset a join "user" u on u.id = a."ownerId"
    where u.email = ${user} and a."originalFileName" = ${file} and a."deletedAt" is null`;
  if (!asset) {
    throw new Error(`${file} is not in the library of ${user}`);
  }
  const [row] = await sql`select embedding::text as embedding from smart_search where "assetId" = ${asset.id}`;
  const boxes = await sql`
    select x1, y1, x2, y2, x3, y3, x4, y4, text, "boxScore", "textScore" from asset_ocr
    where "assetId" = ${asset.id} and "isVisible" order by id`;
  const [faces] = await sql`select count(*)::int as count from asset_face where "assetId" = ${asset.id}`;
  return {
    time: new Date(asset.localDateTime).getTime(),
    embedding: encodeVector(JSON.parse(row.embedding)),
    ocr: toBoxes(boxes),
    faces: faces.count,
  };
};

const main = async (folders) => {
  const sql = postgres(process.env.DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/immich');
  const sets = [];
  for (const folder of folders) {
    const expected = JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'));
    const photos = [];
    for (const photo of expected.photos) {
      const asset = await getAsset(sql, photo.file);
      const started = Date.now();
      const tiled = photo.kind === 'venue' ? {} : await readTiles(join(folder, photo.file));
      photos.push({
        // the number of the photo in its folder, e.g. 07
        n: photo.file.slice(0, 2),
        kind: photo.kind,
        book: photo.entry,
        script: photo.script,
        time: asset.time,
        embedding: asset.embedding,
        ocr: asset.ocr,
        ...tiled,
        ...(photo.kind !== 'venue' && { tiledMs: Date.now() - started }),
      });
      console.log(basename(folder), photo.kind, photo.file.slice(0, 50));
    }
    photos.sort((a, b) => a.time - b.time);
    const books = Object.fromEntries(
      Object.entries(expected.entries).map(([id, { title, titleShort, author, year, publisher, place }]) => [
        id,
        { title, titleShort, author, year, publisher, place },
      ]),
    );
    sets.push({ key: basename(resolve(folder)), title: expected.collection, books, photos });
  }
  await sql.end();
  return { clipModel, ocrModel, sets, texts: {} };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await main(process.argv.slice(2));
  writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
  console.log(`saved ${FIXTURE}`);
}

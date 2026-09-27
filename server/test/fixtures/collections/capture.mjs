// The read-only capture of the inputs of a pack benchmark from a running Immich instance, shared by the capture
// scripts of the concerts and nature benchmarks (`test/fixtures/{concerts,nature}/capture-benchmark.mjs`): the stored
// OCR of a photo (GET /assets/:id/ocr), the tiled full-resolution OCR of a source photo (machine learning OCR on crops
// of the original, as `CollectionService.getDetailedOcr` reads it), the CLIP image embedding (SELECT from
// smart_search), the local capture time and the location. Nothing is written to the instance: the photos are found by
// their file names with GET and SELECT only.
//
// Environment: IMMICH_URL (http://127.0.0.1:2283/api), IMMICH_API_KEY (or IMMICH_API_KEY_FILE), IMMICH_ML_URL
// (http://127.0.0.1:3003), DB_URL (postgres://postgres:postgres@127.0.0.1:5432/immich), CLIP_MODEL (ViT-B-32__openai),
// OCR_MODEL (PP-OCRv5_mobile).
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import sharp from 'sharp';

const api = process.env.IMMICH_URL ?? 'http://127.0.0.1:2283/api';
const ml = process.env.IMMICH_ML_URL ?? 'http://127.0.0.1:3003';
export const clipModel = process.env.CLIP_MODEL ?? 'ViT-B-32__openai';
export const ocrModel = process.env.OCR_MODEL ?? 'PP-OCRv5_mobile';

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
export const encodeVector = (values) =>
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

/** the size of the original as displayed, and the passes of the tiled OCR */
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

/**
 * A reader of the photos of the user of the API key, by file name: `read(file, { tiles })` gives what a benchmark
 * keeps of a photo, with the tiled OCR of the original at `tiles` (a path) for a source
 */
export const openLibrary = async () => {
  const sql = postgres(process.env.DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/immich');
  const { id: userId } = await getJson('/users/me');
  const read = async (file, { tiles } = {}) => {
    const [asset, other] = await sql`
      select a.id, a."localDateTime", e.latitude, e.longitude
      from asset a left join asset_exif e on e."assetId" = a.id
      where a."ownerId" = ${userId} and a."originalFileName" = ${file} and a."deletedAt" is null`;
    if (!asset || other) {
      throw new Error(`${file} is ${asset ? 'in the library twice' : 'not in the library'}`);
    }
    const [row] = await sql`select embedding::text as embedding from smart_search where "assetId" = ${asset.id}`;
    return {
      time: new Date(asset.localDateTime).getTime(),
      embedding: encodeVector(JSON.parse(row.embedding)),
      ocr: toBoxes(await getJson(`/assets/${asset.id}/ocr`)),
      ...(asset.latitude !== null && { latitude: asset.latitude, longitude: asset.longitude }),
      ...(tiles && (await readTiles(tiles))),
    };
  };
  return { read, close: () => sql.end() };
};

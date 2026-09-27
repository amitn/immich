#!/usr/bin/env node
// Captures the inputs of the travel benchmark (`src/utils/collections/packs/travel/benchmark.spec.ts`) from a running
// Immich instance, read-only: the stored OCR of every photo (GET /assets/:id/ocr), the tiled full-resolution OCR of
// the travel documents (machine learning OCR on crops of the originals, as `CollectionService.getDetailedOcr` reads a
// source), the CLIP image embeddings of every photo (SELECT from smart_search) and their capture times.
//
// Every trip is a folder with the originals and an `expected.json`: { trip, legs: [{ id, date, label, mode }],
// documents: [{ file, leg, personal: [{ field, value }], number }], photos: [{ file, leg }] }. The file names are only
// used to find the photos: the fixture keys them by their number ("05" for 05_KTEL-Ticket_Chania-Sougia.jpg).
//
// Personal fields never reach the fixture: every value of a document's `personal` list (a name, a booking reference, a
// ticket number, a barcode's digits...) is replaced in its OCR by a placeholder of the same shape (digits by digits,
// letters by letters) before the fixture is written, and only the placeholders are kept, as the strings the
// benchmark asserts never leak. Values that `expected.json` only describes ("CHEN, [given name blurred] MS") are
// reduced to their words; more can be listed in a file outside the repository, TRAVEL_PERSONAL_FILE:
// { "<file>": ["<value>", ...] }.
//
//   IMMICH_API_KEY_FILE=demo-user.txt node test/fixtures/travel/capture-benchmark.mjs ~/demo-travel/*/
//
// Environment: IMMICH_URL (http://127.0.0.1:2283/api), IMMICH_API_KEY (or IMMICH_API_KEY_FILE), IMMICH_ML_URL
// (http://127.0.0.1:3003), DB_URL (postgres://postgres:postgres@127.0.0.1:5432/immich), CLIP_MODEL
// (ViT-B-32__openai), OCR_MODEL (PP-OCRv5_mobile), TRAVEL_PERSONAL_FILE.
import { createHash } from 'node:crypto';
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
const extraPersonal = process.env.TRAVEL_PERSONAL_FILE
  ? JSON.parse(readFileSync(process.env.TRAVEL_PERSONAL_FILE, 'utf8'))
  : {};

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

const predict = async (entries, image) => {
  const form = new FormData();
  form.append('entries', JSON.stringify(entries));
  form.append('image', new Blob([image]));
  const response = await fetch(new URL('predict', ml), { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`predict: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const ocr = async (image, maxResolution) => {
  const response = await predict(
    {
      ocr: {
        detection: { modelName: ocrModel, options: { minScore: OCR.minDetectionScore, maxResolution } },
        recognition: { modelName: ocrModel, options: { minScore: OCR.minRecognitionScore } },
      },
    },
    image,
  );
  const { text, box, boxScore, textScore } = response.ocr;
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

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'MSTR', 'DR', 'MX']);
const FLIGHT_NUMBER = /^[A-Z\d]{2}\s?\d{1,4}$/;

/** the strings of a personal value that can be read on the document: codes, numbers and the words of a name */
const toSecrets = (value) => {
  if (!value) {
    return [];
  }
  const plain = value
    .replaceAll(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replaceAll('…', ' ')
    .trim();
  if (/\p{Ll}{3}/u.test(plain)) {
    // a description: only the codes in it
    return [...plain.matchAll(/[A-Z]*\d[A-Z\d]{3,}/g)].map(([code]) => code);
  }
  if (/\d/.test(plain)) {
    const compact = plain.replaceAll(/\s+/g, '');
    return [...new Set([plain, compact, ...(plain.match(/\d{4,}/g) ?? [])])];
  }
  return plain
    .split(/[\s,/]+/)
    .filter((word) => word.replaceAll(/[^\p{L}]/gu, '').length >= 2 && !HONORIFICS.has(word.toUpperCase()));
};

/** ticket and receipt serial numbers: not personal, but never to be returned by the pack */
const toSerials = (number) =>
  number && !FLIGHT_NUMBER.test(number.trim())
    ? (number.match(/\d[\d ]{3,}\d/g) ?? [])
        .map((value) => value.replaceAll(' ', ''))
        .filter((value) => value.length >= 5)
    : [];

/** a placeholder of the same shape: digits by digits, letters by letters, the rest kept */
const toPlaceholder = (secret) => {
  const hash = createHash('sha256').update(`travel-benchmark:${secret}`).digest();
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const result = [...secret]
    .map((char, index) => {
      const byte = hash[index % hash.length];
      if (/\d/.test(char)) {
        return String((byte + index) % 10);
      }
      if (/\p{Lu}/u.test(char)) {
        return letters[byte % letters.length];
      }
      if (/\p{Ll}/u.test(char)) {
        return letters[byte % letters.length].toLowerCase();
      }
      return char;
    })
    .join('');
  return result === secret ? `${result.slice(0, -1)}${result.at(-1) === '0' ? '1' : '0'}` : result;
};

const escape = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** a letter may follow a number ("6952448946707Y/V"), but not another letter; a digit may follow a word, not a digit */
const boundaries = (secret) => {
  const edge = (char) => (/\d/.test(char) ? String.raw`\d` : String.raw`\p{L}`);
  return [`(?<!${edge(secret[0])})`, `(?!${edge(secret.at(-1))})`];
};

const hamming = (a, b) => [...a].filter((char, index) => char !== b[index]).length;

/**
 * replaces the secrets in the text of OCR boxes (stored rows or ML passes): as read, and misread by a character
 * (a token of the same length that differs in one place)
 */
const scrub = (texts, replacements) =>
  texts.map((text) => {
    let result = text;
    for (const [secret, placeholder] of replacements) {
      const [before, after] = boundaries(secret);
      result = result.replaceAll(new RegExp(`${before}${escape(secret)}${after}`, 'gu'), placeholder);
    }
    return result.replaceAll(/[\p{L}\d]{5,}/gu, (token) => {
      const near = replacements.find(
        ([secret]) => secret.length === token.length && !/\s/.test(secret) && hamming(secret, token) === 1,
      );
      return near ? toPlaceholder(token) : token;
    });
  });

const save = (fixture) => writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));

const capture = async (folders) => {
  const { assets } = await fetch(`${api}/search/metadata`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ size: 1000, withExif: true }),
  }).then((response) => response.json());
  const byFile = new Map(assets.items.map((asset) => [asset.originalFileName, asset]));
  const sql = postgres(process.env.DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/immich');

  const trips = [];
  for (const folder of folders) {
    const expected = JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'));
    const photos = [];
    const add = async (file, kind, entry) => {
      const asset = byFile.get(file);
      if (!asset) {
        throw new Error(`${file} is not in the library`);
      }
      const [row] = await sql`select embedding::text as embedding from smart_search where "assetId" = ${asset.id}`;
      const photo = {
        key: file.slice(0, 2),
        kind,
        leg: entry.leg,
        time: new Date(asset.localDateTime).getTime(),
        width: asset.exifInfo?.exifImageWidth,
        height: asset.exifInfo?.exifImageHeight,
        embedding: row ? encodeVector(JSON.parse(row.embedding)) : undefined,
        ocr: toBoxes(await getJson(`/assets/${asset.id}/ocr`)),
      };
      if (kind === 'document') {
        const secrets = [
          ...(entry.personal ?? []).flatMap(({ value }) => toSecrets(value)),
          ...(extraPersonal[file] ?? []),
        ].toSorted((a, b) => b.length - a.length);
        const replacements = [...new Set(secrets)].map((secret) => [secret, toPlaceholder(secret)]);
        const tiled = await readTiles(join(folder, file));
        if ((entry.personal ?? []).some(({ field }) => /barcode/i.test(field))) {
          // the digits of a barcode, as OCR reads them in part or with letters for digits ("D000001E225")
          const readings = [...photo.ocr.map(({ text }) => text), ...tiled.passes.flatMap(({ output }) => output.text)];
          for (const [code] of readings.join('\n').matchAll(/[A-Z\d]{8,}/g)) {
            if ((code.match(/\d/g)?.length ?? 0) >= 6 && !replacements.some(([secret]) => secret === code)) {
              replacements.push([code, toPlaceholder(code)]);
              secrets.push(code);
            }
          }
        }
        photo.width = tiled.width;
        photo.height = tiled.height;
        photo.passes = tiled.passes.map(({ rect, output }) => ({
          rect,
          output: { ...output, text: scrub(output.text, replacements) },
        }));
        const texts = scrub(
          photo.ocr.map(({ text }) => text),
          replacements,
        );
        photo.ocr = photo.ocr.map((box, index) => ({ ...box, text: texts[index] }));
        photo.personal = replacements.map(([, placeholder]) => placeholder);
        photo.serials = toSerials(entry.number);
        const leaks = [photo.ocr.map(({ text }) => text), ...photo.passes.map(({ output }) => output.text)]
          .flat()
          .filter((text) => secrets.some((secret) => text.includes(secret)));
        if (leaks.length > 0) {
          throw new Error(`${file}: personal values left in the OCR`);
        }
      }
      photos.push(photo);
      console.log(basename(folder), kind, file.slice(0, 50));
    };
    for (const document of expected.documents) {
      await add(document.file, 'document', document);
    }
    for (const photo of expected.photos) {
      await add(photo.file, 'photo', photo);
    }
    photos.sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
    trips.push({
      key: basename(resolve(folder)),
      trip: expected.trip,
      legs: expected.legs.map(({ id, date, label, mode }) => ({ id, date, label, mode })),
      photos,
    });
  }
  await sql.end();
  return { clipModel, ocrModel, trips, texts: {} };
};

save(await capture(process.argv.slice(2)));
console.log(`saved ${FIXTURE}`);

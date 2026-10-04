#!/usr/bin/env node
// Captures the inputs of the garden benchmark (`src/utils/collections/packs/garden/benchmark.spec.ts`) from a running
// Immich instance, read-only, as `test/fixtures/reading/capture-benchmark.mjs` does: the capture times, CLIP image
// embeddings and stored OCR of every photo (SELECT), and the tiled full-resolution OCR of the seed packets and plant
// tags (machine learning OCR on crops of the originals in the set's folder). The CLIP text embeddings of the prompts
// are added by the spec (GARDEN_BENCHMARK_ML).
//
// Every set is a folder with the originals and an `expected.json`: the varieties, the sources (a plant tag or a seed
// packet, and the varieties on it) and the subjects (the plant each photo shows, null for another or an unknown one,
// with the growth stage the photographers gave it). The file names are only used to find the photos, never stored.
//
//   node test/fixtures/garden/capture-benchmark.mjs ~/immich-acp-dev/demo-garden/*/
//
// Environment: as the reading capture (IMMICH_USER, IMMICH_ML_URL, DB_URL, CLIP_MODEL, OCR_MODEL).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import postgres from 'postgres';
import { getAsset, readTiles } from '../reading/capture-benchmark.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json.gz');
const clipModel = process.env.CLIP_MODEL ?? 'ViT-B-32__openai';
const ocrModel = process.env.OCR_MODEL ?? 'PP-OCRv5_mobile';

const main = async (folders) => {
  const sql = postgres(process.env.DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/immich');
  const sets = [];
  for (const folder of folders) {
    const expected = JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'));
    const files = [
      ...expected.sources.map((source) => ({ ...source, kind: source.kind === 'seed packet' ? 'packet' : 'tag' })),
      ...expected.subjects.map((subject) => ({ ...subject, kind: 'plant' })),
    ];
    const photos = [];
    for (const photo of files) {
      const asset = await getAsset(sql, photo.file);
      const started = Date.now();
      const tiled = photo.kind === 'plant' ? {} : await readTiles(join(folder, photo.file));
      photos.push({
        n: photo.file.slice(0, 2),
        kind: photo.kind,
        ...(photo.kind === 'plant' ? { plant: photo.entry, stage: photo.stage } : { plants: photo.entries }),
        ...(photo.note && { note: photo.note }),
        date: photo.date,
        time: asset.time,
        embedding: asset.embedding,
        ocr: asset.ocr,
        ...tiled,
        ...(photo.kind !== 'plant' && { tiledMs: Date.now() - started }),
      });
      console.log(basename(folder), photo.kind, photo.file.slice(0, 60));
    }
    photos.sort((a, b) => a.time - b.time || a.n.localeCompare(b.n));
    sets.push({ key: basename(resolve(folder)), title: expected.collection, varieties: expected.entries, photos });
  }
  await sql.end();
  return { clipModel, ocrModel, sets, texts: {} };
};

const fixture = await main(process.argv.slice(2));
writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
console.log(`saved ${FIXTURE}`);

#!/usr/bin/env node
// Captures the inputs of the nature benchmark (`src/utils/collections/packs/nature/benchmark.spec.ts`) from a running
// Immich instance, read-only (see `test/fixtures/collections/capture.mjs`): the stored OCR, CLIP embedding, local
// capture time and location of every photo, and the tiled full-resolution OCR of the plant labels.
//
// Every set is a folder with the originals and an `expected.json`: { collection, place, entries: { id: { scientific,
// common, family, cultivar } }, sources: [{ file, entries: [id] }], subjects: [{ file, entry: id | null, taxon }] }.
// The file names are only used to find the photos, never stored.
//
//   IMMICH_API_KEY_FILE=demo-user.txt DB_URL=... IMMICH_ML_URL=... node test/fixtures/nature/capture-benchmark.mjs \
//     ~/demo-nature/*/
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { clipModel, ocrModel, openLibrary } from '../collections/capture.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json.gz');

const library = await openLibrary();
const sets = [];
for (const folder of process.argv.slice(2)) {
  const expected = JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'));
  const taxon = (id) => {
    const { scientific, common, family, cultivar } = expected.entries[id];
    return { id, scientific, common, family: family ?? null, cultivar: cultivar ?? null };
  };
  const photos = [];
  for (const source of expected.sources) {
    photos.push({
      file: source.file,
      kind: 'label',
      ...(await library.read(source.file, { tiles: join(folder, source.file) })),
      expected: { taxa: source.entries.map((id) => taxon(id)) },
    });
    console.log(basename(folder), 'label', source.file.slice(0, 50));
  }
  for (const subject of expected.subjects) {
    photos.push({
      file: subject.file,
      kind: 'plant',
      ...(await library.read(subject.file)),
      expected: { taxon: subject.taxon ?? null, entry: subject.entry ? taxon(subject.entry) : null },
    });
    console.log(basename(folder), 'plant', subject.file.slice(0, 50));
  }
  photos.sort((a, b) => a.time - b.time || a.file.localeCompare(b.file));
  // the file names are not stored
  sets.push({
    key: basename(resolve(folder)),
    place: expected.collection,
    photos: photos.map(({ file: _file, ...photo }) => photo),
  });
}
await library.close();
writeFileSync(FIXTURE, gzipSync(JSON.stringify({ clipModel, ocrModel, sets, texts: {} }), { level: 9 }));
console.log(`saved ${FIXTURE}`);

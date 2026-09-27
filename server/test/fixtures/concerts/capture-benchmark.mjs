#!/usr/bin/env node
// Captures the inputs of the concerts benchmark (`src/utils/collections/packs/concerts/benchmark.spec.ts`) from a
// running Immich instance, read-only (see `test/fixtures/collections/capture.mjs`): the stored OCR, CLIP embedding,
// local capture time and location of every photo, and the tiled full-resolution OCR of the sources (line-ups, stage-time
// boards and setlists).
//
// Every set is a folder with the originals and an `expected.json`: { place, entries: { id: { performer } },
// sources: [{ file, kind, entries: [id], text: { header, songs } }], subjects: [{ file, entry: id | null, performer }] }.
// The file names are only used to find the photos, never stored.
//
//   IMMICH_API_KEY_FILE=demo-user.txt DB_URL=... IMMICH_ML_URL=... node test/fixtures/concerts/capture-benchmark.mjs \
//     ~/demo-concerts/*/
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
  const performer = (id) => expected.entries[id].performer;
  const photos = [];
  for (const source of expected.sources) {
    photos.push({
      file: source.file,
      kind: source.kind,
      ...(await library.read(source.file, { tiles: join(folder, source.file) })),
      expected: {
        performers: source.entries.map((id) => performer(id)),
        ...(source.text.songs && { songs: source.text.songs.filter((song) => !/^-+\s*interlude$/i.test(song)) }),
      },
    });
    console.log(basename(folder), source.kind, source.file.slice(0, 50));
  }
  for (const subject of expected.subjects) {
    photos.push({
      file: subject.file,
      kind: 'stage',
      ...(await library.read(subject.file)),
      expected: { performer: subject.performer, entry: subject.entry ? performer(subject.entry) : null },
    });
    console.log(basename(folder), 'stage', subject.file.slice(0, 50));
  }
  photos.sort((a, b) => a.time - b.time || a.file.localeCompare(b.file));
  // the file names are not stored
  sets.push({
    key: basename(resolve(folder)),
    place: expected.place,
    photos: photos.map(({ file: _file, ...photo }) => photo),
  });
}
await library.close();
writeFileSync(FIXTURE, gzipSync(JSON.stringify({ clipModel, ocrModel, sets, texts: {} }), { level: 9 }));
console.log(`saved ${FIXTURE}`);

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CollectionKind, classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { redactText } from 'src/utils/collections/pack.js';
import { parseArtworkName } from 'src/utils/collections/packs/kids-art/artwork.js';
import {
  ArtworkOptions,
  DEFAULT_ARTWORK_OPTIONS,
  assignArtworks,
} from 'src/utils/collections/packs/kids-art/artworks.js';
import { kidsArtPack } from 'src/utils/collections/packs/kids-art/pack.js';
import { combineSourceOcr } from 'src/utils/collections/source.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';
import { getFallbackVisitNames, groupVisits, summarizeVisit } from 'src/utils/collections/visits.js';

/**
 * A benchmark of the kids' art pack on four real family archives, captured by `capture-benchmark.mjs`: the stored and
 * the tiled full-resolution OCR of every artwork, its CLIP embedding, capture time and face count, and the text
 * embeddings of the prompts. The photos are classified and grouped into a child's years as `findVisits` does, what is
 * written on them read and the pages of one artwork grouped and named as `CollectionService.matchVisit` does with the
 * pack, and every text the pack lets out redacted; the result is scored against what each artwork is (see
 * `src/utils/collections/packs/kids-art/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from artworks on Wikimedia Commons: three illustrated letters of 1947-1949 uploaded by
 * their author, now an adult (Commons user Albertomos), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0);
 * drawings a girl gave her grandmother (2022-2025), released CC0 by the grandmother
 * (https://creativecommons.org/publicdomain/zero/1.0); school drawings of 2023, public domain (PD-author, uploaded by
 * AKA MBG); and ten years of two sisters' artworks photographed by their father, MIKI Yoshihito, CC BY 2.0
 * (https://creativecommons.org/licenses/by/2.0). It holds no images, only their OCR, CLIP embeddings, capture times
 * and face counts. No child's name is in it: the names written on the artworks and in the ground truth were replaced
 * by placeholder names (Marco Rossi, Lina, Vera Petrova, Hanako and Yumiko Tanaka) before it was saved, and the sets
 * have neutral keys.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type ExpectedWork = { title: string; artist: string; age: string | null; date: string };

export type Photo = {
  n: string;
  /** the id of the artwork in `works` */
  work: string;
  /** the page of a letter, 1-based */
  page?: number;
  /** a scan: its capture time is when it was imported */
  scan: boolean;
  /** the lines written on it, as legible (placeholders for names) */
  text: string[] | null;
  names: string[];
  time: number;
  faces: number;
  embedding: string;
  ocr: OcrBoxInput[];
  width?: number;
  height?: number;
  passes?: OcrPass[];
  tiledMs?: number;
};

export type ArtSet = { key: string; works: Record<string, ExpectedWork>; photos: Photo[] };

export type Fixture = { clipModel: string; ocrModel: string; sets: ArtSet[]; texts: Record<string, string> };

export const loadFixture = (): Fixture => JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());

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

/** Adds the missing text embeddings to the fixture from the machine learning server, and drops the unused ones */
export const updateTexts = async (fixture: Fixture, used: Set<string>, url: string) => {
  for (const text of used) {
    if (fixture.texts[text]) {
      continue;
    }
    const form = new FormData();
    form.append('entries', JSON.stringify({ clip: { textual: { modelName: fixture.clipModel, options: {} } } }));
    form.append('text', text);
    const response = await fetch(new URL('predict', url), { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(`Unable to encode "${text}": ${response.status}`);
    }
    const { clip } = (await response.json()) as { clip: string };
    fixture.texts[text] = encode(JSON.parse(clip));
  }
  fixture.texts = Object.fromEntries(Object.entries(fixture.texts).filter(([text]) => used.has(text)));
  writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
};

/** the placeholder surnames of the fixture, which the pack must never let out */
export const SURNAMES = ['Rossi', 'Petrova', 'Tanaka', 'Ivanova'];

/** the child of an artwork, e.g. "Hanako" of "Hanako (elder daughter)" */
const childOf = (work: ExpectedWork) => work.artist.split(/[\s(]+/, 1)[0];

const yearOf = (time: number) => new Date(time).getUTCFullYear();

export type PairScore = { expected: number; found: number; wrong: number };

export type SetResult = {
  key: string;
  artworks: number;
  classification: { found: number; missed: number };
  /** pairs of photos of one artwork (the pages of a letter) put together, and of two artworks */
  sameWork: PairScore;
  /** pairs of photos of one child and year (by their capture dates) in one visit, and of two in one */
  sameYear: PairScore;
  /** artworks named, named surely, and named surely but wrong (a greeting or a year the artwork does not have) */
  named: number;
  sure: number;
  sureWrong: number;
  /** the year written on an artwork read into its name */
  years: { expected: number; read: number };
  /** photos whose writing OCR cannot read (Cyrillic, Japanese, none), and those named surely all the same */
  unreadable: { photos: number; sure: number };
  /** texts the pack let out (names, descriptions, places) that hold a placeholder surname or a full name */
  leaks: string[];
  faces: number;
  places: string[];
  lines: string[];
  used: string[];
  missing: string[];
};

const pairs = <T>(values: T[]) => values.flatMap((a, i) => values.slice(i + 1).map((b) => [a, b] as const));

const runSet = (set: ArtSet, texts: Map<string, Float32Array>, artworkOptions: ArtworkOptions): SetResult => {
  const missing: string[] = [];
  const used: string[] = [];
  const embed = (text: string) => {
    used.push(text);
    const embedding = texts.get(text);
    if (!embedding) {
      missing.push(text);
    }
    return embedding ?? new Float32Array(512);
  };
  const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, value, index) => sum + value * b[index], 0);

  const photos = set.photos.map((photo, index) => {
    const tiled = photo.passes ? mergeOcrPasses(photo.width!, photo.height!, photo.passes) : undefined;
    return {
      ...photo,
      id: String(index),
      vector: decode(photo.embedding),
      combined: tiled ? combineSourceOcr(photo.ocr, tiled) : photo.ocr,
    };
  });

  const prompts = getPromptList(kidsArtPack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  const rules = { parse: kidsArtPack.source.parse, placeWords: kidsArtPack.place.words };
  const kinds = photos.map(
    (photo) =>
      classifyPhoto(kidsArtPack.classify, prompts, {
        similarities: promptEmbeddings.map((text) => dot(photo.vector, text)),
        ocr: photo.ocr.length > 0 ? summarizeText(photo.ocr, rules) : undefined,
      }).kind,
  );
  const found = photos.flatMap((photo, index) =>
    kinds[index] === 'other'
      ? []
      : [{ id: photo.id, time: photo.time, kind: kinds[index] as Exclude<CollectionKind, 'other'> }],
  );
  const visits = groupVisits(found, kidsArtPack.visits.options);
  const visitOf = new Map(visits.flatMap((visit, index) => visit.map(({ id }) => [id, index] as const)));
  const places = getFallbackVisitNames(
    visits.map((visit) => summarizeVisit(visit)),
    kidsArtPack.place.fallbackName,
  );

  const result: SetResult = {
    key: set.key,
    artworks: photos.length,
    classification: {
      found: photos.filter((photo) => kinds[Number(photo.id)] === 'subject').length,
      missed: photos.filter((photo) => kinds[Number(photo.id)] !== 'subject').length,
    },
    sameWork: { expected: 0, found: 0, wrong: 0 },
    sameYear: { expected: 0, found: 0, wrong: 0 },
    named: 0,
    sure: 0,
    sureWrong: 0,
    years: { expected: 0, read: 0 },
    unreadable: { photos: 0, sure: 0 },
    leaks: [],
    faces: photos.reduce((sum, photo) => sum + photo.faces, 0),
    places,
    lines: [],
    used,
    missing,
  };
  const let_ = (text: string) => {
    const out = redactText(kidsArtPack, text);
    const words = new Set(out.split(/[^\p{L}]+/u));
    if (SURNAMES.some((surname) => words.has(surname))) {
      result.leaks.push(out);
    }
    return out;
  };
  for (const place of places) {
    let_(place);
  }
  // every line read on the artworks, and the names of the artists as a parent would type them ("Vera Petrova, 2023")
  for (const photo of photos) {
    for (const { text } of photo.combined) {
      let_(text);
    }
  }
  for (const work of Object.values(set.works)) {
    let_(work.artist);
    let_(`${work.artist.split(' (', 1)[0]}, 2023`);
  }

  const options: AssignOptions = {
    ...DEFAULT_MATCH_OPTIONS,
    ...kidsArtPack.match.options,
    baselines: [],
    suggestions: 3,
  };
  const workOf = new Map<string, string>();
  for (const [visitIndex, visit] of visits.entries()) {
    const subjects = visit.filter(({ kind }) => kind === 'subject').map(({ id }) => photos[Number(id)]);
    const { matches, entries = [] } = assignArtworks(
      subjects.map((photo) => ({ id: photo.id, time: photo.time, embedding: photo.vector, ocr: photo.combined })),
      [],
      options,
      artworkOptions,
    );
    for (const entry of entries) {
      let_(entry.name);
    }
    for (const [index, match] of matches.entries()) {
      const name = match.item === undefined ? undefined : let_(entries[match.item].name);
      const members = match.ids.map((id) => photos[Number(id)]);
      const work = set.works[members[0].work];
      result.named += Number(!!name);
      if (name && !match.unsure) {
        result.sure++;
        const { year } = parseArtworkName(name);
        // a sure name that the artwork does not bear out: a year it does not have, a greeting it does not hold
        const text = (members.flatMap((member) => member.text ?? []).join(' ') + ` ${work.date}`).toLowerCase();
        const { title } = parseArtworkName(name);
        result.sureWrong += Number(
          (!!year && !work.date.includes(year)) || !text.includes(title.toLowerCase().split(' ', 1)[0]),
        );
      }
      // the year of the artwork, where OCR can read it on one of its pages
      const written = /\b(?:19|20)\d\d\b/.exec(work.date)?.[0];
      if (written && members.some((member) => member.combined.some(({ text }) => text.includes(written)))) {
        result.years.expected++;
        result.years.read += Number(!!name && parseArtworkName(name).year === written);
      }
      for (const member of members) {
        workOf.set(member.id, `${visitIndex}:${index}`);
        const unreadable = !member.text || member.text.every((line) => !/[a-z]{3}/i.test(line));
        result.unreadable.photos += Number(unreadable);
        result.unreadable.sure += Number(unreadable && !match.unsure);
        result.lines.push(
          `${member.n} ${member.work}${member.page ? ` p${member.page}` : ''} visit ${visitIndex} work ${index}${match.ids.length > 1 ? `(${members.map(({ n }) => n).join('+')})` : ''} ${match.unsure ? 'unsure' : 'SURE'} "${name ?? '-'}" expected "${work.title}" (${work.age ?? '-'}, ${work.date})`,
        );
      }
    }
  }
  for (const photo of photos) {
    if (kinds[Number(photo.id)] !== 'subject') {
      result.lines.push(`${photo.n} ${photo.work} MISSED as ${kinds[Number(photo.id)]}`);
    }
  }

  for (const [a, b] of pairs(photos)) {
    const same = a.work === b.work;
    const together = workOf.has(a.id) && workOf.get(a.id) === workOf.get(b.id);
    result.sameWork.expected += Number(same);
    result.sameWork.found += Number(same && together);
    result.sameWork.wrong += Number(!same && together);
    // the child and the year, by the capture dates of photos (scans have none)
    if (a.scan || b.scan) {
      continue;
    }
    const sameYear = childOf(set.works[a.work]) === childOf(set.works[b.work]) && yearOf(a.time) === yearOf(b.time);
    const inOne = visitOf.has(a.id) && visitOf.get(a.id) === visitOf.get(b.id);
    result.sameYear.expected += Number(sameYear);
    result.sameYear.found += Number(sameYear && inOne);
    result.sameYear.wrong += Number(!sameYear && inOne);
  }
  return result;
};

export const runBenchmark = (fixture: Fixture, artworkOptions: Partial<ArtworkOptions> = {}) => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.sets.map((set) => runSet(set, texts, { ...DEFAULT_ARTWORK_OPTIONS, ...artworkOptions }));
};

const pair = ({ found, expected, wrong }: PairScore) => `${found}/${expected} (${wrong} wrong)`;

export const formatReport = (results: SetResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.key}: ${result.artworks} artworks (${result.classification.found} found); same artwork ${pair(result.sameWork)}; ` +
        `same child and year ${pair(result.sameYear)}; named ${result.named}, ${result.sure} sure (${result.sureWrong} wrong); ` +
        `years read ${result.years.read}/${result.years.expected}; unreadable ${result.unreadable.photos} (${result.unreadable.sure} sure); ` +
        `faces ${result.faces}; leaks ${result.leaks.length}; places: ${result.places.join(', ')}`,
    );
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`));
    }
  }
  return lines.join('\n');
};

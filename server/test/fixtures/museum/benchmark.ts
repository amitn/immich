import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { DEFAULT_MATCH_OPTIONS, MatchOptions, SubjectMatch } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { parseArtwork } from 'src/utils/collections/packs/museum/artwork.js';
import { museumPack } from 'src/utils/collections/packs/museum/pack.js';
import { PlacePhoto, findPlaceNames } from 'src/utils/collections/place.js';
import { SourceEntry, chooseSourceOcr, mergeSourceEntries } from 'src/utils/collections/source.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';

/**
 * A benchmark of the museum pack on real museum visits: the stored and the tiled full-resolution OCR of their wall
 * labels, the CLIP embeddings and capture times of every photo, and the CLIP text embeddings of the prompts and of
 * the artworks read on the labels, captured by `capture-benchmark.mjs`. The photos are classified, the labels read and
 * the artworks paired with them as `CollectionService.findVisits` and `matchVisit` do with the museum pack, and the
 * result is scored against what each photo shows (see `src/utils/collections/packs/museum/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons: the Museu Nacional Frei Manuel do Cenáculo (Museu
 * de Évora, 2025-08-28) by DiogoBaptista, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0); the Musée des
 * Beaux-Arts d'Agen (2018-07-25) by François-Rémy Roqueton, CC BY-SA 4.0; and the Indian Museum, Kolkata (2022-09-27)
 * by Prady9, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0). It holds no images, only their OCR, CLIP
 * embeddings, capture times, and what each photo shows. The artworks in the photos are in the public domain.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type ExpectedArtwork = {
  /** the index of the label photo of the artwork in the visit, null when none was photographed */
  label: number | null;
  title: string | null;
  titleOriginal: string | null;
  artist: string | null;
  year: string | null;
};

export type Photo = {
  kind: 'artwork' | 'label' | 'sign' | 'venue';
  time: number;
  embedding: string;
  ocr: OcrBoxInput[];
  latitude?: number;
  longitude?: number;
  width?: number;
  height?: number;
  passes?: OcrPass[];
  expected?: ExpectedArtwork;
};

export type Visit = { key: string; museum: string; photos: Photo[] };

export type Fixture = { clipModel: string; ocrModel: string; visits: Visit[]; texts: Record<string, string> };

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

/**
 * Adds the missing text embeddings to the fixture, from the machine learning server, and drops the ones no longer
 * used, so that the fixture holds the texts of the current prompts and label reading.
 */
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

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]+/gu, ' ')
    .trim();

const bigrams = (text: string) => {
  const compact = text.replaceAll(' ', '');
  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
};

const dice = (a: string, b: string) => {
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

/** a title read on the label is the expected one, give or take OCR noise ("Darparika" for "Darpanika") */
export const isSameTitle = (expected: string, read: string) => {
  const a = normalize(expected);
  const b = normalize(read);
  return a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a))) || dice(a, b) >= 0.75;
};

const QUALIFIERS = /\b(?:attributed|to|called|dit|dite|dita|after|unknown|master|workshop|of)\b/g;

const nameWords = (text: string) =>
  normalize(text)
    .replaceAll(QUALIFIERS, ' ')
    .split(' ')
    .filter((word) => word.length >= 3);

/** the artist read is the expected one: the same names, whatever the qualifiers ("Attributed to X" for "X (attributed)") */
export const isSameArtist = (expected: string, read: string) => {
  const words = nameWords;
  const found = new Set(words(read));
  const wanted = words(expected);
  return wanted.length > 0 && wanted.filter((word) => found.has(word)).length >= Math.ceil(0.8 * wanted.length);
};

/** the date read is the expected one: the same years and centuries ("c. 1760" for "circa 1760"), or the same words */
const numbers = (text: string) => text.match(/\d+/g) ?? [];

export const isSameDate = (expected: string, read: string) => {
  const a = numbers(expected);
  const b = numbers(read);
  if (a.length > 0 || b.length > 0) {
    return a.join('-') === b.join('-');
  }
  return dice(normalize(expected), normalize(read)) >= 0.6;
};

export type VisitResult = {
  key: string;
  /** artwork photos, and those paired with the right label (or with none, when none was photographed) */
  artworks: number;
  paired: number;
  /** pairings marked sure that are wrong */
  sureWrong: number;
  /** artworks with a label (one per work), and those whose title, artist and date were read on it */
  works: number;
  titles: number;
  artists: { expected: number; read: number };
  dates: { expected: number; read: number };
  /** photos classified as what they show */
  classified: { total: number; correct: number; wrong: string[] };
  museum?: { name: string; confidence: number };
  entries: SourceEntry[];
  unmatched: string[];
  lines: string[];
  used: string[];
  missing: string[];
};

/** the entries of the labels of a visit, as `CollectionService.matchVisit` reads them with the museum pack */
export const readLabels = (visit: Visit) => {
  const readings = visit.photos.flatMap((photo, index) => {
    if (photo.kind !== 'label') {
      return [];
    }
    const aspectRatio = photo.width! / photo.height!;
    const detailed = mergeOcrPasses(photo.width!, photo.height!, photo.passes ?? []);
    const boxes = chooseSourceOcr(photo.ocr, detailed) === 'tiles' ? detailed : photo.ocr;
    return [{ ...museumPack.source.parse(boxes, { aspectRatio }), assetId: String(index) }];
  });
  return mergeSourceEntries(readings);
};

const EXPECTED_KIND = { artwork: 'subject', label: 'source', sign: 'sign', venue: 'other' } as const;

const runVisit = (visit: Visit, texts: Map<string, Float32Array>, options: Partial<MatchOptions> = {}): VisitResult => {
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

  // what each photo is, from its CLIP embedding and its stored OCR
  const prompts = getPromptList(museumPack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  const classified: VisitResult['classified'] = { total: 0, correct: 0, wrong: [] };
  for (const [index, photo] of visit.photos.entries()) {
    const embedding = decode(photo.embedding);
    const { kind, scores } = classifyPhoto(museumPack.classify, prompts, {
      similarities: promptEmbeddings.map((prompt) => dot(embedding, prompt)),
      ocr: summarizeText(photo.ocr, {
        parse: museumPack.source.parse,
        receiptWords: museumPack.classify.receiptWords,
        placeWords: museumPack.place.words,
      }),
    });
    classified.total++;
    if (kind === EXPECTED_KIND[photo.kind] || (photo.kind === 'venue' && kind !== 'subject' && kind !== 'source')) {
      classified.correct++;
    } else {
      const top = Object.entries(scores)
        .toSorted((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([name, value]) => `${name} ${value}`);
      classified.wrong.push(`#${index} ${photo.kind} as ${kind}: ${top.join(', ')}`);
    }
  }

  // the labels, read into entries, each with the time of its photo
  const merged = readLabels(visit);
  const entries = merged.map(({ item }) => item);
  const candidates = merged.map(({ item, sourceId }) => ({
    name: item.name,
    embedding: embed(museumPack.source.prompt(item)),
    sourceTime: visit.photos[Number(sourceId)].time,
  }));
  const baselines = museumPack.match.offListPrompts.map((text) => embed(text));

  const artworks = visit.photos.flatMap((photo, index) =>
    photo.kind === 'artwork'
      ? [{ index, photo, id: String(index), time: photo.time, embedding: decode(photo.embedding) }]
      : [],
  );
  // as `CollectionService.matchVisit` does: the pack's own assignment, with the times of the label photos
  const { matches } = museumPack.match.assign!(artworks, candidates, {
    ...DEFAULT_MATCH_OPTIONS,
    ...museumPack.match.options,
    ...options,
    baselines,
    suggestions: 3,
  });
  const byPhoto = new Map<string, SubjectMatch>();
  for (const match of matches) {
    for (const id of match.ids) {
      byPhoto.set(id, match);
    }
  }

  const result: VisitResult = {
    key: visit.key,
    artworks: artworks.length,
    paired: 0,
    sureWrong: 0,
    works: 0,
    titles: 0,
    artists: { expected: 0, read: 0 },
    dates: { expected: 0, read: 0 },
    classified,
    entries,
    unmatched: [],
    lines: [],
    used,
    missing,
  };

  const bestEntry = (expected: ExpectedArtwork) =>
    merged
      .filter(({ sourceId }) => Number(sourceId) === expected.label)
      .map(({ item }) => item)
      .find((item) => {
        const { title } = parseArtwork(item.name);
        return (
          (expected.title && isSameTitle(expected.title, title)) ||
          (expected.titleOriginal && isSameTitle(expected.titleOriginal, title))
        );
      });

  for (const { id, photo } of artworks) {
    const expected = photo.expected!;
    const match = byPhoto.get(id)!;
    const item = match.item === undefined ? undefined : merged[match.item];
    const label = item ? Number(item.sourceId) : null;
    // the right label, and on a label of several objects, the right object
    const right =
      label === expected.label &&
      (!item ||
        merged.filter(({ sourceId }) => sourceId === item.sourceId).length === 1 ||
        bestEntry(expected) === item.item);
    result.paired += Number(right);
    if (!right && !match.unsure) {
      result.sureWrong++;
    }
    result.lines.push(
      `${right ? 'OK ' : 'BAD'} #${id.padStart(2)} expected=${String(expected.label).padEnd(4)} got=${String(label).padEnd(4)} ${match.unsure ? 'unsure' : 'sure  '} score=${match.score.toFixed(2)} off=${match.offList?.toFixed(2)} ${item ? item.item.name.slice(0, 70) : '-'}`,
    );
  }

  // the fields of every work with a label, once per work (a detail shot shows a work again)
  const seen = new Set<string>();
  for (const { photo } of artworks) {
    const expected = photo.expected!;
    const key = `${expected.label}:${expected.title}`;
    if (expected.label === null || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.works++;
    const entry = bestEntry(expected);
    if (!entry) {
      result.lines.push(`  title not read: ${expected.title}`);
      continue;
    }
    result.titles++;
    const read = parseArtwork(entry.name);
    if (expected.artist) {
      result.artists.expected++;
      result.artists.read += Number(!!read.artist && isSameArtist(expected.artist, read.artist));
    }
    if (!expected.year) {
      continue;
    }

    result.dates.expected++;
    result.dates.read += Number(!!read.date && isSameDate(expected.year, read.date));
  }

  // the labels none of whose artworks were matched (a case of four objects, one photographed, is matched)
  const matched = new Set(matches.flatMap(({ item }) => (item === undefined ? [] : [merged[item].sourceId])));
  result.unmatched = merged.filter(({ sourceId }) => !matched.has(sourceId)).map(({ item }) => item.name);

  const placePhotos: PlacePhoto[] = visit.photos.flatMap((photo, index) =>
    photo.kind === 'label' || photo.kind === 'sign'
      ? [{ assetId: String(index), kind: photo.kind === 'label' ? 'source' : 'sign', ocr: photo.ocr }]
      : [],
  );
  const [museum] = findPlaceNames(placePhotos, museumPack.place);
  if (museum) {
    result.museum = { name: museum.name, confidence: museum.confidence };
  }
  return result;
};

export const runBenchmark = (fixture: Fixture, options: Partial<MatchOptions> = {}) => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.visits.map((visit) => runVisit(visit, texts, options));
};

export const formatReport = (results: VisitResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.key}: paired ${result.paired}/${result.artworks} artwork photos (sure but wrong ${result.sureWrong}), ` +
        `titles ${result.titles}/${result.works}, artists ${result.artists.read}/${result.artists.expected}, dates ` +
        `${result.dates.read}/${result.dates.expected}, classified ${result.classified.correct}/${result.classified.total}` +
        (result.classified.wrong.length > 0 ? ` (${result.classified.wrong.join(', ')})` : '') +
        ', museum ' +
        (result.museum ? `"${result.museum.name}" ${result.museum.confidence}` : 'none') +
        `, unmatched labels ${result.unmatched.length}`,
    );
    if (verbose) {
      lines.push(
        ...result.entries.map((entry) => `  entry: ${entry.name}${entry.description ? ` (${entry.description})` : ''}`),
        ...result.lines.map((line) => `  ${line}`),
        ...result.unmatched.map((name) => `  unmatched: ${name}`),
      );
    }
  }
  const paired = results.reduce((sum, result) => sum + result.paired, 0);
  const artworks = results.reduce((sum, result) => sum + result.artworks, 0);
  lines.push(`total: ${paired}/${artworks} paired`);
  return lines.join('\n');
};

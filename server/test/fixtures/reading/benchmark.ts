import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CollectionKind, classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { BookOptions, DEFAULT_BOOK_OPTIONS, assignBooks } from 'src/utils/collections/packs/reading/books.js';
import { readingPack } from 'src/utils/collections/packs/reading/pack.js';
import { parseBookName, readBookPage } from 'src/utils/collections/packs/reading/title-page.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import { combineSourceOcr } from 'src/utils/collections/source.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';
import { getFallbackVisitNames, groupVisits, summarizeVisit } from 'src/utils/collections/visits.js';

/**
 * A benchmark of the reading pack on real books: the stored and the tiled full-resolution OCR of their covers and
 * title pages, the CLIP embeddings and capture times of all the photos, and the CLIP text embeddings of the prompts,
 * captured by `capture-benchmark.mjs`. The photos are classified and grouped into reading periods as `findVisits`
 * does, the pages read, the photos of one book grouped and named as `CollectionService.matchVisit` does with the
 * reading pack, and the periods named; the result is scored against what each page says (see
 * `src/utils/collections/packs/reading/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons: the title pages and covers of old books photographed
 * for Wikipedia articles (2021-2026) by Goesseln, public domain; and Western novels in a case at the Harry Ransom
 * Center (2015-11-17) by Daderot, CC0 (https://creativecommons.org/publicdomain/zero/1.0). It holds no images, only
 * their OCR, CLIP embeddings and capture times, and what each book is (title, author, year, publisher and place, as
 * printed), to score the reading.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type ExpectedBook = {
  title: string;
  titleShort: string;
  author: string;
  year: number;
  publisher: string | null;
  place: string | null;
};

export type Photo = {
  /** the number of the photo in its folder */
  n: string;
  kind: 'title page' | 'cover' | 'open book' | 'venue';
  /** the id of the book in `books`, null for a venue */
  book: string | null;
  /** the type the page is set in, e.g. Fraktur */
  script: string | null;
  time: number;
  embedding: string;
  ocr: OcrBoxInput[];
  width?: number;
  height?: number;
  passes?: OcrPass[];
  tiledMs?: number;
};

export type ReadingSet = { key: string; title: string; books: Record<string, ExpectedBook>; photos: Photo[] };

export type Fixture = { clipModel: string; ocrModel: string; sets: ReadingSet[]; texts: Record<string, string> };

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

const STOP = new Set(['der', 'die', 'das', 'des', 'den', 'the', 'and', 'und', 'von', 'zu', 'of', 'in', 'im', 'transl']);

const tokens = (text: string) =>
  text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll('ß', 'ss')
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((word) => word.length >= 3 && !STOP.has(word));

const editDistance = (a: string, b: string) => {
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

/** "kunstschatze" is "kunstschaetze", "martinbubep" holds "martin": what counts as reading a word */
const isRead = (word: string, read: string[]) =>
  read.some((other) => {
    if (other === word) {
      return true;
    }
    const shorter = Math.min(other.length, word.length);
    if (shorter >= 5 && (other.includes(word) || word.includes(other))) {
      return true;
    }
    return word.length >= 4 && editDistance(word, other) <= (word.length >= 8 ? 2 : 1);
  });

/** the parts of a name read against the book: the title (half its short title's words), the author (a name) */
export const scoreBook = (name: string | undefined, book: ExpectedBook) => {
  const { title, author } = name ? parseBookName(name) : {};
  const titleWords = tokens(book.titleShort);
  const readTitle = tokens(title ?? '');
  const titleRead =
    titleWords.length > 0 && titleWords.filter((word) => isRead(word, readTitle)).length >= 0.5 * titleWords.length;
  // the author as printed, without the translator: a word of the name read
  const authorWords = tokens(book.author.replace(/\(.*\)/, ''));
  const authorRead = !!author && authorWords.some((word) => isRead(word, tokens(author)));
  return { title: titleRead, author: authorRead };
};

export type FieldScore = { expected: number; read: number };
export type PairScore = { expected: number; found: number; wrong: number };

export type SetResult = {
  key: string;
  photos: number;
  /** the pages read on each photo alone, from the tiles and the stored OCR together */
  read: { title: FieldScore; author: FieldScore; year: FieldScore };
  /** the names match_subjects gives the books (the readings of a book's photos together) */
  named: { title: FieldScore; author: FieldScore };
  sure: number;
  /** named surely but wrong: a title or an author the page contradicts */
  sureWrong: number;
  /** photos set in Fraktur, and those named surely all the same */
  fraktur: { photos: number; sure: number };
  /** photos of an open book without a title, and those given a sure name */
  openPages: { photos: number; sure: number };
  sameBook: PairScore;
  classification: { books: number; booksFound: number; venues: number; venuesFound: number; othersAsBooks: number };
  places: string[];
  tiledMs: number;
  lines: string[];
  used: string[];
  missing: string[];
};

const field = (): FieldScore => ({ expected: 0, read: 0 });

const pairs = <T>(values: T[]) => values.flatMap((a, i) => values.slice(i + 1).map((b) => [a, b] as const));

const runSet = (set: ReadingSet, texts: Map<string, Float32Array>, bookOptions: BookOptions): SetResult => {
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

  // classification (from the stored OCR and CLIP) and reading periods, as find_visits
  const prompts = getPromptList(readingPack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  const rules = {
    parse: readingPack.source.parse,
    receiptWords: readingPack.classify.receiptWords,
    placeWords: readingPack.place.words,
  };
  const classifications = photos.map((photo) =>
    classifyPhoto(readingPack.classify, prompts, {
      similarities: promptEmbeddings.map((text) => dot(photo.vector, text)),
      ocr: photo.ocr.length > 0 ? summarizeText(photo.ocr, rules) : undefined,
    }),
  );
  const kinds = classifications.map(({ kind }) => kind);
  const found = photos.flatMap((photo, index) =>
    kinds[index] === 'other'
      ? []
      : [{ id: photo.id, time: photo.time, kind: kinds[index] as Exclude<CollectionKind, 'other'> }],
  );
  const visits = groupVisits(found, readingPack.visits.options);
  const read = visits.map((visit) => {
    const signs = visit.flatMap(({ id, kind }) =>
      kind === 'subject'
        ? []
        : [{ assetId: id, kind: kind as 'sign' | 'source' | 'receipt', ocr: photos[Number(id)].ocr }],
    );
    return findPlaceNames(signs, readingPack.place)[0];
  });
  const fallbacks = getFallbackVisitNames(
    visits.map((visit) => summarizeVisit(visit)),
    readingPack.place.fallbackName,
  );
  const places = visits.map((_, index) =>
    read[index] ? `${read[index].name} (${read[index].source})` : `${fallbacks[index]} (fallback)`,
  );

  const books = photos.filter((photo) => photo.book);
  const result: SetResult = {
    key: set.key,
    photos: books.length,
    read: { title: field(), author: field(), year: field() },
    named: { title: field(), author: field() },
    sure: 0,
    sureWrong: 0,
    fraktur: { photos: 0, sure: 0 },
    openPages: { photos: 0, sure: 0 },
    sameBook: { expected: 0, found: 0, wrong: 0 },
    classification: {
      books: books.length,
      booksFound: books.filter((photo) => kinds[Number(photo.id)] === 'subject').length,
      venues: photos.filter((photo) => photo.kind === 'venue').length,
      venuesFound: photos.filter((photo) => photo.kind === 'venue' && kinds[Number(photo.id)] === 'sign').length,
      othersAsBooks: photos.filter((photo) => !photo.book && kinds[Number(photo.id)] === 'subject').length,
    },
    places,
    tiledMs: Math.round(books.reduce((sum, photo) => sum + (photo.tiledMs ?? 0), 0) / Math.max(1, books.length)),
    lines: [],
    used,
    missing,
  };

  // the pages read one by one
  for (const photo of books) {
    const book = set.books[photo.book!];
    if (photo.kind === 'open book') {
      continue;
    }
    const reading = readBookPage(photo.combined);
    const score = scoreBook(reading ? [reading.title, reading.author].filter(Boolean).join(' — ') : undefined, book);
    result.read.title.expected++;
    result.read.author.expected++;
    result.read.title.read += Number(score.title);
    result.read.author.read += Number(score.author);
    // the year printed on the page (not every page prints one)
    if (photo.combined.every(({ text }) => !text.replaceAll(' ', '').includes(String(book.year)))) {
      continue;
    }

    result.read.year.expected++;
    result.read.year.read += Number(reading?.year === String(book.year));
  }

  // match_subjects on the books of each period
  const options: AssignOptions = {
    ...DEFAULT_MATCH_OPTIONS,
    ...readingPack.match.options,
    baselines: [],
    suggestions: 3,
  };
  const bookOf = new Map<string, string>();
  for (const [visitIndex, visit] of visits.entries()) {
    const subjects = visit.filter(({ kind }) => kind === 'subject').map(({ id }) => photos[Number(id)]);
    if (subjects.length === 0) {
      continue;
    }
    const { matches, entries = [] } = assignBooks(
      subjects.map((photo) => ({ id: photo.id, time: photo.time, embedding: photo.vector, ocr: photo.combined })),
      [],
      options,
      bookOptions,
    );
    for (const [index, match] of matches.entries()) {
      const name = match.item === undefined ? undefined : entries[match.item]?.name;
      for (const id of match.ids) {
        bookOf.set(id, `${visitIndex}:${index}`);
        const photo = photos[Number(id)];
        if (!photo.book) {
          result.lines.push(`    ${photo.n} ${photo.kind} taken for a book: ${name}`);
          continue;
        }
        const book = set.books[photo.book];
        const score = scoreBook(name, book);
        const fraktur = /fraktur|blackletter/i.test(photo.script ?? '');
        result.fraktur.photos += Number(fraktur);
        result.fraktur.sure += Number(fraktur && !match.unsure);
        if (photo.kind === 'open book') {
          result.openPages.photos++;
          result.openPages.sure += Number(!match.unsure && !!name);
        } else {
          result.named.title.expected++;
          result.named.author.expected++;
          result.named.title.read += Number(score.title);
          result.named.author.read += Number(score.author);
        }
        if (!match.unsure) {
          result.sure++;
          const parts = name ? parseBookName(name) : {};
          result.sureWrong += Number((!!parts.title && !score.title) || (!!parts.author && !score.author));
        }
        result.lines.push(
          `${photo.n} ${photo.kind} book ${index}${match.ids.length > 1 ? `(${match.ids.map((other) => photos[Number(other)].n).join('+')})` : ''} t${score.title ? '+' : 'x'} a${score.author ? '+' : 'x'} ${match.unsure ? 'unsure' : 'SURE'} "${name ?? '-'}" (${name ? (entries[match.item!]?.description ?? '') : ''}) expected "${book.titleShort} — ${book.author}"`,
        );
      }
    }
  }
  for (const photo of photos) {
    const scores = classifications[Number(photo.id)].scores;
    if (photo.book && kinds[Number(photo.id)] === 'subject') {
      continue;
    }
    result.lines.push(
      `${photo.n} ${photo.kind} taken for ${kinds[Number(photo.id)]} [s${scores.subject.toFixed(2)} src${scores.source.toFixed(2)} sign${scores.sign.toFixed(2)} other${scores.other.toFixed(2)}]`,
    );
  }
  for (const [a, b] of pairs(books)) {
    const same = a.book === b.book;
    const together = bookOf.has(a.id) && bookOf.get(a.id) === bookOf.get(b.id);
    result.sameBook.expected += Number(same);
    result.sameBook.found += Number(same && together);
    result.sameBook.wrong += Number(!same && together);
  }
  return result;
};

export const runBenchmark = (fixture: Fixture, bookOptions: Partial<BookOptions> = {}) => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.sets.map((set) => runSet(set, texts, { ...DEFAULT_BOOK_OPTIONS, ...bookOptions }));
};

const fraction = ({ read, expected }: FieldScore) => `${read}/${expected}`;

export const formatReport = (results: SetResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    const { classification: c, sameBook, read, named } = result;
    lines.push(
      `${result.key}: ${result.photos} book photos (${c.booksFound} found, ${c.othersAsBooks} other shots taken for books, venues ${c.venuesFound}/${c.venues}); ` +
        `pages read: title ${fraction(read.title)}, author ${fraction(read.author)}, year ${fraction(read.year)}; ` +
        `named: title ${fraction(named.title)}, author ${fraction(named.author)}, ${result.sure} sure (${result.sureWrong} wrong); ` +
        `Fraktur ${result.fraktur.photos} (${result.fraktur.sure} sure); open pages ${result.openPages.photos} (${result.openPages.sure} sure); ` +
        `same book ${sameBook.found}/${sameBook.expected} pairs (${sameBook.wrong} wrong); ` +
        `places: ${result.places.join(', ')}; ${result.tiledMs} ms of tiled OCR per photo`,
    );
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`));
    }
  }
  return lines.join('\n');
};

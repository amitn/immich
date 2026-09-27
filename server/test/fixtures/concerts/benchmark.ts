import { classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { AssignPhoto, DEFAULT_MATCH_OPTIONS, SubjectMatch } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { isSetlistMarker, readConcertSource } from 'src/utils/collections/packs/concerts/lineup.js';
import { concertsPack } from 'src/utils/collections/packs/concerts/pack.js';
import { PlacePhoto, findPlaceNames } from 'src/utils/collections/place.js';
import { chooseSourceOcr, mergeSourceEntries } from 'src/utils/collections/source.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';
import {
  TextFixture,
  decode,
  dot,
  getTextEmbedder,
  isSameName,
  loadGzipJson,
  updateTexts as update,
} from 'test/fixtures/collections/benchmark.js';

/**
 * A benchmark of the concerts pack on real gigs: the stored and the tiled full-resolution OCR of their sources (a
 * festival stage banner with the line-up of the week, a board of stage times and three setlists, typed and
 * handwritten), the CLIP embeddings, capture times and locations of every photo, and the CLIP text embeddings of the
 * prompts and the acts, captured by `capture-benchmark.mjs`. The photos are classified, the sources read and the stage
 * photos matched with the acts as `CollectionService.findVisits` and `matchVisit` do with the concerts pack, and the
 * result is scored against what each photo shows (see `src/utils/collections/packs/concerts/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons: Primavera Sound 2019 (Parc del Fòrum, Barcelona,
 * 30 May and 1 June 2019) by Jwslubbock, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0); the gigs of
 * Sidney Gish and The Beths (17 February 2023) and of Palehound and Cherry Glazerr (7 March 2019) at Neumos, Seattle,
 * by David Lee, CC BY-SA 2.0 (https://creativecommons.org/licenses/by-sa/2.0). It holds no images, only their OCR,
 * CLIP embeddings, capture times and locations, and what each photo shows.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type Photo = {
  kind: 'stage' | 'setlist' | 'line-up' | 'stage-times';
  time: number;
  embedding: string;
  ocr: OcrBoxInput[];
  latitude?: number;
  longitude?: number;
  width?: number;
  height?: number;
  passes?: OcrPass[];
  /** a source: the acts it names, and the songs of a setlist; a stage photo: the act on stage, null when no source names it */
  expected: { performers?: string[]; songs?: string[]; performer?: string; entry?: string | null };
};

export type GigSet = { key: string; place: string; photos: Photo[] };

export type Fixture = TextFixture & { ocrModel: string; sets: GigSet[] };

export const loadFixture = () => loadGzipJson<Fixture>(FIXTURE);

export const updateTexts = (fixture: Fixture, used: Set<string>, url: string) => update(FIXTURE, fixture, used, url);

export type SetResult = {
  key: string;
  /** the acts the sources name, and those read */
  acts: { expected: number; read: number };
  /** the songs of the setlists, and those read */
  songs: { expected: number; read: number };
  /** stage photos, and those matched with the act on stage (or left off the list when no source names it) */
  stagePhotos: number;
  matched: number;
  /** stage photos of acts on no source, and those left off the list */
  offList: { expected: number; kept: number };
  /** matches marked sure that are wrong */
  sureWrong: number;
  classified: { total: number; correct: number; wrong: string[] };
  place?: { name: string; confidence: number };
  /** the setlist and line-up pages the book typesets */
  pages: number;
  lines: string[];
};

const EXPECTED_KIND = { stage: 'subject', setlist: 'source', 'line-up': 'source', 'stage-times': 'source' } as const;

/** the OCR a source is read from, as `CollectionService.getSourceReading` chooses it */
export const getSourceOcr = (photo: Photo) => {
  const detailed = mergeOcrPasses(photo.width!, photo.height!, photo.passes ?? []);
  return chooseSourceOcr(photo.ocr, detailed) === 'tiles' ? detailed : photo.ocr;
};

const matchesSong = (expected: string, read: string) =>
  isSameName(expected.split(/\s[-–]\s/, 1)[0], read.split(/\s?[-–]\s?\d/, 1)[0], 0.6);

const runSet = (set: GigSet, embed: (text: string) => Float32Array): SetResult => {
  const result: SetResult = {
    key: set.key,
    acts: { expected: 0, read: 0 },
    songs: { expected: 0, read: 0 },
    stagePhotos: 0,
    matched: 0,
    offList: { expected: 0, kept: 0 },
    sureWrong: 0,
    classified: { total: 0, correct: 0, wrong: [] },
    pages: 0,
    lines: [],
  };

  // what each photo is, from its CLIP embedding and its stored OCR
  const prompts = getPromptList(concertsPack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  for (const [index, photo] of set.photos.entries()) {
    const embedding = decode(photo.embedding);
    const { kind, scores } = classifyPhoto(concertsPack.classify, prompts, {
      similarities: promptEmbeddings.map((prompt) => dot(embedding, prompt)),
      ocr: summarizeText(photo.ocr, {
        parse: concertsPack.source.parse,
        receiptWords: concertsPack.classify.receiptWords,
        placeWords: concertsPack.place.words,
      }),
    });
    result.classified.total++;
    if (kind === EXPECTED_KIND[photo.kind]) {
      result.classified.correct++;
    } else {
      const top = Object.entries(scores)
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name, value]) => `${name} ${value}`);
      result.classified.wrong.push(`#${index} ${photo.kind} as ${kind}: ${top.join(', ')}`);
    }
  }

  // the sources, read into acts, each with the time of its photo
  const readings = set.photos.flatMap((photo, index) => {
    if (photo.kind === 'stage') {
      return [];
    }
    const boxes = getSourceOcr(photo);
    const aspectRatio = photo.width! / photo.height!;
    const parsed = concertsPack.source.parse(boxes, { aspectRatio });
    const source = readConcertSource(boxes, { aspectRatio });
    for (const performer of photo.expected.performers ?? []) {
      result.acts.expected++;
      const found = parsed.items.some((item) => isSameName(performer, item.name));
      result.acts.read += Number(found);
      if (!found) {
        result.lines.push(`  act not read on #${index}: ${performer}`);
      }
    }
    for (const song of photo.expected.songs ?? []) {
      result.songs.expected++;
      result.songs.read += Number(source.songs.some((read) => !isSetlistMarker(read) && matchesSong(song, read)));
    }
    if (concertsPack.book.sourcePage && concertsPack.book.sourcePage.read(boxes, { aspectRatio, place: set.place })) {
      result.pages++;
    }
    return [{ ...parsed, assetId: String(index) }];
  });
  const merged = mergeSourceEntries(readings, { repeats: concertsPack.source.repeats });
  const entries = merged.map(({ item, sourceId }) => ({
    name: item.name,
    ...(item.description && { description: item.description }),
    embedding: embed(concertsPack.source.prompt(item)),
    sourceTime: set.photos[Number(sourceId)].time,
  }));
  const baselines = concertsPack.match.offListPrompts.map((text) => embed(text));

  const stage: AssignPhoto[] = set.photos.flatMap((photo, index) =>
    photo.kind === 'stage'
      ? [
          {
            id: String(index),
            time: photo.time,
            embedding: decode(photo.embedding),
            text: photo.ocr.map(({ text }) => text).join('\n'),
            ...(photo.latitude !== undefined && { latitude: photo.latitude, longitude: photo.longitude }),
          },
        ]
      : [],
  );
  const { matches } = concertsPack.match.assign!(stage, entries, {
    ...DEFAULT_MATCH_OPTIONS,
    ...concertsPack.match.options,
    baselines,
    suggestions: 3,
  });
  const byPhoto = new Map<string, SubjectMatch>();
  for (const match of matches) {
    for (const id of match.ids) {
      byPhoto.set(id, match);
    }
  }
  for (const photo of stage) {
    const { expected } = set.photos[Number(photo.id)];
    const match = byPhoto.get(photo.id)!;
    const name = match.item === undefined ? undefined : entries[match.item].name;
    const right = expected.entry ? !!name && isSameName(expected.entry, name) : name === undefined;
    result.stagePhotos++;
    result.matched += Number(right);
    if (!expected.entry) {
      result.offList.expected++;
      result.offList.kept += Number(right);
    }
    if (!right && !match.unsure) {
      result.sureWrong++;
    }
    const time = new Date(photo.time).toISOString().slice(11, 16);
    result.lines.push(
      `${right ? 'OK ' : 'BAD'} #${photo.id.padStart(2)} ${time} ${(expected.entry ?? `(${expected.performer})`).padEnd(34)} → ${(name ?? '-').padEnd(34)} ${match.unsure ? 'unsure' : 'sure  '} ${match.score.toFixed(2)} off=${match.offList?.toFixed(2)} [${match.suggestions.map(({ item, score }) => `${entries[item].name} ${score}`).join('; ')}]`,
    );
  }

  const placePhotos: PlacePhoto[] = set.photos.flatMap((photo, index) =>
    photo.kind === 'stage' ? [] : [{ assetId: String(index), kind: 'source', ocr: getSourceOcr(photo) }],
  );
  const [place] = findPlaceNames(placePhotos, concertsPack.place);
  if (place) {
    result.place = { name: place.name, confidence: place.confidence };
  }
  return result;
};

export const runBenchmark = (fixture: Fixture) => {
  const embedder = getTextEmbedder(fixture.texts);
  const results = fixture.sets.map((set) => runSet(set, embedder.embed));
  return { results, used: embedder.used, missing: embedder.missing };
};

export const formatReport = (results: SetResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.key}: matched ${result.matched}/${result.stagePhotos} stage photos (off the list ${result.offList.kept}/` +
        `${result.offList.expected}, sure but wrong ${result.sureWrong}), acts read ${result.acts.read}/` +
        `${result.acts.expected}, songs ${result.songs.read}/${result.songs.expected}, classified ` +
        `${result.classified.correct}/${result.classified.total}` +
        (result.classified.wrong.length > 0 ? ` (${result.classified.wrong.join(', ')})` : '') +
        `, place ${result.place ? `"${result.place.name}" ${result.place.confidence}` : 'none'}, pages ${result.pages}`,
    );
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`));
    }
  }
  const matched = results.reduce((sum, result) => sum + result.matched, 0);
  const total = results.reduce((sum, result) => sum + result.stagePhotos, 0);
  lines.push(`total: ${matched}/${total} stage photos matched`);
  return lines.join('\n');
};

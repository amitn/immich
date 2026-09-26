import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CollectionKind, classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { BottleOptions, DEFAULT_BOTTLE_OPTIONS, assignBottles } from 'src/utils/collections/packs/wine/bottles.js';
import { WineLabel, parseWineName, readWineLabel } from 'src/utils/collections/packs/wine/label.js';
import { winePack } from 'src/utils/collections/packs/wine/pack.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import { combineSourceOcr } from 'src/utils/collections/source.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';
import { findLinkedPlace, groupVisits } from 'src/utils/collections/visits.js';

/**
 * A benchmark of the wine pack on real tastings: the stored and the tiled full-resolution OCR of their bottle photos
 * and signs, the CLIP embeddings and capture times of all their photos, the Food tags of the same days, and the CLIP
 * text embeddings of the prompts, captured by `capture-benchmark.mjs`. The photos are classified and grouped into
 * tastings, the labels read, the photos of one bottle grouped and named as `CollectionService.matchVisit` does with
 * the wine pack, and the tastings named as `findVisits` does; the result is scored against what each label says (see
 * `src/utils/collections/packs/wine/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons: a Thanksgiving wine tasting (2013-11-28) by Agne27,
 * CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0); a Mosel wine trip and the bottles from it
 * (2010-08-20 to 2010-09-26) by Michal Osmenda, CC BY-SA 2.0 (https://creativecommons.org/licenses/by-sa/2.0); and the
 * drinks of a lunch at Noma Australia (2016-03-24) by City Foodsters, CC BY 2.0
 * (https://creativecommons.org/licenses/by/2.0). It holds no images, only their OCR, CLIP embeddings and capture
 * times, and what each label says (the producer, the wine, the vintage and the region, as printed), to score the
 * reading.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type ExpectedLabel = {
  producer: string | null;
  wine: string | null;
  vintage: string | null;
  region: string | null;
};

/** bottle (a label to read), sign (the name of the place), or a shot of the day (cellar, vineyard, winery) */
export type PhotoKind = 'bottle' | 'sign' | 'cellar' | 'winery' | 'other';

export type Photo = {
  /** the number of the photo in its folder */
  n: string;
  kind: PhotoKind;
  time: number;
  labels?: ExpectedLabel[];
  embedding: string;
  ocr: OcrBoxInput[];
  width?: number;
  height?: number;
  passes?: OcrPass[];
  tiledMs?: number;
};

export type Session = {
  key: string;
  title: string;
  photos: Photo[];
  /** the photos the Food pack tagged on the same days: when, and `Food/<Place>` */
  linked: Array<{ time: number; tag: string }>;
};

export type Fixture = { clipModel: string; ocrModel: string; sessions: Session[]; texts: Record<string, string> };

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

/**
 * the truth of the tastings: the Mosel trip is a tasting at Max Ferd. Richter (the tasting room, its cellar and its
 * sign), a crate of bottles in Bernkastel-Kues, the J.J. Prüm house the next morning, and the bottles opened at home
 * five weeks later
 */
const TASTINGS: Record<string, (photo: Photo) => string> = {
  'thanksgiving-tasting-2013-11-28': () => 'thanksgiving',
  'noma-australia-2016-03-24': () => 'noma',
  'mosel-wine-trip-2010-08-20': ({ n }) =>
    ['01', '02', '03'].includes(n) ? 'richter' : n === '04' ? 'crate' : ['05', '06'].includes(n) ? n : 'home',
};

/** words that say what kind of producer, not which one */
const GENERIC = new Set([
  'weingut',
  'weinbau',
  'chateau',
  'domaine',
  'winery',
  'vineyards',
  'vineyard',
  'wines',
  'and',
  'des',
  'del',
  'the',
  'cut',
  'off',
  'estate',
]);

const tokens = (text: string) =>
  text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll('ß', 'ss')
    .toLowerCase()
    .replaceAll(/\(|\)|%|\d+%/g, ' ')
    .split(/[^\p{L}\d]+/u)
    .filter((word) => word.length >= 3 && !GENERIC.has(word) && !/^\d{1,3}$/.test(word));

/** "prim" is "prum", "asalgarcia" holds "garcia", "bethelhei" "bethel": what counts as reading a word */
const isRead = (word: string, read: string[]) =>
  read.some((other) => {
    if (other === word) {
      return true;
    }
    const shorter = Math.min(other.length, word.length);
    if (shorter >= 5 && (other.includes(word) || word.includes(other))) {
      return true;
    }
    const distance = [...word].length >= 4 ? editDistance(word, other) : Infinity;
    return distance <= (word.length >= 8 ? 2 : 1);
  });

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

export type FieldScore = { expected: number; read: number };

/** the fields of a name read against the label: the producer, the wine (half its words), the vintage */
export const scoreName = (name: Pick<WineLabel, 'producer' | 'wine' | 'vintage'> | undefined, label: ExpectedLabel) => {
  const all = tokens([name?.producer, name?.wine, name?.vintage].filter(Boolean).join(' '));
  const producer = label.producer
    ? !!name?.producer && tokens(label.producer).some((word) => isRead(word, tokens(name.producer!)))
    : undefined;
  const wineWords = label.wine ? tokens(label.wine) : [];
  const wine =
    wineWords.length > 0 ? wineWords.filter((word) => isRead(word, all)).length >= 0.5 * wineWords.length : undefined;
  const vintage = label.vintage ? name?.vintage === label.vintage : undefined;
  return { producer, wine, vintage };
};

const total = (score: ReturnType<typeof scoreName>) =>
  Number(!!score.producer) + Number(!!score.wine) + Number(!!score.vintage);

/**
 * the best of the scores of a photo with several labels; a name of one part ("Kudos · 2012") may be the producer or
 * the wine
 */
const scoreBest = (name: Pick<WineLabel, 'producer' | 'wine' | 'vintage'> | undefined, labels: ExpectedLabel[]) =>
  labels
    .flatMap((label) =>
      name && !name.producer && name.wine
        ? [scoreName(name, label), scoreName({ producer: name.wine, vintage: name.vintage }, label)].toSorted(
            (a, b) => total(b) - total(a),
          )[0]
        : [scoreName(name, label)],
    )
    .toSorted(
      (a, b) =>
        Number(b.producer) +
        Number(b.wine) +
        Number(b.vintage) -
        (Number(a.producer) + Number(a.wine) + Number(a.vintage)),
    )[0];

const count = (values: Array<boolean | undefined>): FieldScore => ({
  expected: values.filter((value) => value !== undefined).length,
  read: values.filter(Boolean).length,
});

export type ReadingScore = { producer: FieldScore; wine: FieldScore; vintage: FieldScore };

export type PairScore = { expected: number; found: number; wrong: number };

export type SessionResult = {
  key: string;
  bottles: number;
  /** the labels read on the bottle photos alone: from the stored OCR, the tiles, and both together */
  stored: ReadingScore;
  tiled: ReadingScore;
  combined: ReadingScore;
  /** the names match_subjects gives the bottles (the readings of a bottle's photos together) */
  named: ReadingScore;
  /** named surely but wrong: a field of a sure name that the label contradicts */
  sureWrong: number;
  sure: number;
  /** pairs of photos of one bottle: found, and pairs of two bottles put together */
  sameBottle: PairScore;
  /** pairs of photos of one tasting: found, and pairs of two tastings put together */
  sameTasting: PairScore;
  classification: { bottles: number; bottlesFound: number; signs: number; signsFound: number; othersAsBottles: number };
  places: string[];
  tiledMs: number;
  lines: string[];
  used: string[];
  missing: string[];
};

const emptyReading = (): ReadingScore => ({
  producer: { expected: 0, read: 0 },
  wine: { expected: 0, read: 0 },
  vintage: { expected: 0, read: 0 },
});

const addReading = (score: ReadingScore, reading: ReturnType<typeof scoreName>) => {
  for (const key of ['producer', 'wine', 'vintage'] as const) {
    const { expected, read } = count([reading[key]]);
    score[key].expected += expected;
    score[key].read += read;
  }
};

const sameLabel = (a: ExpectedLabel, b: ExpectedLabel) => a.producer === b.producer && a.wine === b.wine;

const pairs = <T>(values: T[]) => values.flatMap((a, i) => values.slice(i + 1).map((b) => [a, b] as const));

const runSession = (
  session: Session,
  texts: Map<string, Float32Array>,
  bottleOptions: BottleOptions,
): SessionResult => {
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

  const photos = session.photos.map((photo, index) => {
    const tiled = photo.passes ? mergeOcrPasses(photo.width!, photo.height!, photo.passes) : undefined;
    return {
      ...photo,
      id: String(index),
      vector: decode(photo.embedding),
      tiled,
      combined: tiled ? combineSourceOcr(photo.ocr, tiled) : photo.ocr,
    };
  });

  // classification (from the stored OCR and CLIP) and tastings, as find_visits
  const prompts = getPromptList(winePack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  const rules = {
    parse: winePack.source.parse,
    receiptWords: winePack.classify.receiptWords,
    placeWords: winePack.place.words,
  };
  const classifications = photos.map((photo) =>
    classifyPhoto(winePack.classify, prompts, {
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
  const visits = groupVisits(found, winePack.visits.options);
  const tastingOf = TASTINGS[session.key];
  const linked = session.linked.map(({ time, tag }, index) => ({
    id: `food-${index}`,
    time,
    place: tag.split('/')[1],
  }));
  const places = visits.map((visit) => {
    const byTime = visit.map(({ id }) => photos[Number(id)].time);
    const link = findLinkedPlace({ start: Math.min(...byTime), end: Math.max(...byTime) }, linked);
    if (link) {
      return `${link.name} (tag)`;
    }
    const read = visit.flatMap(({ id, kind }) =>
      kind === 'subject'
        ? []
        : [{ assetId: id, kind: kind as 'sign' | 'source' | 'receipt', ocr: photos[Number(id)].ocr }],
    );
    const [candidate] = findPlaceNames(read, winePack.place);
    return candidate ? `${candidate.name} (${candidate.source})` : '(fallback)';
  });

  // readings of the labels
  const bottles = photos.filter((photo) => photo.kind === 'bottle');
  const stored = emptyReading();
  const tiled = emptyReading();
  const combined = emptyReading();
  for (const photo of bottles) {
    addReading(stored, scoreBest(readWineLabel(photo.ocr), photo.labels!));
    addReading(tiled, scoreBest(photo.tiled ? readWineLabel(photo.tiled) : undefined, photo.labels!));
    addReading(combined, scoreBest(readWineLabel(photo.combined), photo.labels!));
  }

  // match_subjects on the subjects of each tasting
  const options: AssignOptions = { ...DEFAULT_MATCH_OPTIONS, ...winePack.match.options, baselines: [], suggestions: 3 };
  const named = emptyReading();
  const result: SessionResult = {
    key: session.key,
    bottles: bottles.length,
    stored,
    tiled,
    combined,
    named,
    sureWrong: 0,
    sure: 0,
    sameBottle: { expected: 0, found: 0, wrong: 0 },
    sameTasting: { expected: 0, found: 0, wrong: 0 },
    classification: {
      bottles: bottles.length,
      bottlesFound: bottles.filter((photo) => kinds[Number(photo.id)] === 'subject').length,
      signs: photos.filter((photo) => photo.kind === 'sign').length,
      signsFound: photos.filter((photo) => photo.kind === 'sign' && kinds[Number(photo.id)] === 'sign').length,
      othersAsBottles: photos.filter((photo) => photo.kind !== 'bottle' && kinds[Number(photo.id)] === 'subject')
        .length,
    },
    places,
    tiledMs: Math.round(bottles.reduce((sum, photo) => sum + (photo.tiledMs ?? 0), 0) / Math.max(1, bottles.length)),
    lines: [],
    used,
    missing,
  };

  const bottleOf = new Map<string, string>();
  for (const visit of visits) {
    const subjects = visit.filter(({ kind }) => kind === 'subject').map(({ id }) => photos[Number(id)]);
    if (subjects.length === 0) {
      continue;
    }
    const { matches, entries = [] } = assignBottles(
      subjects.map((photo) => ({ id: photo.id, time: photo.time, embedding: photo.vector, ocr: photo.combined })),
      [],
      options,
      bottleOptions,
    );
    for (const [index, match] of matches.entries()) {
      const name = match.item === undefined ? undefined : entries[match.item]?.name;
      for (const id of match.ids) {
        bottleOf.set(id, `${visit[0].id}:${index}`);
        const photo = photos[Number(id)];
        if (photo.kind !== 'bottle') {
          result.lines.push(`    ${photo.n} ${photo.kind} taken for a bottle: ${name}`);
          continue;
        }
        const parts = name ? parseWineName(name) : undefined;
        const score = scoreBest(parts, photo.labels!);
        addReading(named, score);
        // a part of the name the label contradicts: another producer or vintage, or less than half of the wine
        const label = photo.labels![0];
        const wrong =
          (!!parts?.producer && score.producer === false) ||
          (!!parts?.vintage && label.vintage !== parts.vintage) ||
          (!!parts?.wine && score.wine === false);
        if (!match.unsure) {
          result.sure++;
          result.sureWrong += Number(wrong);
        }
        const fields = (['producer', 'wine', 'vintage'] as const)
          .map((key) => `${key[0]}${score[key] === undefined ? '-' : score[key] ? '+' : 'x'}`)
          .join(' ');
        const scores = classifications[Number(id)].scores;
        result.lines.push(
          `${photo.n} [s${scores.subject.toFixed(2)} src${scores.source.toFixed(2)} sign${scores.sign.toFixed(2)}] bottle ${index}${match.ids.length > 1 ? `(${match.ids.map((other) => photos[Number(other)].n).join('+')})` : ''} ${fields} ${match.unsure ? 'unsure' : 'SURE'} ${match.score.toFixed(2)} "${name ?? '-'}" expected "${[photo.labels![0].producer, photo.labels![0].wine, photo.labels![0].vintage].filter(Boolean).join(' · ')}"`,
        );
      }
    }
  }

  for (const photo of photos.filter((item) => item.kind !== 'bottle')) {
    const scores = classifications[Number(photo.id)].scores;
    result.lines.push(
      `${photo.n} ${photo.kind} taken for ${kinds[Number(photo.id)]} [s${scores.subject.toFixed(2)} src${scores.source.toFixed(2)} sign${scores.sign.toFixed(2)} other${scores.other.toFixed(2)}]`,
    );
  }
  for (const photo of bottles.filter((item) => kinds[Number(item.id)] !== 'subject')) {
    const scores = classifications[Number(photo.id)].scores;
    result.lines.push(
      `${photo.n} bottle MISSED as ${kinds[Number(photo.id)]} [s${scores.subject.toFixed(2)} src${scores.source.toFixed(2)} sign${scores.sign.toFixed(2)} other${scores.other.toFixed(2)}]`,
    );
  }
  for (const [a, b] of pairs(bottles)) {
    const same = a.labels!.some((label) => b.labels!.some((other) => sameLabel(label, other)));
    const together = !!bottleOf.get(a.id) && bottleOf.get(a.id) === bottleOf.get(b.id);
    result.sameBottle.expected += Number(same);
    result.sameBottle.found += Number(same && together);
    result.sameBottle.wrong += Number(!same && together);
  }
  const visitOf = new Map(visits.flatMap((visit, index) => visit.map(({ id }) => [id, index] as const)));
  // two visits of one day named after the same place (the drinks of a long meal) are saved as one tasting
  const day = (index: number) => new Date(photos[Number(visits[index][0].id)].time).toISOString().slice(0, 10);
  const sameTasting = (a: number, b: number) =>
    a === b || (places[a] === places[b] && !places[a].endsWith('(fallback)') && day(a) === day(b));
  const scored = photos.filter((photo) => photo.kind === 'bottle' || photo.kind === 'sign');
  for (const [a, b] of pairs(scored)) {
    const same = tastingOf(a) === tastingOf(b);
    const together = visitOf.has(a.id) && visitOf.has(b.id) && sameTasting(visitOf.get(a.id)!, visitOf.get(b.id)!);
    result.sameTasting.expected += Number(same);
    result.sameTasting.found += Number(same && together);
    result.sameTasting.wrong += Number(!same && together);
  }
  return result;
};

export const runBenchmark = (fixture: Fixture, bottleOptions: Partial<BottleOptions> = {}) => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.sessions.map((session) => runSession(session, texts, { ...DEFAULT_BOTTLE_OPTIONS, ...bottleOptions }));
};

const fraction = ({ read, expected }: FieldScore) => `${read}/${expected}`;
const reading = (score: ReadingScore) =>
  `producer ${fraction(score.producer)}, wine ${fraction(score.wine)}, vintage ${fraction(score.vintage)}`;

export const formatReport = (results: SessionResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    const { classification: c, sameBottle, sameTasting } = result;
    lines.push(
      `${result.key}: ${result.bottles} bottle photos (${c.bottlesFound} found, ${c.othersAsBottles} other shots taken for bottles, signs ${c.signsFound}/${c.signs}); ` +
        `labels read: stored OCR ${reading(result.stored)}; tiles ${reading(result.tiled)}; both ${reading(result.combined)}; ` +
        `named ${reading(result.named)}, ${result.sure} sure (${result.sureWrong} wrong); ` +
        `same bottle ${sameBottle.found}/${sameBottle.expected} pairs (${sameBottle.wrong} wrong); same tasting ${sameTasting.found}/${sameTasting.expected} pairs (${sameTasting.wrong} wrong); ` +
        `places: ${result.places.join(', ')}; ${result.tiledMs} ms of tiled OCR per bottle`,
    );
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`));
    }
  }
  return lines.join('\n');
};

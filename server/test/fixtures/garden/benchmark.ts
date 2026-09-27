import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CollectionKind, classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { AssignEntry, AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { gardenPack } from 'src/utils/collections/packs/garden/pack.js';
import {
  DEFAULT_PLANT_OPTIONS,
  PLANT_PROMPTS,
  PlantOptions,
  assignPlants,
  getGrowthStage,
} from 'src/utils/collections/packs/garden/plants.js';
import { chooseSourceOcr, mergeSourceEntries } from 'src/utils/collections/source.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';
import { groupVisits } from 'src/utils/collections/visits.js';

/**
 * A benchmark of the garden pack on two real gardens, captured by `capture-benchmark.mjs`: the stored and the tiled
 * full-resolution OCR of their plant tags and seed packets, the CLIP embeddings and capture times of every photo, and
 * the text embeddings of the prompts. The photos are classified and grouped into a garden as `findVisits` does, the
 * tags and packets read, and the plant photos assigned to the plants as `CollectionService.matchVisit` does with the
 * pack: once with what OCR reads, and once with the varieties the assistant reads on the tags, passed as entries in
 * the order of the sources. The result is scored against the plant each photo shows and its growth stage (see
 * `src/utils/collections/packs/garden/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons by Forest and Kim Starr, CC BY 3.0 US
 * (https://creativecommons.org/licenses/by/3.0/us): four young "Tropic" peach trees at Hawea Pl, Olinda, Maui
 * (2013-2016), and lettuce beds and seed packets in Makawao, Maui (2008). It holds no images, only their OCR, CLIP
 * embeddings and capture times, and what each photo shows (the plant, its stage), to score the matching.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type Variety = { variety: string; common: string };

export type Photo = {
  n: string;
  kind: 'tag' | 'packet' | 'plant';
  /** the plant a photo shows (null for another or an unknown one) */
  plant?: string | null;
  /** the plants a tag or a packet names */
  plants?: string[];
  stage?: string;
  note?: string;
  date: string;
  time: number;
  embedding: string;
  ocr: OcrBoxInput[];
  width?: number;
  height?: number;
  passes?: OcrPass[];
  tiledMs?: number;
};

export type GardenSet = { key: string; title: string; varieties: Record<string, Variety>; photos: Photo[] };

export type Fixture = { clipModel: string; ocrModel: string; sets: GardenSet[]; texts: Record<string, string> };

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
 * the photos whose tree the photographers were unsure of: "Tropic Snow perhaps" (the tag and the tree of 2015), and
 * the 2016 tree "labeled Snow but probably Sweet": either name is right
 */
const UNSURE: Record<string, { photos: string[]; plants: string[] }> = {
  'starr-hawea-pl-tropic-peaches-2013-2016': { photos: ['35', '36', '43'], plants: ['tropic_snow', 'tropic_sweet'] },
};

/**
 * the photos whose ground truth the photos contradict: two "flowering habit" photos of 2015 show the tags of Tropic
 * Sweet and Tropic Beauty, embossed in the metal (their Commons titles name the tree the tags stand under)
 */
const CORRECTIONS: Record<string, Record<string, Partial<Photo>>> = {
  'starr-hawea-pl-tropic-peaches-2013-2016': {
    '30': { kind: 'tag', plants: ['tropic_sweet'], plant: undefined, stage: undefined },
    '33': { kind: 'tag', plants: ['tropic_beauty'], plant: undefined, stage: undefined },
  },
};

/** "Peach 'Tropic Prince'" of Prunus persica 'Tropic Prince', a Tropic Prince peach: the name the assistant saves */
export const getVarietyName = ({ variety, common }: Variety) => {
  const crop = common.split(' ').at(-1)!;
  const name = /'([^']+)'/.exec(variety)?.[1] ?? variety;
  return `${crop.charAt(0).toUpperCase()}${crop.slice(1)} '${name}'`;
};

/**
 * the stage the photographers gave a photo, in the words of the pack: flowering, fruit (unripe or ripe), seedlings,
 * bolting, seeds; none for a whole tree in leaf, bare or at the end of its season, or for leaves
 */
export const getExpectedStage = (stage: string) => {
  const text = stage.toLowerCase();
  if (
    /finished|past peak|habit|in leaf|summer|bare|first year|leaves|plant|head/.test(text) &&
    !/flowering/.test(text)
  ) {
    return /fruiting|bolt/.test(text) ? (/bolt/.test(text) ? 'bolting' : 'fruit') : undefined;
  }
  if (/flower/.test(text)) {
    return 'flowering';
  }
  if (/bolt/.test(text)) {
    return 'bolting';
  }
  if (/fruit/.test(text)) {
    return 'fruit';
  }
  if (/seedling/.test(text)) {
    return 'seedlings';
  }
  if (/seeds/.test(text)) {
    return 'seeds';
  }
};

export type PairScore = { expected: number; found: number; wrong: number };

export type RunScore = {
  /** plant photos of a known plant given its name, another name, or none */
  named: number;
  wrong: number;
  unnamed: number;
  /** named surely, and of those the wrong ones */
  sure: number;
  sureWrong: number;
  samePlant: PairScore;
};

export type SetResult = {
  key: string;
  classification: {
    sources: number;
    sourcesFound: number;
    plants: number;
    plantsFound: number;
    plantsAsSources: number;
  };
  /** the varieties read on the tags and packets by OCR, and the tags and packets that read nothing */
  read: { names: string[]; unread: number };
  /** with the OCR alone, and with the varieties the assistant reads on the tags */
  ocr: RunScore;
  assisted: RunScore;
  /** plant photos, the growth stages told, told right, and told though another stage (or none) is expected */
  stages: { photos: number; told: number; right: number; wrong: number };
  lines: string[];
  used: string[];
  missing: string[];
};

const pairs = <T>(values: T[]) => values.flatMap((a, i) => values.slice(i + 1).map((b) => [a, b] as const));

const emptyRun = (): RunScore => ({
  named: 0,
  wrong: 0,
  unnamed: 0,
  sure: 0,
  sureWrong: 0,
  samePlant: { expected: 0, found: 0, wrong: 0 },
});

const runSet = (set: GardenSet, texts: Map<string, Float32Array>, plantOptions: PlantOptions): SetResult => {
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

  const photos = set.photos.map((original, index) => {
    const photo = { ...original, ...CORRECTIONS[set.key]?.[original.n] };
    const tiled = photo.passes ? mergeOcrPasses(photo.width!, photo.height!, photo.passes) : undefined;
    return {
      ...photo,
      id: String(index),
      vector: decode(photo.embedding),
      // a source is read from the tiles, unless the stored OCR reads more (as readSource does)
      read: tiled && chooseSourceOcr(photo.ocr, tiled) === 'tiles' ? tiled : photo.ocr,
    };
  });

  const prompts = getPromptList(gardenPack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  const plantPrompts = PLANT_PROMPTS.map((text) => embed(text));
  const rules = {
    parse: gardenPack.source.parse,
    receiptWords: gardenPack.classify.receiptWords,
    placeWords: gardenPack.place.words,
  };
  const classifications = photos.map((photo) =>
    classifyPhoto(gardenPack.classify, prompts, {
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
  const visits = groupVisits(found, gardenPack.visits.options);

  const isSource = (photo: (typeof photos)[number]) => photo.kind !== 'plant';
  const result: SetResult = {
    key: set.key,
    classification: {
      sources: photos.filter((photo) => isSource(photo)).length,
      sourcesFound: photos.filter((photo) => isSource(photo) && kinds[Number(photo.id)] === 'source').length,
      plants: photos.filter((photo) => !isSource(photo)).length,
      plantsFound: photos.filter((photo) => !isSource(photo) && kinds[Number(photo.id)] === 'subject').length,
      plantsAsSources: photos.filter((photo) => !isSource(photo) && kinds[Number(photo.id)] === 'source').length,
    },
    read: { names: [], unread: 0 },
    ocr: emptyRun(),
    assisted: emptyRun(),
    stages: { photos: 0, told: 0, right: 0, wrong: 0 },
    lines: [],
    used,
    missing,
  };

  const unsure = UNSURE[set.key];
  const accepts = (photo: (typeof photos)[number], name: string | undefined) => {
    const plants = unsure?.photos.includes(photo.n) ? unsure.plants : photo.plant ? [photo.plant] : [];
    return !!name && plants.some((plant) => getVarietyName(set.varieties[plant]) === name);
  };

  const options = (sources: typeof photos): AssignOptions => ({
    ...DEFAULT_MATCH_OPTIONS,
    ...gardenPack.match.options,
    baselines: [],
    suggestions: 3,
    sources: sources.map(({ id, time, vector }) => ({ id, time, embedding: vector })),
    prompts: plantPrompts,
  });

  const score = (run: RunScore, label: string, visit: typeof photos, entries: AssignEntry[], checked: Set<number>) => {
    const sources = visit.filter((photo) => kinds[Number(photo.id)] === 'source');
    const subjects = visit.filter((photo) => kinds[Number(photo.id)] === 'subject');
    const { matches } = assignPlants(
      subjects.map(({ id, time, vector }) => ({ id, time, embedding: vector })),
      entries,
      options(sources),
      plantOptions,
    );
    const plantOf = new Map<string, string>();
    for (const [index, match] of matches.entries()) {
      const name = match.item === undefined ? undefined : entries[match.item].name;
      const sure = !match.unsure && (match.item === undefined || !checked.has(match.item));
      for (const id of match.ids) {
        plantOf.set(id, String(index));
        const photo = photos[Number(id)];
        // a photo of an unknown plant (another lettuce) is wrong only when it gets the name of a known one
        const known = new Set(Object.values(set.varieties).map((variety) => getVarietyName(variety)));
        if (!photo.plant && !(name && known.has(name))) {
          continue;
        }
        const right = accepts(photo, name);
        if (!name) {
          run.unnamed += Number(!!photo.plant);
        } else if (right) {
          run.named++;
        } else {
          run.wrong++;
        }
        if (name && sure) {
          run.sure++;
          run.sureWrong += Number(!right);
        }
        result.lines.push(
          `${label} ${photo.n} ${photo.date} plant ${index} ${sure ? 'SURE' : 'unsure'} "${name ?? '-'}"${match.suggestions[0] && !name ? ` (suggests ${entries[match.suggestions[0].item]?.name} ${match.suggestions[0].score})` : ''} expected ${photo.plant ?? '-'}${right ? ' ✓' : ''}`,
        );
      }
    }
    const plants = subjects.filter((photo) => photo.kind === 'plant');
    for (const [a, b] of pairs(plants)) {
      const same = !!a.plant && a.plant === b.plant;
      const together = plantOf.has(a.id) && plantOf.get(a.id) === plantOf.get(b.id);
      run.samePlant.expected += Number(same);
      run.samePlant.found += Number(same && together);
      // photos of unknown plants put together are not wrong unless they are two known plants
      run.samePlant.wrong += Number(!!a.plant && !!b.plant && a.plant !== b.plant && together);
    }
  };

  for (const [visitIndex, members] of visits.entries()) {
    const visit = members.map(({ id }) => photos[Number(id)]);
    const sources = visit.filter((photo) => kinds[Number(photo.id)] === 'source');
    // what OCR reads on the tags and packets, as matchVisit reads the sourceIds
    const readings = sources.map((photo) => ({ ...gardenPack.source.parse(photo.read), assetId: photo.id }));
    const merged = mergeSourceEntries(readings);
    result.read.unread += readings.filter(({ items }) => items.length === 0).length;
    result.read.names.push(...merged.map(({ item }) => item.name));
    const read = merged.map(({ sourceId, item }) => ({ name: item.name, sourceId }));
    const checked = new Set(merged.flatMap(({ item }, index) => (item.check ? [index] : [])));
    score(result.ocr, `v${visitIndex} ocr`, visit, read, checked);
    // the assistant reads every tag and packet, and passes the varieties in the order of the sources
    // (a plant photo taken for a source is named after its plant: the seeds of a packet are its variety)
    const given = sources.map((photo) => {
      const plant = photo.plants?.[0] ?? photo.plant;
      return { name: plant ? getVarietyName(set.varieties[plant]) : 'Lettuce' };
    });
    score(result.assisted, `v${visitIndex} assisted`, visit, given, new Set());
  }

  for (const photo of photos) {
    if (photo.kind !== 'plant' || !photo.stage) {
      continue;
    }
    const stage = getGrowthStage(
      plantPrompts.map((prompt) => dot(photo.vector, prompt)),
      plantOptions.minStage,
    );
    const expected = getExpectedStage(photo.stage);
    result.stages.photos++;
    result.stages.told += Number(!!stage);
    result.stages.right += Number(!!stage && stage === expected);
    result.stages.wrong += Number(!!stage && stage !== expected);
    result.lines.push(`stage ${photo.n} ${stage ?? '-'} expected ${expected ?? '-'} (${photo.stage})`);
  }
  for (const photo of photos) {
    const kind = kinds[Number(photo.id)];
    if (isSource(photo) ? kind === 'source' : kind === 'subject') {
      continue;
    }
    const { scores } = classifications[Number(photo.id)];
    result.lines.push(
      `${photo.n} ${photo.kind} taken for ${kind} [s${scores.subject.toFixed(2)} src${scores.source.toFixed(2)} other${scores.other.toFixed(2)}]`,
    );
  }
  return result;
};

export const runBenchmark = (fixture: Fixture, plantOptions: Partial<PlantOptions> = {}) => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.sets.map((set) => runSet(set, texts, { ...DEFAULT_PLANT_OPTIONS, ...plantOptions }));
};

const pair = ({ found, expected, wrong }: PairScore) => `${found}/${expected} (${wrong} wrong)`;
const run = (score: RunScore) =>
  `named ${score.named}, wrong ${score.wrong}, unnamed ${score.unnamed}, ${score.sure} sure (${score.sureWrong} wrong), same plant ${pair(score.samePlant)}`;

export const formatReport = (results: SetResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    const c = result.classification;
    lines.push(
      `${result.key}: sources ${c.sourcesFound}/${c.sources}, plants ${c.plantsFound}/${c.plants} (${c.plantsAsSources} taken for sources); ` +
        `read ${result.read.names.join(', ') || '-'} (${result.read.unread} unread); OCR: ${run(result.ocr)}; ` +
        `assisted: ${run(result.assisted)}; stages told ${result.stages.told}/${result.stages.photos}, right ${result.stages.right}, wrong ${result.stages.wrong}`,
    );
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`));
    }
  }
  return lines.join('\n');
};

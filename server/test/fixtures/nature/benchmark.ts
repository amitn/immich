import { classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { DEFAULT_MATCH_OPTIONS, MatchOptions, SubjectMatch } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { readPlantLabel } from 'src/utils/collections/packs/nature/label.js';
import { naturePack } from 'src/utils/collections/packs/nature/pack.js';
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
 * A benchmark of the nature pack on real garden walks: the stored and the tiled full-resolution OCR of their labels,
 * the CLIP embeddings and capture times of every photo, and the CLIP text embeddings of the prompts and of the species
 * read on the labels, captured by `capture-benchmark.mjs`. The photos are classified, the labels read and the plants
 * paired with them as `CollectionService.findVisits` and `matchVisit` do with the nature pack, and the result is scored
 * against what each photo shows (see `src/utils/collections/packs/nature/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons: Kahanu Garden, Hāna, Maui (2012-06-06) by Forest
 * and Kim Starr, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0), and the rose border of the walled kitchen
 * garden of Copped Hall, Epping (2025-06-01) by Acabashi, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0).
 * It holds no images, only their OCR, CLIP embeddings, capture times, and what each photo shows.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type ExpectedTaxon = {
  id: string;
  scientific: string;
  common: string | null;
  family: string | null;
  cultivar: string | null;
};

export type Photo = {
  kind: 'plant' | 'label';
  time: number;
  embedding: string;
  ocr: OcrBoxInput[];
  width?: number;
  height?: number;
  passes?: OcrPass[];
  /** a label: the species it names; a plant: the labelled species it is, null when no label was photographed */
  expected: { taxa?: ExpectedTaxon[]; taxon?: string | null; entry?: ExpectedTaxon | null };
};

export type Walk = { key: string; place: string; photos: Photo[] };

export type Fixture = TextFixture & { ocrModel: string; sets: Walk[] };

export const loadFixture = () => loadGzipJson<Fixture>(FIXTURE);

export const updateTexts = (fixture: Fixture, used: Set<string>, url: string) => update(FIXTURE, fixture, used, url);

export type WalkResult = {
  key: string;
  /** plant photos, and those paired with the right label (or with none, when no label was photographed) */
  plants: number;
  paired: number;
  /** plants without a label, and those left off the list */
  offList: { expected: number; kept: number };
  sureWrong: number;
  /** the labels, and the names read on them */
  labels: number;
  scientific: { expected: number; read: number };
  common: { expected: number; read: number };
  family: { expected: number; read: number };
  cultivar: { expected: number; read: number };
  classified: { total: number; correct: number; wrong: string[] };
  place?: { name: string; confidence: number };
  /** the species of labels none of whose photos was paired */
  unmatched: string[];
  lines: string[];
};

const EXPECTED_KIND = { plant: 'subject', label: 'source' } as const;

const getLabelOcr = (photo: Photo) => {
  const detailed = mergeOcrPasses(photo.width!, photo.height!, photo.passes ?? []);
  return chooseSourceOcr(photo.ocr, detailed) === 'tiles' ? detailed : photo.ocr;
};

/** the families of the tags are read as printed ("Sterculiaceae", now part of Malvaceae) */
const isSameFamily = (expected: string, read: string) =>
  expected.split(/[\s()]+/).some((family) => family && isSameName(family, read, 0.8));

const runWalk = (walk: Walk, embed: (text: string) => Float32Array, options: Partial<MatchOptions>): WalkResult => {
  const result: WalkResult = {
    key: walk.key,
    plants: 0,
    paired: 0,
    offList: { expected: 0, kept: 0 },
    sureWrong: 0,
    labels: 0,
    scientific: { expected: 0, read: 0 },
    common: { expected: 0, read: 0 },
    family: { expected: 0, read: 0 },
    cultivar: { expected: 0, read: 0 },
    classified: { total: 0, correct: 0, wrong: [] },
    unmatched: [],
    lines: [],
  };

  const prompts = getPromptList(naturePack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  for (const [index, photo] of walk.photos.entries()) {
    const { kind, scores } = classifyPhoto(naturePack.classify, prompts, {
      similarities: promptEmbeddings.map((prompt) => dot(decode(photo.embedding), prompt)),
      ocr: summarizeText(photo.ocr, {
        parse: naturePack.source.parse,
        receiptWords: naturePack.classify.receiptWords,
        placeWords: naturePack.place.words,
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

  // the labels, read into species, each with the time of its photo
  const readings = walk.photos.flatMap((photo, index) => {
    if (photo.kind !== 'label') {
      return [];
    }
    const boxes = getLabelOcr(photo);
    const aspectRatio = photo.width! / photo.height!;
    const taxon = readPlantLabel(boxes, { aspectRatio });
    const [expected] = photo.expected.taxa!;
    result.labels++;
    const score = (key: 'scientific' | 'common' | 'family' | 'cultivar', same: (a: string, b: string) => boolean) => {
      const wanted = expected[key];
      if (!wanted) {
        return;
      }
      result[key].expected++;
      const read = taxon?.[key];
      const right = !!read && same(wanted, read);
      result[key].read += Number(right);
      if (!right) {
        result.lines.push(`  ${key} of #${index} not read: ${wanted} (read ${read ?? '-'})`);
      }
    };
    score('scientific', (a, b) => isSameName(a, b, 0.7));
    // a tag lists common names in a line of their own: the first one counts
    score('common', (a, b) => a.split(/,\s*/).some((name) => isSameName(name, b, 0.6)));
    score('family', isSameFamily);
    score('cultivar', (a, b) => isSameName(a, b, 0.6));
    return [{ ...naturePack.source.parse(boxes, { aspectRatio }), assetId: String(index) }];
  });
  const merged = mergeSourceEntries(readings, { repeats: naturePack.source.repeats });
  const entries = merged.map(({ item, sourceId }) => ({
    name: item.name,
    ...(item.description && { description: item.description }),
    embedding: embed(naturePack.source.prompt(item)),
    sourceTime: walk.photos[Number(sourceId)].time,
  }));
  const baselines = naturePack.match.offListPrompts.map((text) => embed(text));

  const plants = walk.photos.flatMap((photo, index) =>
    photo.kind === 'plant' ? [{ id: String(index), time: photo.time, embedding: decode(photo.embedding) }] : [],
  );
  const { matches } = naturePack.match.assign!(plants, entries, {
    ...DEFAULT_MATCH_OPTIONS,
    ...naturePack.match.options,
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
  for (const plant of plants) {
    const { expected } = walk.photos[Number(plant.id)];
    const match = byPhoto.get(plant.id)!;
    const label = match.item === undefined ? undefined : walk.photos[Number(merged[match.item].sourceId)];
    const got = label?.expected.taxa?.[0].id;
    const right = (expected.entry?.id ?? undefined) === got;
    result.plants++;
    result.paired += Number(right);
    if (!expected.entry) {
      result.offList.expected++;
      result.offList.kept += Number(right);
    }
    if (!right && !match.unsure) {
      result.sureWrong++;
    }
    result.lines.push(
      `${right ? 'OK ' : 'BAD'} #${plant.id.padStart(2)} expected=${(expected.entry?.id ?? `(${expected.taxon ?? '-'})`).padEnd(34)} got=${(got ?? '-').padEnd(24)} ${match.unsure ? 'unsure' : 'sure  '} ${match.score.toFixed(2)} off=${match.offList?.toFixed(2)} ${match.item === undefined ? '' : entries[match.item].name}`,
    );
  }

  // the labels none of whose entries was matched
  const matched = new Set(matches.flatMap(({ item }) => (item === undefined ? [] : [merged[item].sourceId])));
  result.unmatched = merged.filter(({ sourceId }) => !matched.has(sourceId)).map(({ item }) => item.name);

  const placePhotos: PlacePhoto[] = walk.photos.flatMap((photo, index) =>
    photo.kind === 'label' ? [{ assetId: String(index), kind: 'source', ocr: getLabelOcr(photo) }] : [],
  );
  const [place] = findPlaceNames(placePhotos, naturePack.place);
  if (place) {
    result.place = { name: place.name, confidence: place.confidence };
  }
  return result;
};

/** runs the benchmark, with other match options to try them */
export const runBenchmark = (fixture: Fixture, options: Partial<MatchOptions> = {}) => {
  const embedder = getTextEmbedder(fixture.texts);
  const results = fixture.sets.map((walk) => runWalk(walk, embedder.embed, options));
  return { results, used: embedder.used, missing: embedder.missing };
};

const ratio = ({ read, expected }: { read: number; expected: number }) => `${read}/${expected}`;

export const formatReport = (results: WalkResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.key}: paired ${result.paired}/${result.plants} plant photos (off the list ` +
        `${ratio({ read: result.offList.kept, expected: result.offList.expected })}, ` +
        `sure but wrong ${result.sureWrong}), labels ${result.labels}: scientific ${ratio(result.scientific)}, common ` +
        `${ratio(result.common)}, family ${ratio(result.family)}, cultivar ${ratio(result.cultivar)}, classified ` +
        `${result.classified.correct}/${result.classified.total}` +
        (result.classified.wrong.length > 0 ? ` (${result.classified.wrong.join(', ')})` : '') +
        `, garden ${result.place ? `"${result.place.name}" ${result.place.confidence}` : 'none'}, unmatched ` +
        `labels ${result.unmatched.length}`,
    );
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`), ...result.unmatched.map((name) => `  unmatched: ${name}`));
    }
  }
  const paired = results.reduce((sum, result) => sum + result.paired, 0);
  const plants = results.reduce((sum, result) => sum + result.plants, 0);
  lines.push(`total: ${paired}/${plants} paired`);
  return lines.join('\n');
};

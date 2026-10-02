import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CollectionKind, classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { MatchOptions, SubjectMatch, matchSubjects } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { cookbookPack } from 'src/utils/collections/packs/cookbook/pack.js';
import { RESULT_ENTRY, RecipePage, readRecipes } from 'src/utils/collections/packs/cookbook/recipe.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import {
  ParsedSource,
  chooseReading,
  chooseSourceOcr,
  getTitlePrompt,
  mergeSourceEntries,
} from 'src/utils/collections/source.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';
import { groupVisits } from 'src/utils/collections/visits.js';

/**
 * A benchmark of the cookbook pack on real cooking sessions: the stored and the tiled full-resolution OCR of their
 * recipe pages, the CLIP embeddings and capture times of all their photos, and the CLIP text embeddings of the
 * prompts, captured by `capture-benchmark.mjs`. The recipes are read, the photos classified and grouped into visits,
 * and the photos of the cooking matched with the steps as `CollectionService.matchVisit` does with the cookbook pack;
 * the result is scored against what each photo shows (see `src/utils/collections/packs/cookbook/benchmark.spec.ts`).
 *
 * `benchmark.json.gz` is derived from photos by Mack Male (https://www.flickr.com/people/24311648@N00), CC BY-SA 2.0
 * (https://creativecommons.org/licenses/by-sa/2.0), via Wikimedia Commons: a quiche (2006-11-15), a farmer's casserole
 * (2006-12-22) and simple cupcakes (2008-04-05). It holds no images, only their OCR, CLIP embeddings and capture
 * times, what each photo shows, and of each recipe (the printed pages remain their publishers') the title, the
 * ingredient lines and the first words of the steps, to score the reading.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type PhotoKind = 'recipe' | 'step' | 'result' | 'other';

export type Photo = {
  kind: PhotoKind;
  time: number;
  /** the step a step photo shows */
  step?: { section: string; n: number };
  embedding: string;
  ocr: OcrBoxInput[];
  width?: number;
  height?: number;
  passes?: OcrPass[];
  tiledMs?: number;
};

export type ExpectedStep = {
  section: string;
  n: number;
  /** how much of the step is legible on the photo: full, partial, fragment, blurred or no */
  visible: string;
  words?: string;
};

export type Session = {
  key: string;
  title: string;
  ingredients: string[];
  steps: ExpectedStep[];
  photos: Photo[];
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

/**
 * Adds the missing text embeddings to the fixture, from the machine learning server, and drops the ones no longer
 * used, so that the fixture holds the texts of the current prompts and recipe reading.
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
    .replaceAll(/[^\p{L}\d½⅓⅔¼¾⅛⅜⅝⅞]+/gu, ' ')
    .trim();

const bigrams = (text: string) => {
  const compact = text.replaceAll(' ', '');
  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
};

/** the share of letter pairs two texts have in common (Dice), 0..1 */
export const similarity = (a: string, b: string) => {
  const x = bigrams(normalize(a));
  const y = bigrams(normalize(b));
  if (x.length === 0 || y.length === 0) {
    return 0;
  }
  const pool = [...y];
  let shared = 0;
  for (const gram of x) {
    const index = pool.indexOf(gram);
    if (index === -1) {
      continue;
    }

    shared++;
    pool.splice(index, 1);
  }
  return (2 * shared) / (x.length + y.length);
};

/** the quantity at the start of an ingredient line, e.g. "1½", "¾", "4" */
const quantityOf = (text: string) => /^[\d½⅓⅔¼¾⅛⅜⅝⅞]+/.exec(text.trim())?.[0];

/** the expected section of a step, e.g. "frosting", as the parser names it: undefined for the main recipe */
const isSameSection = (expected: string, main: string, section?: string) =>
  expected === main ? section === undefined : !!section && normalize(section).includes(normalize(expected));

export type SessionResult = {
  key: string;
  /** what the parser read on the recipe page, from the tiled OCR unless the stored OCR reads more */
  ocr: 'tiles' | 'stored';
  title?: string;
  titleOk: boolean;
  alternatives: string[];
  /** the recipe the matcher kept, among the recipes of the page (by CLIP) */
  chosen?: string;
  ingredients: { expected: number; read: number; found: number; quantities: number };
  /** the steps legible on the photo (full or partial) that were read with their number */
  steps: { legible: number; found: number; read: number };
  /** photos of the cooking (steps, results and other dishes) */
  photos: number;
  correct: number;
  results: { expected: number; correct: number };
  others: { expected: number; offList: number };
  /** step photos whose step was read, matched with it */
  readable: { expected: number; correct: number };
  sureWrong: number;
  /** kinds of the photos: the recipe must be a source and no step photo a source */
  classification: { recipeSource: boolean; stepsAsSource: number; subjects: number; subjectPhotos: number };
  /** visits the photos were grouped into, and whether the recipe joined the visit of the first step */
  visits: { count: number; recipeJoined: boolean };
  place?: string;
  lines: string[];
  used: string[];
  missing: string[];
};

/** the recipe page as `CollectionService.getSourceReading` reads it */
export const readRecipePage = (photo: Photo) => {
  const aspectRatio = photo.width! / photo.height!;
  const detailed = mergeOcrPasses(photo.width!, photo.height!, photo.passes ?? []);
  const ocr = chooseSourceOcr(photo.ocr, detailed);
  const boxes = ocr === 'tiles' ? detailed : photo.ocr;
  return { ocr, boxes, aspectRatio };
};

const kindName = (kind: CollectionKind) => kind;

const runSession = (
  session: Session,
  texts: Map<string, Float32Array>,
  options: Partial<MatchOptions> = {},
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

  const recipePhoto = session.photos.find((photo) => photo.kind === 'recipe')!;
  const { ocr, boxes, aspectRatio } = readRecipePage(recipePhoto);
  const page: RecipePage = readRecipes(boxes, { aspectRatio });
  const parsed: ParsedSource = cookbookPack.source.parse(boxes, { aspectRatio });

  // the subjects: every photo of the cooking, as the assistant passes them
  const subjects = session.photos.flatMap((photo, index) =>
    photo.kind === 'recipe'
      ? []
      : [{ index, photo, id: String(index), time: photo.time, embedding: decode(photo.embedding) }],
  );

  // the recipe of the page whose title fits the photos best
  const fit = (title: string) => {
    const text = embed(getTitlePrompt(title));
    const values = subjects.map(({ embedding }) => dot(embedding, text)).toSorted((a, b) => b - a);
    const best = values.slice(0, Math.max(1, Math.ceil(values.length / 3)));
    return best.reduce((sum, value) => sum + value, 0) / best.length;
  };
  const chosen = chooseReading(parsed, fit);
  const fits = [parsed, ...(parsed.alternatives ?? [])].map(
    ({ title }) => `${title}=${title ? fit(title).toFixed(3) : ''}`,
  );
  const recipe = page.recipes.find((item) => item.title === chosen.title) ?? page.recipes[0];
  const merged = mergeSourceEntries([{ ...chosen, assetId: 'recipe' }]);
  const entries = merged.map(({ item }) => item);

  const candidates = merged.map(({ item, course }) => ({ embedding: embed(cookbookPack.source.prompt(item)), course }));
  const baselines = cookbookPack.match.offListPrompts.map((text) => embed(text));
  const { matches } = matchSubjects(subjects, candidates, { ...cookbookPack.match.options, baselines, ...options });
  const byPhoto = new Map<string, SubjectMatch>();
  for (const match of matches) {
    for (const id of match.ids) {
      byPhoto.set(id, match);
    }
  }

  const main = session.steps[0]?.section ?? '';
  const legible = session.steps.filter((step) => step.visible === 'full' || step.visible === 'partial');
  const readSteps = (recipe?.steps ?? []).filter((step) => step.text);
  const stepFound = legible.filter((expected) =>
    readSteps.some(
      (step) =>
        step.n === expected.n &&
        isSameSection(expected.section, main, step.section) &&
        (!expected.words || similarity(expected.words, step.text!.slice(0, expected.words.length + 12)) >= 0.35),
    ),
  ).length;

  const ingredients = recipe?.ingredients ?? [];
  const pairs = session.ingredients.map((expected) => {
    const name = expected.replace(/^[^:]+:\s*/, '');
    const best = ingredients
      .map((item) => ({ item, score: similarity(name, item.text) }))
      .toSorted((a, b) => b.score - a.score)[0];
    return { expected: name, read: best && best.score >= 0.6 ? best.item.text : undefined };
  });

  // classification, visits and the place
  const prompts = getPromptList(cookbookPack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  const classifications = session.photos.map((photo) => {
    const embedding = decode(photo.embedding);
    return classifyPhoto(cookbookPack.classify, prompts, {
      similarities: promptEmbeddings.map((text) => dot(embedding, text)),
      ocr: photo.ocr.length > 0 ? summarizeText(photo.ocr, { parse: cookbookPack.source.parse }) : undefined,
    });
  });
  const kinds = classifications.map(({ kind }) => kind);
  const found = session.photos.flatMap((photo, index) =>
    kinds[index] === 'other'
      ? []
      : [{ id: String(index), time: photo.time, kind: kinds[index] as Exclude<CollectionKind, 'other'> }],
  );
  const visits = groupVisits(found, cookbookPack.visits.options);
  const recipeIndex = String(session.photos.indexOf(recipePhoto));
  const firstStep = String(session.photos.findIndex((photo) => photo.kind === 'step'));
  const recipeVisit = visits.find((visit) => visit.some(({ id }) => id === recipeIndex));
  const [place] = findPlaceNames([{ assetId: 'recipe', kind: 'source', ocr: recipePhoto.ocr }], cookbookPack.place);

  const result: SessionResult = {
    key: session.key,
    ocr,
    title: page.recipes[0]?.title,
    titleOk: !!chosen.title && similarity(chosen.title, session.title) >= 0.8,
    alternatives: (chosen.alternatives ?? []).flatMap(({ title }) => (title ? [title] : [])),
    chosen: chosen.title,
    ingredients: {
      expected: session.ingredients.length,
      read: ingredients.length,
      found: pairs.filter(({ read }) => read).length,
      quantities: pairs.filter(({ expected, read }) => read && quantityOf(expected) === quantityOf(read)).length,
    },
    steps: { legible: legible.length, found: stepFound, read: readSteps.length },
    photos: subjects.length,
    correct: 0,
    results: { expected: 0, correct: 0 },
    others: { expected: 0, offList: 0 },
    readable: { expected: 0, correct: 0 },
    sureWrong: 0,
    classification: {
      recipeSource: kinds[Number(recipeIndex)] === 'source',
      stepsAsSource: session.photos.filter((photo, index) => photo.kind !== 'recipe' && kinds[index] === 'source')
        .length,
      subjects: session.photos.filter(
        (photo, index) => (photo.kind === 'step' || photo.kind === 'result') && kinds[index] === 'subject',
      ).length,
      subjectPhotos: session.photos.filter((photo) => photo.kind === 'step' || photo.kind === 'result').length,
    },
    visits: { count: visits.length, recipeJoined: !!recipeVisit?.some(({ id }) => id === firstStep) },
    ...(place && { place: place.name }),
    lines: [`fit of the titles: ${fits.join(', ')}`],
    used,
    missing,
  };

  for (const { id, photo } of subjects) {
    const match = byPhoto.get(id)!;
    const entry = match.item === undefined ? undefined : entries[match.item];
    let good: boolean;
    if (photo.kind === 'result') {
      result.results.expected++;
      good = entry?.name === RESULT_ENTRY;
      result.results.correct += Number(good);
    } else if (photo.kind === 'other') {
      result.others.expected++;
      good = entry === undefined;
      result.others.offList += Number(good);
    } else {
      const expected = photo.step!;
      const step = recipe?.steps.find(
        (item) => item.n === expected.n && isSameSection(expected.section, main, item.section),
      );
      // "Step 2: Whisk the eggs" for a step of the main recipe, "Frosting step 1: ..." for a sub-recipe
      const name = entry?.name ?? '';
      good =
        !!entry &&
        new RegExp(String.raw`(?:^|\s)step ${expected.n}(?::|$)`, 'i').test(name) &&
        (expected.section === main ? name.startsWith('Step ') : normalize(name).includes(normalize(expected.section)));
      if (step?.text) {
        result.readable.expected++;
        result.readable.correct += Number(good);
      }
    }
    result.correct += Number(good);
    if (!good && !match.unsure) {
      result.sureWrong++;
    }
    const expectedLabel =
      photo.kind === 'step' ? `${photo.step!.section} ${photo.step!.n}` : photo.kind === 'result' ? 'Result' : 'other';
    const scores = classifications[Number(id)].scores;
    result.lines.push(
      `${good ? 'OK ' : 'BAD'} #${id.padStart(2)} ${kindName(kinds[Number(id)]).padEnd(7)} (subject ${scores.subject.toFixed(2)} source ${scores.source.toFixed(2)} other ${scores.other.toFixed(2)}) group=${match.ids.join(',').padEnd(6)} expected=${expectedLabel.padEnd(14)} got=${String(entry?.name).slice(0, 44).padEnd(44)} score=${match.score.toFixed(2)} off=${match.offList?.toFixed(2)} ${match.unsure ? 'unsure' : 'sure'}`,
    );
  }
  return result;
};

export const runBenchmark = (fixture: Fixture, options: Partial<MatchOptions> = {}) => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.sessions.map((session) => runSession(session, texts, options));
};

export const formatReport = (results: SessionResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    const { ingredients, steps, classification, visits } = result;
    lines.push(
      `${result.key}: title "${result.title}" (${result.titleOk ? 'ok' : 'wrong'}, chosen "${result.chosen}", other recipes: ${result.alternatives.join(', ') || 'none'}; ${result.ocr} OCR), ` +
        `ingredients ${ingredients.found}/${ingredients.expected} (${ingredients.quantities} with the quantity, ${ingredients.read} read), ` +
        `legible steps ${steps.found}/${steps.legible} (${steps.read} read), ` +
        `photos ${result.correct}/${result.photos} (results ${result.results.correct}/${result.results.expected}, other dishes off-list ${result.others.offList}/${result.others.expected}, steps whose text was read ${result.readable.correct}/${result.readable.expected}), sure but wrong ${result.sureWrong}; ` +
        `recipe ${classification.recipeSource ? 'is' : 'is NOT'} a source, ${classification.stepsAsSource} photos wrongly sources, ${classification.subjects}/${classification.subjectPhotos} cooking photos found; ` +
        `${visits.count} visits (recipe ${visits.recipeJoined ? 'with' : 'apart from'} the cooking); place "${result.place}"`,
    );
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`));
    }
  }
  const correct = results.reduce((sum, result) => sum + result.correct, 0);
  const photos = results.reduce((sum, result) => sum + result.photos, 0);
  lines.push(`total: ${correct}/${photos}`);
  return lines.join('\n');
};

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DishMatch, OFF_MENU_PROMPTS, itemPrompt, matchDishes } from 'src/utils/food/match.js';
import { MenuItem, chooseMenuOcr, mergeMenuItems, parseMenu } from 'src/utils/food/menu.js';
import { OcrBoxInput } from 'src/utils/food/ocr.js';
import { RestaurantPhoto, findRestaurantNames } from 'src/utils/food/restaurant.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/food/tiles.js';

/**
 * A benchmark of the food utilities on real meals (CC BY photos of three restaurant visits): the stored and the tiled
 * full-resolution OCR of their menus, the CLIP embeddings of their dish photos and the CLIP text embeddings of the menu
 * items, captured by `test/fixtures/food/capture-benchmark.mjs`. The menus are read, the dishes matched as
 * `FoodService.matchMeal` does, and the result is scored against what each photo shows.
 *
 * The text embeddings are cached by prompt; when the menu reading changes, run the spec once with
 * FOOD_BENCHMARK_ML=http://<machine learning server> to add the new ones to the fixture. FOOD_BENCHMARK_VERBOSE=1
 * prints every match.
 */

const FIXTURE = new URL('../../../test/fixtures/food/benchmark.json.gz', import.meta.url);

type Photo = {
  kind: 'dish' | 'menu' | 'sign';
  time: number;
  /** the menu item a dish photo shows, null when it is not on the menu */
  expected?: string | null;
  embedding?: string;
  ocr?: OcrBoxInput[];
  width?: number;
  height?: number;
  passes?: OcrPass[];
};

type Visit = { key: string; restaurant: string; photos: Photo[] };

type Fixture = { clipModel: string; ocrModel: string; visits: Visit[]; texts: Record<string, string> };

const load = (): Fixture => JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());

const decode = (base64: string) => {
  const buffer = Buffer.from(base64, 'base64');
  const values = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  const vector = Float32Array.from(values, (value) => value / 32_767);
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
};

const encode = (values: number[]) =>
  Buffer.from(Int16Array.from(values, (value) => Math.round(value * 32_767)).buffer).toString('base64');

/** adds the missing text embeddings to the fixture, from the machine learning server */
const addTexts = async (fixture: Fixture, texts: string[], url: string) => {
  for (const text of texts) {
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

/** whether a menu item read from the photo is the expected one, give or take OCR noise and a description */
export const isSameItem = (expected: string, read: string) => {
  const a = normalize(expected);
  const b = normalize(read);
  if (a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)))) {
    return true;
  }
  const x = bigrams(a);
  const y = bigrams(b);
  const pool = [...y];
  let shared = 0;
  for (const gram of x) {
    const index = pool.indexOf(gram);
    if (index >= 0) {
      shared++;
      pool.splice(index, 1);
    }
  }
  return (2 * shared) / (x.length + y.length) >= 0.6;
};

type VisitResult = {
  key: string;
  items: MenuItem[];
  recovered: number;
  expectedItems: number;
  dishes: number;
  correct: number;
  offMenu: { expected: number; correct: number; wronglyOff: number };
  /** matches marked sure that are wrong */
  sureWrong: number;
  /** correct matches marked unsure */
  unsureRight: number;
  restaurant?: { name: string; confidence: number };
  lines: string[];
  missing: string[];
};

const runVisit = (visit: Visit, texts: Map<string, Float32Array>): VisitResult => {
  const menus = visit.photos.filter((photo) => photo.kind === 'menu');
  const readings = menus.map((photo, index) => {
    const aspectRatio = photo.width! / photo.height!;
    const detailed = mergeOcrPasses(photo.width!, photo.height!, photo.passes ?? []);
    const boxes = chooseMenuOcr(photo.ocr ?? [], detailed, { aspectRatio }) === 'tiles' ? detailed : photo.ocr!;
    return { ...parseMenu(boxes, { aspectRatio }), assetId: `menu-${index}` };
  });
  const items = mergeMenuItems(readings).map(({ item }) => item);

  const missing: string[] = [];
  const embed = (text: string) => {
    const embedding = texts.get(text);
    if (!embedding) {
      missing.push(text);
    }
    return embedding ?? new Float32Array(512);
  };
  const candidates = items.map((item) => ({ embedding: embed(itemPrompt(item)) }));
  const baselines = OFF_MENU_PROMPTS.map((text) => embed(text));

  const dishes = visit.photos.flatMap((photo, index) =>
    photo.kind === 'dish'
      ? [{ index, photo, id: String(index), time: photo.time, embedding: decode(photo.embedding!) }]
      : [],
  );
  const matches = matchDishes(dishes, candidates, { baselines });
  const byPhoto = new Map<string, DishMatch>();
  for (const match of matches) {
    for (const id of match.ids) {
      byPhoto.set(id, match);
    }
  }

  const expectedItems = [...new Set(dishes.flatMap(({ photo }) => (photo.expected ? [photo.expected] : [])))];
  const recovered = expectedItems.filter((expected) => items.some((item) => isSameItem(expected, item.name))).length;

  const result: VisitResult = {
    key: visit.key,
    items,
    recovered,
    expectedItems: expectedItems.length,
    dishes: dishes.length,
    correct: 0,
    offMenu: { expected: 0, correct: 0, wronglyOff: 0 },
    sureWrong: 0,
    unsureRight: 0,
    lines: [],
    missing,
  };
  for (const { id, photo } of dishes) {
    const match = byPhoto.get(id)!;
    const name = match.item === undefined ? undefined : items[match.item].name;
    const expected = photo.expected ?? null;
    const good = expected === null ? name === undefined : name !== undefined && isSameItem(expected, name);
    result.correct += Number(good);
    if (expected === null) {
      result.offMenu.expected++;
      result.offMenu.correct += Number(name === undefined);
    } else if (name === undefined) {
      result.offMenu.wronglyOff++;
    }
    if (!good && !match.unsure) {
      result.sureWrong++;
    }
    if (good && match.unsure) {
      result.unsureRight++;
    }
    result.lines.push(
      `${good ? 'OK ' : 'BAD'} #${id.padStart(2)} group=${match.ids.join(',').padEnd(8)} expected=${String(expected).slice(0, 38).padEnd(38)} got=${String(name).slice(0, 38).padEnd(38)} score=${match.score.toFixed(2)} off=${match.offMenu?.toFixed(2)} ${match.unsure ? 'unsure' : 'sure'}`,
    );
  }

  const restaurantPhotos: RestaurantPhoto[] = visit.photos.flatMap((photo, index) =>
    photo.kind === 'dish' ? [] : [{ assetId: String(index), kind: photo.kind, ocr: photo.ocr ?? [] }],
  );
  const [restaurant] = findRestaurantNames(restaurantPhotos);
  if (restaurant) {
    result.restaurant = { name: restaurant.name, confidence: restaurant.confidence };
  }
  return result;
};

const fixture = load();

const run = () => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.visits.map((visit) => runVisit(visit, texts));
};

const report = (results: VisitResult[]) => {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.key}: ${result.correct}/${result.dishes} dishes, ${result.recovered}/${result.expectedItems} items read (${result.items.length} in all), off menu ${result.offMenu.correct}/${result.offMenu.expected} (${result.offMenu.wronglyOff} wrongly off), sure but wrong ${result.sureWrong}, right but unsure ${result.unsureRight}, restaurant ${result.restaurant ? `"${result.restaurant.name}" ${result.restaurant.confidence}` : 'none'}`,
    );
    if (process.env.FOOD_BENCHMARK_VERBOSE) {
      lines.push(
        `  items: ${result.items.map((item) => item.name).join(' | ')}`,
        ...result.lines.map((line) => `  ${line}`),
      );
    }
  }
  const correct = results.reduce((sum, result) => sum + result.correct, 0);
  const dishes = results.reduce((sum, result) => sum + result.dishes, 0);
  lines.push(`total: ${correct}/${dishes}`);
  process.stdout.write(`${lines.join('\n')}\n`);
};

describe('food benchmark', () => {
  it('should have the text embeddings of the menu items', async () => {
    const missing = [...new Set(run().flatMap((result) => result.missing))];
    if (missing.length > 0 && process.env.FOOD_BENCHMARK_ML) {
      await addTexts(fixture, missing, process.env.FOOD_BENCHMARK_ML);
      return;
    }
    expect(missing, 'run the spec with FOOD_BENCHMARK_ML set to add them').toEqual([]);
  });

  it('should match the dishes of real meals', () => {
    const results = run();
    report(results);
  });
});

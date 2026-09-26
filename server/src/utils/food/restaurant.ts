import { hasRestaurantWord } from 'src/utils/food/classify.js';
import { cleanItemText, isPageFurniture, isSectionHeading, parseMenu, splitPrice } from 'src/utils/food/menu.js';
import { OcrBoxInput, groupLines, toTextBoxes } from 'src/utils/food/ocr.js';

export type RestaurantSource = 'sign' | 'menu' | 'receipt';

export type RestaurantPhoto = {
  assetId: string;
  kind: RestaurantSource;
  ocr: OcrBoxInput[];
};

export type RestaurantCandidate = {
  name: string;
  /** 0..1 */
  confidence: number;
  source: RestaurantSource;
  /** the photos the name was read on */
  assetIds: string[];
};

/** a candidate needs at least this score to be the name of the restaurant */
export const MIN_RESTAURANT_SCORE = 0.55;

const LEGAL_SUFFIX =
  /[\s,.-]+(?:s\.?\s?r\.?\s?l\.?s?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?p\.?\s?a\.?|s\.?\s?l\.?|s\.?\s?a\.?|sarl|sas|gmbh|ltd\.?|llc|inc\.?|& c\.?)\s*$/i;

const SMALL_WORDS = new Set([
  'da',
  'di',
  'del',
  'della',
  'dei',
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'el',
  'los',
  'las',
  'lo',
  'il',
  'al',
  'alla',
  'the',
  'of',
  'and',
  'e',
  'y',
  'et',
  'on',
  'at',
  'in',
]);

/** "TRATTORIA DA NINO" → "Trattoria da Nino"; text with lowercase letters is kept as printed */
export const toTitleCase = (text: string) => {
  if (text !== text.toUpperCase()) {
    return text;
  }
  return (
    text
      .toLowerCase()
      .split(' ')
      .map((word, index) =>
        index > 0 && SMALL_WORDS.has(word) ? word : word.replace(/^(\p{L})/u, (letter) => letter.toUpperCase()),
      )
      .join(' ')
      // L'Osteria, D'Amico, but Katz's
      .replaceAll(
        /(^|\s)(\p{L}['’])(\p{L})/gu,
        (_, space: string, elision: string, letter: string) => `${space}${elision}${letter.toUpperCase()}`,
      )
  );
};

/** the name of a place as printed on a line, without legal suffixes and prices; undefined when it can't be a name */
export const cleanRestaurantName = (text: string) => {
  const cleaned = cleanItemText(splitPrice(text).text)
    .replace(LEGAL_SUFFIX, '')
    .replace(/^(?:benvenuti|welcome|bienvenue|bienvenidos)\s+(?:alla|al|da|to|at|au|a la|en)?\s*/i, '')
    .replaceAll(/["“”«»]/g, '')
    .trim();
  const letters = cleaned.replaceAll(/[^\p{L}]/gu, '').length;
  const words = cleaned.split(/\s+/).length;
  if (letters < 3 || words > 6 || cleaned.length > 40 || letters < 0.6 * cleaned.replaceAll(/\s/g, '').length) {
    return;
  }
  if (isSectionHeading(cleaned) || isPageFurniture(cleaned) || NOT_A_NAME.test(cleaned)) {
    return;
  }
  return toTitleCase(cleaned);
};

/** labels, associations and slogans that are printed on signs and menus but don't name the place */
const NOT_A_NAME =
  /relais\s*&?\s*ch[aâ]teaux|grandes tables|michelin|tripadvisor|zagat|gault\s*&?\s*millau|certificate of excellence|travell?ers'? choice|slow food|^(?:open|opened|welcome|entrance|entrata|ingresso|exit|uscita|push|pull|spingere|tirare|visa|mastercard|american express|no smoking|vietato fumare|since \d{4}|dal \d{4}|est\.? \d{4}|thank you|grazie|merci|gracias)$/i;

/** edit distance of two strings, for names that OCR read with a letter or two missing */
export const editDistance = (a: string, b: string) => {
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

/** "therenchaundry" is "thefrenchlaundry" with two letters dropped */
const isSimilarName = (a: string, b: string) =>
  a === b ||
  (Math.min(a.length, b.length) >= 5 &&
    editDistance(a, b) <= Math.max(1, Math.floor(0.2 * Math.max(a.length, b.length))));

const KIND_WEIGHT: Record<RestaurantSource, number> = { sign: 1, menu: 0.85, receipt: 0.9 };
const SOURCE_ORDER: RestaurantSource[] = ['sign', 'menu', 'receipt'];

const normalize = (name: string) =>
  name
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]/gu, '');

/** "Pizzeria" alone names a kind of place, not a place */
const isRestaurantWordOnly = (name: string) => !name.includes(' ') && hasRestaurantWord(name);

type Scored = { name: string; score: number; source: RestaurantSource; assetId: string };

const scorePhoto = (photo: RestaurantPhoto): Scored[] => {
  const lines = groupLines(toTextBoxes(photo.ocr));
  if (lines.length === 0) {
    return [];
  }
  const names = lines.map((line) => cleanRestaurantName(line.text));
  // the largest text that can be a name: labels such as "Relais & Châteaux" don't count
  const largest = Math.max(0, ...lines.filter((_, index) => names[index]).map((line) => line.height));
  const title = photo.kind === 'menu' ? parseMenu(photo.ocr).title : undefined;

  const results: Scored[] = [];
  for (const [index, line] of lines.entries()) {
    let name = names[index];
    if (!name) {
      continue;
    }
    // "OSTERIA" over "da Carlo", or "KATZ'S" over "DELICATESSEN" on a sign
    const next = lines[index + 1];
    const previous = lines[index - 1];
    if (isRestaurantWordOnly(name)) {
      if (next && next.top - line.bottom < 1.5 * line.height) {
        name = cleanRestaurantName(`${toTitleCase(line.text)} ${toTitleCase(next.text)}`) ?? name;
      } else if (previous && line.top - previous.bottom < 1.5 * previous.height) {
        name = cleanRestaurantName(`${toTitleCase(previous.text)} ${toTitleCase(line.text)}`) ?? name;
      }
    }
    let score = 0.35 * (line.height / largest);
    if (hasRestaurantWord(name)) {
      score += isRestaurantWordOnly(name) ? 0.1 : 0.45;
    }
    if (line.height === largest) {
      score += 0.1;
      // a sign with a few words in large letters: the largest is the name ("noma")
      if (photo.kind === 'sign' && lines.length <= 4) {
        score += 0.15;
      }
    }
    if (photo.kind === 'receipt' && index === 0) {
      // the first line of a receipt is the business
      score += 0.25;
    } else if (photo.kind !== 'sign' && (line.top < 0.2 || index < 2)) {
      // the name heads a menu page
      score += 0.15;
    }
    if (title && normalize(title) === normalize(name)) {
      score += 0.15;
    }
    results.push({ name, score: score * KIND_WEIGHT[photo.kind], source: photo.kind, assetId: photo.assetId });
  }
  return results;
};

/**
 * Candidates for the name of a restaurant from the text on its signs, menus and receipts: large text, text at the top
 * of a menu or a receipt, words such as "Ristorante", "Trattoria" or "Café", and names read on more than one photo
 * score higher. Best first; only candidates with a score of at least `MIN_RESTAURANT_SCORE` are returned.
 */
export const findRestaurantNames = (photos: RestaurantPhoto[], limit = 3): RestaurantCandidate[] => {
  const byName = new Map<
    string,
    { names: Map<string, number>; best: Map<string, number>; sources: Set<RestaurantSource>; assetIds: Set<string> }
  >();
  for (const photo of photos) {
    // one score per name and photo: the best line
    const perPhoto = new Map<string, Scored>();
    for (const scored of scorePhoto(photo)) {
      const key = normalize(scored.name);
      if ((perPhoto.get(key)?.score ?? -1) < scored.score) {
        perPhoto.set(key, scored);
      }
    }
    for (const [key, scored] of perPhoto) {
      const entry = byName.get(key) ?? { names: new Map(), best: new Map(), sources: new Set(), assetIds: new Set() };
      entry.names.set(scored.name, (entry.names.get(scored.name) ?? 0) + 1);
      entry.best.set(photo.assetId, scored.score);
      entry.sources.add(scored.source);
      entry.assetIds.add(photo.assetId);
      byName.set(key, entry);
    }
  }

  // names OCR read with letters missing join the complete reading: the longest key wins
  const merged: Array<[string, NonNullable<ReturnType<typeof byName.get>>]> = [];
  for (const [key, entry] of [...byName].toSorted((a, b) => b[0].length - a[0].length)) {
    const target = merged.find(([other]) => isSimilarName(other, key))?.[1];
    if (!target) {
      merged.push([key, entry]);
      continue;
    }
    for (const [assetId, score] of entry.best) {
      target.best.set(assetId, Math.max(target.best.get(assetId) ?? 0, score));
    }
    for (const source of entry.sources) {
      target.sources.add(source);
    }
    for (const assetId of entry.assetIds) {
      target.assetIds.add(assetId);
    }
  }

  const candidates = merged
    .values()
    .map(([, entry]) => {
      const scores = entry.best
        .values()
        .toArray()
        .toSorted((a, b) => b - a);
      // repeated on other photos: a menu page header, the sign and the receipt agree
      const score = scores[0] + 0.2 * Math.min(2, scores.length - 1);
      const name = [...entry.names].toSorted((a, b) => b[1] - a[1] || (a[0] === a[0].toUpperCase() ? 1 : -1))[0][0];
      const source = SOURCE_ORDER.find((kind) => entry.sources.has(kind))!;
      return { name, score, source, assetIds: [...entry.assetIds] };
    })
    .toArray();

  return candidates
    .filter(({ score }) => score >= MIN_RESTAURANT_SCORE)
    .toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name, score, source, assetIds }) => ({
      name,
      confidence: Math.round(Math.min(1, score / 1.2) * 100) / 100,
      source,
      assetIds,
    }));
};

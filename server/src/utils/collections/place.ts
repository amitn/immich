import { OcrBoxInput, TextLine, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { editDistance } from 'src/utils/collections/text.js';

/** the photos a place name is read on: its signs, its sources (e.g. a menu) and its receipts (or tickets) */
export type PlaceSource = 'sign' | 'source' | 'receipt';

export type PlacePhoto = {
  assetId: string;
  kind: PlaceSource;
  ocr: OcrBoxInput[];
};

export type PlaceCandidate = {
  name: string;
  /** 0..1 */
  confidence: number;
  source: PlaceSource;
  /** the photos the name was read on */
  assetIds: string[];
};

/**
 * What a pack knows about the names of its places (restaurants, museums, wineries...): the words that name a kind of
 * place, the text printed on signs and sources that never names one, and how to read a line of its sources.
 */
export type PlaceNameRules = {
  /** words that name a kind of place ("Trattoria", "Museum"), without the global flag */
  words: RegExp;
  /** labels, associations and slogans printed on signs and sources that don't name the place */
  blocked: RegExp;
  /** the text of a line without what the pack's sources print around names, e.g. prices and allergen codes */
  cleanLine?: (text: string) => string;
  /** text that can't be a name, e.g. a section heading or an address */
  isNotName?: (text: string) => boolean;
  /** the title of a source photo, which is often the name of the place */
  title?: (ocr: OcrBoxInput[]) => string | undefined;
};

/** a candidate needs at least this score to be the name of the place */
export const MIN_PLACE_SCORE = 0.55;

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

/** the name of a place as printed on a line, without legal suffixes; undefined when it can't be a name */
export const cleanPlaceName = (text: string, rules: PlaceNameRules) => {
  const cleaned = (rules.cleanLine ? rules.cleanLine(text) : text.trim())
    .replace(LEGAL_SUFFIX, '')
    .replace(/^(?:benvenuti|welcome|bienvenue|bienvenidos)\s+(?:alla|al|da|to|at|au|a la|en)?\s*/i, '')
    .replaceAll(/["“”«»]/g, '')
    .trim();
  const letters = cleaned.replaceAll(/[^\p{L}]/gu, '').length;
  const words = cleaned.split(/\s+/).length;
  if (letters < 3 || words > 6 || cleaned.length > 40 || letters < 0.6 * cleaned.replaceAll(/\s/g, '').length) {
    return;
  }
  if (rules.isNotName?.(cleaned) || rules.blocked.test(cleaned)) {
    return;
  }
  return toTitleCase(cleaned);
};

/** "therenchaundry" is "thefrenchlaundry" with two letters dropped */
const isSimilarName = (a: string, b: string) =>
  a === b ||
  (Math.min(a.length, b.length) >= 5 &&
    editDistance(a, b) <= Math.max(1, Math.floor(0.2 * Math.max(a.length, b.length))));

const KIND_WEIGHT: Record<PlaceSource, number> = { sign: 1, source: 0.85, receipt: 0.9 };
const SOURCE_ORDER: PlaceSource[] = ['sign', 'source', 'receipt'];

const normalize = (name: string, keepSpaces = false) =>
  name
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(keepSpaces ? /[^\p{L}\d\s]/gu : /[^\p{L}\d]/gu, '');

/** "Pizzeria" alone names a kind of place, not a place */
const isPlaceWordOnly = (name: string, rules: PlaceNameRules) => !name.includes(' ') && rules.words.test(name);

type Scored = { name: string; score: number; source: PlaceSource; assetId: string };

/**
 * Whether a name reads like letters OCR made up: a run of five consonants ("MZSDGUICAT", from a sign seen at an
 * angle), or a long word without a vowel.
 */
export const isGarbled = (name: string) =>
  normalize(name, true)
    .split(/\s+/)
    .some((word) => /[^aeiouy\d\s]{5}/.test(word) || (word.length >= 4 && !/[aeiouy]/.test(word)));

/** a name read on a single photo, none of whose words is on the other photos of the visit, counts this much */
const UNSUPPORTED = 0.85;

/** the words of a text that can tell a name apart: "Katz's Delicatessen" → katzs */
const distinctWords = (text: string, rules: PlaceNameRules) =>
  normalize(text.replaceAll(/[^\p{L}\d]+/gu, ' ').replaceAll(/\s+/g, ' '), true)
    .split(' ')
    .filter((word) => word.length >= 4 && !rules.words.test(word));

/** OCR is less sure of made-up readings: a line read with less confidence than this counts for less */
const SURE_TEXT = 0.9;

const textConfidence = (line: TextLine) => {
  const score = Math.min(...line.boxes.map((box) => box.score));
  return score >= SURE_TEXT ? 1 : 0.6 + 0.4 * Math.max(0, (score - 0.8) / (SURE_TEXT - 0.8));
};

const scorePhoto = (photo: PlacePhoto, rules: PlaceNameRules): Scored[] => {
  const lines = groupLines(toTextBoxes(photo.ocr));
  if (lines.length === 0) {
    return [];
  }
  const clean = (text: string) => cleanPlaceName(text, rules);
  const names = lines.map((line) => clean(line.text));
  // the largest text that can be a name: labels such as "Relais & Châteaux" don't count
  const largest = Math.max(0, ...lines.filter((_, index) => names[index]).map((line) => line.height));
  const title = photo.kind === 'source' ? rules.title?.(photo.ocr) : undefined;

  const results: Scored[] = [];
  for (const [index, line] of lines.entries()) {
    let name = names[index];
    if (!name) {
      continue;
    }
    // "OSTERIA" over "da Carlo", or "KATZ'S" over "DELICATESSEN" on a sign
    const next = lines[index + 1];
    const previous = lines[index - 1];
    if (isPlaceWordOnly(name, rules)) {
      if (next && next.top - line.bottom < 1.5 * line.height) {
        name = clean(`${toTitleCase(line.text)} ${toTitleCase(next.text)}`) ?? name;
      } else if (previous && line.top - previous.bottom < 1.5 * previous.height) {
        name = clean(`${toTitleCase(previous.text)} ${toTitleCase(line.text)}`) ?? name;
      }
    }
    let score = 0.35 * (line.height / largest);
    if (rules.words.test(name)) {
      score += isPlaceWordOnly(name, rules) ? 0.1 : 0.45;
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
      // the name heads a source page
      score += 0.15;
    }
    if (title && normalize(title) === normalize(name)) {
      score += 0.15;
    }
    score *= textConfidence(line) * (isGarbled(name) ? 0.5 : 1);
    results.push({ name, score: score * KIND_WEIGHT[photo.kind], source: photo.kind, assetId: photo.assetId });
  }
  // the title of a source read on a row with the text beside it (two titles of a page, side by side): the title the
  // pack's parser read on its own scores as the row, and its bonus
  const titleName = title ? cleanPlaceName(title, rules) : undefined;
  if (titleName && results.every((result) => normalize(result.name) !== normalize(titleName))) {
    const row = results
      .filter((result) => normalize(result.name).includes(normalize(titleName)))
      .toSorted((a, b) => b.score - a.score)[0];
    if (row) {
      results.push({ ...row, name: titleName, score: row.score + 0.15 * KIND_WEIGHT[photo.kind] });
    }
  }
  return results;
};

/**
 * Candidates for the name of a place from the text on its signs, sources and receipts: large text, text at the top
 * of a source or a receipt, words that name a kind of place ("Ristorante", "Museum"), and names read on more than
 * one photo score higher. Best first; only candidates with a score of at least `MIN_PLACE_SCORE` are returned.
 */
export const findPlaceNames = (photos: PlacePhoto[], rules: PlaceNameRules, limit = 3): PlaceCandidate[] => {
  const byName = new Map<
    string,
    { names: Map<string, number>; best: Map<string, number>; sources: Set<PlaceSource>; assetIds: Set<string> }
  >();
  for (const photo of photos) {
    // one score per name and photo: the best line
    const perPhoto = new Map<string, Scored>();
    for (const scored of scorePhoto(photo, rules)) {
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

  // the words on each photo: a name read once, whose words no other photo of the visit has, may be made up
  const photoWords = photos.map(({ assetId, ocr }) => ({
    assetId,
    words: new Set(ocr.flatMap(({ text }) => distinctWords(text, rules))),
  }));
  const isSupported = (name: string, assetIds: Set<string>) => {
    const others = photoWords.filter(({ assetId, words }) => !assetIds.has(assetId) && words.size > 0);
    return (
      assetIds.size > 1 ||
      others.length === 0 ||
      distinctWords(name, rules).some((word) => others.some(({ words }) => words.has(word)))
    );
  };

  const candidates = merged
    .values()
    .map(([, entry]) => {
      const scores = entry.best
        .values()
        .toArray()
        .toSorted((a, b) => b - a);
      const name = [...entry.names].toSorted((a, b) => b[1] - a[1] || (a[0] === a[0].toUpperCase() ? 1 : -1))[0][0];
      // repeated on other photos: a source page header, the sign and the receipt agree
      const score =
        (scores[0] + 0.2 * Math.min(2, scores.length - 1)) * (isSupported(name, entry.assetIds) ? 1 : UNSUPPORTED);
      const source = SOURCE_ORDER.find((kind) => entry.sources.has(kind))!;
      return { name, score, source, assetIds: [...entry.assetIds] };
    })
    .toArray();

  return candidates
    .filter(({ score }) => score >= MIN_PLACE_SCORE)
    .toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name, score, source, assetIds }) => ({
      name,
      confidence: Math.round(Math.min(1, score / 1.2) * 100) / 100,
      source,
      assetIds,
    }));
};

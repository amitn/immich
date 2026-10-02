import { editDistance, stripAccents } from 'src/utils/collections/text.js';

/**
 * Fuzzy matching of what the user asks about ("noma", "the quiche", "desserts") with the names of the collections
 * ("Noma Australia", "Quiche Lorraine", "\"Assortment of Desserts\""): accents, case, punctuation and apostrophes are
 * ignored, plurals are folded ("desserts" ~ "Pre-Dessert", "fries" ~ "Steak Fries"), a word of four letters or more
 * matches the start of a word ("choc" ~ "Chocolate"), words of six letters or more allow a letter typed wrong (from eight letters one missing or added, two typos from nine), and small words like "the" or
 * "of" are ignored. Every word of the query has to match a word of the name; a query written as one word also matches
 * words written apart ("frenchlaundry").
 */

const LIGATURES: Record<string, string> = { æ: 'ae', œ: 'oe', ø: 'o', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th' };

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'da',
  'de',
  'del',
  'der',
  'des',
  'di',
  'du',
  'el',
  'il',
  'in',
  'la',
  'le',
  'les',
  'of',
  'on',
  'the',
  'with',
]);

/** lowercase words without accents, apostrophes or punctuation: "Katz's Pastrami" → "katzs pastrami" */
export const normalizeName = (text: string) =>
  stripAccents(text.toLowerCase())
    .replaceAll(/[æœøßłđðþ]/g, (letter) => LIGATURES[letter] ?? letter)
    .replaceAll(/['’‘`´ʼ]/g, '')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** folds English plurals: desserts → dessert, pastries → pastry, dishes → dish, katzs → katz */
export const stemWord = (word: string) => {
  if (word.length > 4 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !/\d/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
};

const matchWord = (query: string, word: string) => {
  if (word === query) {
    return true;
  }
  if (query.length >= 4 && word.startsWith(query)) {
    return true;
  }
  // a letter typed wrong, or from eight letters one missing or added ("desert" is not "dessert")
  if (query.length >= 6 && Math.abs(query.length - word.length) <= (query.length >= 8 ? 1 : 0)) {
    return editDistance(query, word) <= (query.length >= 9 ? 2 : 1);
  }
  return false;
};

type PreparedQuery = { words: string[]; compact: string };

const prepare = (query: string): PreparedQuery | undefined => {
  const normalized = normalizeName(query);
  if (!normalized) {
    return;
  }
  const all = normalized.split(' ');
  const meaningful = all.filter((word) => !STOP_WORDS.has(word));
  return {
    words: (meaningful.length > 0 ? meaningful : all).map((word) => stemWord(word)),
    compact: normalized.replaceAll(' ', ''),
  };
};

const matchPrepared = (query: PreparedQuery, text: string) => {
  const normalized = normalizeName(text);
  if (!normalized) {
    return false;
  }
  const words = normalized.split(' ').map((word) => stemWord(word));
  if (query.words.every((part) => words.some((word) => matchWord(part, word)))) {
    return true;
  }
  // a query written as one word, e.g. "frenchlaundry", from the start of a word of the name
  if (query.compact.length >= 5) {
    const compact = normalized.split(' ');
    for (let start = 0; start < compact.length; start++) {
      if (compact.slice(start).join('').startsWith(query.compact)) {
        return true;
      }
    }
  }
  return false;
};

/** whether `text` matches `query` (see above) */
export const fuzzyMatch = (query: string, text: string) => {
  const prepared = prepare(query);
  return prepared ? matchPrepared(prepared, text) : false;
};

/**
 * A test of names against several alternatives (e.g. ["dessert", "petits fours"]): true when any of them matches.
 * Without alternatives (or only blank ones), everything matches.
 */
export const createMatcher = (queries: string[] | undefined) => {
  const prepared = (queries ?? []).map((query) => prepare(query)).filter((query) => query !== undefined);
  if (prepared.length === 0) {
    return () => true;
  }
  return (text: string | null | undefined) => !!text && prepared.some((query) => matchPrepared(query, text));
};

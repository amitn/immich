import type { CollectionPack } from 'src/utils/collections/pack.js';

/**
 * The collection filters of a question typed in the search bar ("what did we eat at noma", "which museums did we visit
 * in 2025"), without AI: the pack its words point to (eat → food, museums → museum), the years it names, and the
 * remaining words as names to match loosely against the places and entries of the collections.
 */
export type CollectionSearchTerms = {
  pack?: string;
  text: string[];
  from?: string;
  to?: string;
};

/** words that point to a pack besides the pack's own names (see `CollectionPack.names`) */
const PACK_WORDS: Record<string, string[]> = {
  food: ['eat', 'ate', 'eaten', 'eating', 'food', 'restaurant', 'restaurants', 'dinner', 'dinners', 'lunch', 'lunches'],
  wine: ['wine', 'wines', 'drink', 'drank', 'drunk', 'drinks', 'bottle', 'bottles', 'tasting', 'tastings'],
  museum: [
    'museum',
    'museums',
    'gallery',
    'galleries',
    'artwork',
    'artworks',
    'exhibition',
    'exhibitions',
    'painting',
    'paintings',
  ],
  cookbook: ['cook', 'cooked', 'cooking', 'bake', 'baked', 'baking', 'recipe', 'recipes'],
  travel: ['trip', 'trips', 'flight', 'flights', 'flew', 'fly', 'train', 'trains', 'travel', 'traveled', 'travelled'],
  concerts: ['concert', 'concerts', 'festival', 'festivals', 'band', 'bands', 'lineup', 'performer', 'performers'],
  nature: ['plant', 'plants', 'tree', 'trees', 'flower', 'flowers', 'botanical', 'arboretum', 'zoo', 'zoos'],
  reading: ['book', 'books', 'read', 'reading', 'novel', 'novels', 'library', 'libraries', 'author', 'authors'],
  'kids-art': ['kids', 'kid', 'children', 'childrens', 'child', 'drawing', 'drawings', 'drew', 'crafts'],
  garden: [
    'garden',
    'gardens',
    'gardening',
    'seed',
    'seeds',
    'vegetable',
    'vegetables',
    'harvest',
    'harvested',
    'grew',
    'grow',
    'grown',
    'planted',
    'lettuce',
  ],
};

/**
 * the packs whose own words claim a word (see `PACK_WORDS`): only they count it, not the other packs whose names
 * hold it too, e.g. garden is the garden pack's, though the nature pack's place is a (botanical) garden
 */
const CLAIMED = Map.groupBy(
  Object.entries(PACK_WORDS).flatMap(([pack, words]) => words.map((word) => ({ pack, word }))),
  ({ word }) => word,
);

const STOPWORDS = new Set([
  // question words and auxiliaries
  'what',
  'whats',
  'which',
  'when',
  'where',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'did',
  'do',
  'does',
  'done',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'can',
  'could',
  'would',
  'should',
  'will',
  // people
  'we',
  'i',
  'us',
  'our',
  'ours',
  'my',
  'me',
  'you',
  'your',
  'they',
  'them',
  'their',
  'it',
  'its',
  // small words
  'the',
  'a',
  'an',
  'at',
  'in',
  'on',
  'of',
  'to',
  'for',
  'with',
  'and',
  'or',
  'from',
  'during',
  'between',
  'since',
  'before',
  'after',
  'until',
  'about',
  'there',
  'that',
  'this',
  'these',
  'those',
  'all',
  'any',
  'some',
  'many',
  'much',
  'often',
  'ever',
  'last',
  'first',
  'time',
  'times',
  'year',
  'years',
  'ago',
  'recently',
  'most',
  // asking for photos
  'show',
  'find',
  'list',
  'tell',
  'give',
  'photo',
  'photos',
  'picture',
  'pictures',
  // doing
  'see',
  'saw',
  'seen',
  'visit',
  'visited',
  'go',
  'went',
  'gone',
  'make',
  'made',
  'try',
  'tried',
  'order',
  'ordered',
  'get',
  'got',
  'take',
  'took',
  'like',
  'liked',
  'best',
  // months
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]);

/** the words of a text, lowercase, without accents or punctuation (apostrophes dropped: what's → whats) */
const getWords = (text: string) =>
  text
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * the words that point to a pack: its id, title and names, but not the small words of its names ("plant photos",
 * "years") nor a word another pack claims, and its own words
 */
const getPackWords = (pack: CollectionPack) =>
  new Set([
    ...[pack.id, pack.title.toLowerCase(), ...Object.values(pack.names).flatMap((name) => getWords(name))].filter(
      (word) =>
        !STOPWORDS.has(word) && (!CLAIMED.has(word) || CLAIMED.get(word)!.some((claim) => claim.pack === pack.id)),
    ),
    ...(PACK_WORDS[pack.id] ?? []),
  ]);

export const getCollectionSearchTerms = (question: string, packs: CollectionPack[]): CollectionSearchTerms => {
  const words = getWords(question);
  const packWords = packs.map((pack) => ({ id: pack.id, words: getPackWords(pack) }));

  const hits = packWords
    .map(({ id, words: own }) => ({ id, count: words.filter((word) => own.has(word)).length }))
    .filter(({ count }) => count > 0)
    .toSorted((a, b) => b.count - a.count);
  // a pack when the words point to one more than to any other
  const pack = hits.length > 0 && (hits.length === 1 || hits[0].count > hits[1].count) ? hits[0].id : undefined;

  const years = words.filter((word) => /^(19|20)\d{2}$/.test(word)).toSorted();
  const anyPackWord = new Set(packWords.flatMap(({ words: own }) => [...own]));
  const isName = (word: string) =>
    word.length >= 2 && !/^\d+$/.test(word) && !STOPWORDS.has(word) && !anyPackWord.has(word);
  // the names are the runs of words left, e.g. "the french laundry" → french laundry
  const runs: string[][] = [[]];
  for (const word of words) {
    if (isName(word)) {
      runs.at(-1)!.push(word);
    } else if (runs.at(-1)!.length > 0) {
      runs.push([]);
    }
  }
  const text = [...new Set(runs.map((run) => run.join(' ')).filter((name) => name.length >= 3))];

  return {
    ...(pack && { pack }),
    text,
    ...(years.length > 0 && { from: years[0], to: years.at(-1) }),
  };
};

/** whether the terms say anything to look for: a pack, names or a year */
export const hasSearchTerms = (terms: CollectionSearchTerms) => !!terms.pack || terms.text.length > 0 || !!terms.from;

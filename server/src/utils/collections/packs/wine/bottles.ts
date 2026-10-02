import { cosineDistance } from 'src/utils/agent/clustering.js';
import {
  AssignEntry,
  AssignOptions,
  AssignPhoto,
  AssignResult,
  MatchSuggestion,
  SubjectMatch,
  matchSubjects,
} from 'src/utils/collections/match.js';
import {
  WineLabel,
  findVintages,
  formatWineName,
  readWineLabel,
  toWineEntry,
} from 'src/utils/collections/packs/wine/label.js';
import { normalizeWords } from 'src/utils/collections/packs/wine/lexicon.js';
import { editDistance } from 'src/utils/collections/text.js';

/*
 * Naming the bottles of a tasting. Every bottle photo shows its own label, which is read (see `readWineLabel`); the
 * photos of one bottle (the label close-up, the glass beside it, the pour) are grouped; and each bottle is named after
 * its label, or after the line of the wine list (a tasting sheet, the pairing of a menu) its label matches when the
 * visit has one. Photos taken a few minutes apart are of one bottle when their labels agree (a word, a fragment),
 * or when they look alike and neither label says otherwise; a different vintage, or clear words the other label
 * does not have, are two bottles, however alike the photos look (bottles on the same table look very alike to CLIP).
 */

export type BottleOptions = {
  /** photos of one bottle are taken within this many minutes of each other */
  sameBottleMinutes: number;
  /** photos this alike (CLIP cosine distance) are of one bottle when their labels do not disagree */
  sameBottleDistance: number;
  /** a label matches a line of the wine list with at least this score, 0..1 */
  minListScore: number;
  /** ... and surely with at least this score (when the label was read surely too) */
  sureListScore: number;
};

/** calibrated on real tastings, see `benchmark.spec.ts` */
export const DEFAULT_BOTTLE_OPTIONS: BottleOptions = {
  sameBottleMinutes: 5,
  sameBottleDistance: 0.15,
  minListScore: 0.45,
  sureListScore: 0.75,
};

export type BottlePhoto = AssignPhoto & { label?: WineLabel };

const round = (value: number) => Math.round(value * 1000) / 1000;

const letterPairs = (text: string) =>
  Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2));

/** "snarebtee" and "snaubte": the letter pairs they share (Dice), 0..1 */
const pairSimilarity = (a: string, b: string) => {
  const pairs = letterPairs;
  const x = pairs(a);
  const pool = pairs(b);
  if (x.length === 0 || pool.length === 0) {
    return 0;
  }
  const total = x.length + pool.length;
  let shared = 0;
  for (const pair of x) {
    const index = pool.indexOf(pair);
    if (index === -1) {
      continue;
    }

    shared++;
    pool.splice(index, 1);
  }
  return (2 * shared) / total;
};

/** the same word, give or take a letter or two OCR read differently, or cut at the edge of the label */
export const isSameWord = (a: string, b: string) => {
  if (a === b) {
    return true;
  }
  const shorter = Math.min(a.length, b.length);
  if (shorter >= 5 && (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a))) {
    return true;
  }
  return shorter >= 4 && editDistance(a, b) <= (shorter >= 8 ? 2 : 1);
};

const sharesWord = (a: string[], b: string[]) => a.some((word) => b.some((other) => isSameWord(word, other)));

/** two labels that cannot be of one bottle: different vintages, or clear words that have nothing in common */
export const isOtherBottle = (a?: WineLabel, b?: WineLabel) =>
  !!a &&
  !!b &&
  ((!!a.vintage && !!b.vintage && a.vintage !== b.vintage) ||
    (a.words.length > 0 && b.words.length > 0 && !sharesWord(a.words, b.words)));

/** two labels that read alike: a clear word in common, or words that share most of their letters */
export const isSameLabel = (a?: WineLabel, b?: WineLabel) => {
  if (!a || !b) {
    return false;
  }
  if (sharesWord(a.words, b.words)) {
    return true;
  }
  const x = a.looseWords.join('');
  const y = b.looseWords.join('');
  return x.length >= 4 && y.length >= 4 && pairSimilarity(x, y) >= 0.5;
};

/**
 * The photos of each bottle, in time order: a photo joins the bottle of a photo taken at most `sameBottleMinutes`
 * before it whose label reads alike, or that looks alike (`sameBottleDistance`), unless a label of the bottle
 * disagrees with its own.
 */
export const groupBottles = (photos: BottlePhoto[], options: BottleOptions = DEFAULT_BOTTLE_OPTIONS) => {
  const ordered = photos.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const groups: BottlePhoto[][] = [];
  const alike = (a: BottlePhoto, b: BottlePhoto) =>
    a.embedding.length > 0 &&
    a.embedding.length === b.embedding.length &&
    cosineDistance(a.embedding, b.embedding) <= options.sameBottleDistance;
  for (const photo of ordered) {
    const group = groups
      .filter((members) => photo.time - members.at(-1)!.time <= options.sameBottleMinutes * 60_000)
      .filter((members) => members.every((member) => !isOtherBottle(member.label, photo.label)))
      .find((members) => members.some((member) => isSameLabel(member.label, photo.label) || alike(member, photo)));
    if (group) {
      group.push(photo);
    } else {
      groups.push([photo]);
    }
  }
  return groups;
};

/** the label of a bottle from the readings of its photos: each part from the reading that is surest of it */
export const mergeLabels = (labels: WineLabel[]): WineLabel | undefined => {
  if (labels.length <= 1) {
    return labels[0];
  }
  const ranked = labels.toSorted((a, b) => b.confidence - a.confidence);
  const pick = <K extends 'producer' | 'wine' | 'vintage' | 'region' | 'grape' | 'type'>(key: K) =>
    ranked.find((label) => label[key])?.[key];
  const producer = pick('producer');
  const wine = pick('wine');
  const vintage = pick('vintage');
  const region = pick('region');
  const grape = pick('grape');
  const type = pick('type');
  const parts = [producer, wine, vintage, region].filter(Boolean).length;
  return {
    ...(producer && { producer }),
    ...(wine && { wine }),
    ...(vintage && { vintage }),
    ...(region && { region }),
    ...(grape && { grape }),
    ...(type && { type }),
    // more of the label read on more photos, but never surer than its surest reading's parts
    confidence: Math.min(1, Math.max(...labels.map((label) => label.confidence)) + 0.05 * (parts - 1)),
    sure: labels.some((label) => label.sure),
    several: labels.some((label) => label.several),
    words: [...new Set(labels.flatMap((label) => label.words))],
    looseWords: [...new Set(labels.flatMap((label) => label.looseWords))],
    ...(ranked[0].box && { box: ranked[0].box }),
  };
};

const TOKEN_MIN = 3;

const tokensOf = (text: string) =>
  normalizeWords(text)
    .split(' ')
    .filter((word) => word.length >= TOKEN_MIN || /^\d{4}$/.test(word));

/**
 * How well a label matches a line of a wine list, 0..1: the share of the line's words (its producer, site, grape,
 * vintage) read on the label, give or take a letter; a different vintage is another wine
 */
export const scoreListEntry = (label: WineLabel, entry: Pick<AssignEntry, 'name' | 'description'>) => {
  const wanted = [...new Set(tokensOf(`${entry.name} ${entry.description ?? ''}`))];
  if (wanted.length === 0) {
    return 0;
  }
  const read = [
    ...new Set([
      ...label.looseWords,
      ...tokensOf([label.producer, label.wine, label.region, label.grape, label.vintage].filter(Boolean).join(' ')),
    ]),
  ];
  const found = wanted.filter((word) => read.some((other) => isSameWord(word, other))).length;
  const years = findVintages(`${entry.name} ${entry.description ?? ''}`);
  const vintageOff = !!label.vintage && years.length > 0 && !years.includes(label.vintage);
  return round((found / Math.min(wanted.length, 5)) * (vintageOff ? 0.3 : 1));
};

type Bottle = { photos: BottlePhoto[]; label?: WineLabel };

/**
 * Names the bottles of a tasting (`match.assign` of the wine pack): the photos are grouped by bottle, and each bottle
 * gets the line of the wine list its label matches (`entries`, read on the list photos), or an entry of its own
 * made from its label, added after them. A bottle whose label could not be read gets the line CLIP finds most like
 * it, unsure, or none: the assistant reads it. A match is sure only when the label was read clearly (its producer
 * and its wine or vintage) on one bottle, and matches the list clearly when there is one.
 */
export const assignBottles = (
  photos: AssignPhoto[],
  entries: AssignEntry[],
  options: AssignOptions,
  bottleOptions: BottleOptions = DEFAULT_BOTTLE_OPTIONS,
): AssignResult => {
  const read: BottlePhoto[] = photos.map((photo) => {
    const label = photo.ocr ? readWineLabel(photo.ocr) : undefined;
    return label ? { ...photo, label } : photo;
  });
  const bottles: Bottle[] = groupBottles(read, bottleOptions).map((members) => ({
    photos: members,
    label: mergeLabels(members.flatMap(({ label }) => (label ? [label] : []))),
  }));

  const added: Array<{ name: string; description?: string; sourceId?: string }> = [];
  const addEntry = (bottle: Bottle & { label: WineLabel }) => {
    const entry = toWineEntry(bottle.label);
    const key = normalizeWords(entry.name);
    const index = added.findIndex((other) => normalizeWords(other.name) === key);
    if (index !== -1) {
      return entries.length + index;
    }
    const source = bottle.photos.find((photo) => photo.label) ?? bottle.photos[0];
    added.push({ name: entry.name, ...(entry.description && { description: entry.description }), sourceId: source.id });
    return entries.length + added.length - 1;
  };

  const matches: SubjectMatch[] = bottles.map((bottle) => {
    const ids = bottle.photos.map(({ id }) => id);
    const { label } = bottle;
    // one bottle on several photos is sure of its label only if they agree, which they do when grouped by it
    const byLookOnly =
      bottle.photos.length > 1 &&
      bottle.photos.every((photo, index) =>
        bottle.photos.every((other, j) => j === index || !isSameLabel(photo.label, other.label)),
      );

    if (label && entries.length > 0) {
      const scores = entries.map((entry) => scoreListEntry(label, entry));
      const best = scores.indexOf(Math.max(...scores));
      if (scores[best] >= bottleOptions.minListScore) {
        const suggestions: MatchSuggestion[] = scores
          .map((score, item) => ({ item, score, similarity: 0 }))
          .toSorted((a, b) => b.score - a.score)
          .slice(0, options.suggestions);
        const runnerUp = suggestions[1]?.score ?? 0;
        const sure = scores[best] >= bottleOptions.sureListScore && scores[best] - runnerUp >= 0.2 && !label.several;
        return { ids, item: best, score: scores[best], unsure: !sure, suggestions };
      }
    }

    if (label && formatWineName(label)) {
      const item = addEntry({ ...bottle, label });
      return {
        ids,
        item,
        score: round(label.confidence),
        unsure: !label.sure || label.several || byLookOnly,
        suggestions: [{ item, score: round(label.confidence), similarity: 0 }],
      };
    }

    // no label read: the line of the list CLIP finds most like the bottle, for the assistant to check
    const candidates = entries.flatMap((entry, index) => (entry.embedding ? [{ entry, index }] : []));
    const located = bottle.photos.filter((photo) => photo.embedding.length > 0);
    if (candidates.length === entries.length && candidates.length > 0 && located.length > 0) {
      const [match] = matchSubjects(
        located.map(({ id, time, embedding }) => ({ id, time, embedding })),
        candidates.map(({ entry }) => ({ embedding: entry.embedding! })),
        { ...options, order: 'none', sameSubjectDistance: 2, sameSubjectMinutes: Number.MAX_SAFE_INTEGER },
      ).matches;
      if (match) {
        return { ...match, ids, unsure: true };
      }
    }
    return { ids, score: 0, unsure: true, suggestions: [] };
  });

  const counts = new Map<number, number>();
  for (const { item } of matches) {
    if (item !== undefined) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return {
    matches: matches.map((match) =>
      match.item !== undefined && counts.get(match.item)! > 1 ? { ...match, shared: true } : match,
    ),
    ordered: false,
    ...(added.length > 0 && { entries: added }),
  };
};

import { UnionFind, cosineDistance } from 'src/utils/agent/clustering.js';
import { CLIP_TEMPERATURE, softmax } from 'src/utils/food/classify.js';

export type DishPhoto = {
  id: string;
  /** capture time in ms */
  time: number;
  /** L2-normalized CLIP image embedding */
  embedding: Float32Array;
};

export type DishCandidate = {
  /** L2-normalized CLIP text embedding of the item's name (and description) */
  embedding: Float32Array;
};

export type MatchOptions = {
  /** photos at most this cosine distance apart show the same dish */
  sameDishDistance: number;
  /** looser distance for photos that also agree on their best item */
  sameItemDistance: number;
  /** photos of one dish are taken within this many minutes */
  sameDishMinutes: number;
  /** a match below this probability is left out (the suggestions remain) */
  minScore: number;
  /** a match at or above this probability, and ahead of the runner-up by `margin`, is sure */
  sureScore: number;
  margin: number;
  /** the log-probability cost of giving a dish the same item as another dish instead of an item of its own */
  sharePenalty: number;
};

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  sameDishDistance: 0.08,
  sameItemDistance: 0.16,
  sameDishMinutes: 30,
  minScore: 0.05,
  sureScore: 0.5,
  margin: 0.2,
  sharePenalty: Math.log(8),
};

export type MatchSuggestion = {
  /** index of the candidate item */
  item: number;
  /** probability among the items, 0..1 */
  score: number;
  /** cosine similarity of the photo and the item's text */
  similarity: number;
};

export type DishMatch = {
  /** photos of the same dish, in time order */
  ids: string[];
  /** the item assigned to the dish, when any clears `minScore` */
  item?: number;
  score: number;
  /** the assignment is weak, or not the photos' favourite: check it by looking at the photos */
  unsure: boolean;
  /** the item is also matched to another dish */
  shared?: boolean;
  /** probability that the dish is not on the menu (with baselines) */
  offMenu?: number;
  suggestions: MatchSuggestion[];
};

const dot = (a: Float32Array, b: Float32Array) => 1 - cosineDistance(a, b);

/**
 * The assignment of rows to columns that maximizes the total score (Hungarian algorithm, O(n²m)). Every row gets a
 * different column while there are columns left; the rest get -1.
 */
export const assignMax = (scores: number[][]): number[] => {
  const rows = scores.length;
  const columns = rows > 0 ? scores[0].length : 0;
  if (rows === 0 || columns === 0) {
    return Array.from({ length: rows }, () => -1);
  }
  if (rows > columns) {
    // assign the columns to rows instead
    const transposed = Array.from({ length: columns }, (_, j) => scores.map((row) => row[j]));
    const byColumn = assignMax(transposed);
    const result = Array.from({ length: rows }, () => -1);
    for (const [column, row] of byColumn.entries()) {
      if (row >= 0) {
        result[row] = column;
      }
    }
    return result;
  }

  // minimize cost = max - score, with 1-based potentials (e-maxx formulation)
  const max = Math.max(...scores.flat());
  const cost = (i: number, j: number) => max - scores[i - 1][j - 1];
  const u = Array.from({ length: rows + 1 }, () => 0);
  const v = Array.from({ length: columns + 1 }, () => 0);
  const p = Array.from({ length: columns + 1 }, () => 0);
  const way = Array.from({ length: columns + 1 }, () => 0);

  for (let i = 1; i <= rows; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array.from({ length: columns + 1 }, () => Infinity);
    const used = Array.from({ length: columns + 1 }, () => false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= columns; j++) {
        if (used[j]) {
          continue;
        }
        const current = cost(i0, j) - u[i0] - v[j];
        if (current < minv[j]) {
          minv[j] = current;
          way[j] = j0;
        }
        if (!(minv[j] < delta)) {
          continue;
        }

        delta = minv[j];
        j1 = j;
      }
      for (let j = 0; j <= columns; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = Array.from({ length: rows }, () => -1);
  for (let j = 1; j <= columns; j++) {
    if (p[j] > 0) {
      result[p[j] - 1] = j - 1;
    }
  }
  return result;
};

const argmax = (values: number[]) => values.indexOf(Math.max(...values));

const average = (members: number[], value: (index: number) => number) => {
  let sum = 0;
  for (const member of members) {
    sum += value(member);
  }
  return sum / members.length;
};

/** groups photos of the same dish: near-duplicates, or similar photos that agree on their best item */
export const groupDishPhotos = (photos: DishPhoto[], similarities: number[][], options: MatchOptions) => {
  const order = photos.map((_, index) => index).toSorted((a, b) => photos[a].time - photos[b].time);
  const best = similarities.map((row) => (row.length > 0 ? argmax(row) : -1));
  const unionFind = new UnionFind(photos.length);
  for (const [position, i] of order.entries()) {
    for (const j of order.slice(position + 1)) {
      if (photos[j].time - photos[i].time > options.sameDishMinutes * 60_000) {
        break;
      }
      const distance = cosineDistance(photos[i].embedding, photos[j].embedding);
      if (
        distance <= options.sameDishDistance ||
        (distance <= options.sameItemDistance && best[i] === best[j] && best[i] >= 0)
      ) {
        unionFind.union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (const index of order) {
    const root = unionFind.find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  }
  return groups.values().toArray();
};

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Matches the dish photos of a meal with the items of its menu. The CLIP image embedding of each photo is compared
 * with the CLIP text embedding of each item and turned into probabilities (a softmax at CLIP's temperature); with
 * `baselines` (generic "food", "bread", "coffee"... texts) the best of them takes part as "not on the menu". Photos of
 * the same dish are grouped and share one item. The groups then get different items in a one-to-one assignment that
 * maximizes the total log probability, except that a group may share its favourite item with another group at a
 * cost of `sharePenalty` (two plates of the same dish, one "assortment of desserts" course). A group whose favourite
 * is "not on the menu", or whose match is below `minScore`, gets no item. Weak matches, and matches that are not a
 * group's favourite, are marked unsure; every group keeps its top suggestions.
 */
export const matchDishes = (
  photos: DishPhoto[],
  items: DishCandidate[],
  options: Partial<MatchOptions> & {
    suggestions?: number;
    /** text embeddings of dishes that are usually not on menus, e.g. "a photo of food", "a photo of bread" */
    baselines?: Float32Array[];
  } = {},
): DishMatch[] => {
  const settings = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const baselines = options.baselines ?? [];
  const similarities = photos.map((photo) => items.map((item) => dot(photo.embedding, item.embedding)));
  const groups = groupDishPhotos(photos, similarities, settings);

  const groupSimilarities = groups.map((members) =>
    items.map((_, item) => average(members, (index) => similarities[index][item])),
  );
  const noneSimilarities = groups.map((members) =>
    baselines.length === 0
      ? undefined
      : Math.max(...baselines.map((baseline) => average(members, (member) => dot(photos[member].embedding, baseline)))),
  );
  const probabilities = groups.map((_, index) => {
    const row = groupSimilarities[index];
    const none = noneSimilarities[index];
    return none === undefined ? softmax(row, CLIP_TEMPERATURE) : softmax([...row, none], CLIP_TEMPERATURE);
  });

  // log probabilities make the assignment prefer confident matches over many lukewarm ones; the extra column of each
  // group is "share my favourite item"
  const logs = probabilities.map((row) => row.slice(0, items.length).map((value) => Math.log(Math.max(value, 1e-9))));
  const matrix = logs.map((row, index) => [
    ...row,
    ...groups.map((_, other) =>
      other === index && row.length > 0 ? Math.max(...row) - settings.sharePenalty : -Infinity,
    ),
  ]);
  const finite = matrix.map((row) => row.map((value) => (Number.isFinite(value) ? value : -1e6)));
  const assignment = items.length > 0 ? assignMax(finite) : groups.map(() => -1);

  const matches = groups.map((members, index) => {
    const row = probabilities[index].slice(0, items.length);
    const noneScore = noneSimilarities[index] === undefined ? 0 : probabilities[index][items.length];
    const ranked = row
      .map((score, item) => ({ item, score, similarity: groupSimilarities[index][item] }))
      .toSorted((a, b) => b.score - a.score);
    const favourite = ranked[0];

    let assigned = assignment[index];
    const shared = assigned >= items.length;
    if (shared) {
      assigned = favourite.item;
    }
    const score = assigned >= 0 ? row[assigned] : 0;
    const offMenu = noneScore > (favourite?.score ?? 0);
    const matched = assigned >= 0 && score >= settings.minScore && !offMenu;
    const runnerUp = Math.max(noneScore, ranked.find(({ item }) => item !== assigned)?.score ?? 0);
    const sure =
      matched && favourite?.item === assigned && score >= settings.sureScore && score - runnerUp >= settings.margin;

    const match: DishMatch = {
      ids: members.map((member) => photos[member].id),
      ...(matched && { item: assigned }),
      score: round(matched ? score : 0),
      unsure: !sure,
      ...(noneSimilarities[index] !== undefined && { offMenu: round(noneScore) }),
      suggestions: ranked.slice(0, options.suggestions ?? 3).map((suggestion) => ({
        item: suggestion.item,
        score: round(suggestion.score),
        similarity: round(suggestion.similarity),
      })),
    };
    return match;
  });

  const counts = new Map<number, number>();
  for (const { item } of matches) {
    if (item !== undefined) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return matches.map((match) =>
    match.item !== undefined && counts.get(match.item)! > 1 ? { ...match, shared: true } : match,
  );
};

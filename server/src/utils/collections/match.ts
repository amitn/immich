import type { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { UnionFind, cosineDistance } from 'src/utils/agent/clustering.js';
import { softmax } from 'src/utils/collections/classify.js';

/*
 * Matching the subject photos of a visit with the entries of its source. The matcher was made for food and speaks
 * its language: a dish is a subject photo (or a group of photos of one subject), an item an entry, the menu the
 * source, and a course the place of an entry in the order of the source, which subjects may follow (the courses of a
 * tasting menu, the rooms of an exhibition). "Not on the menu" is off the list: a subject that is no entry.
 */

export type SubjectPhoto = {
  id: string;
  /** capture time in ms */
  time: number;
  /** L2-normalized CLIP image embedding */
  embedding: Float32Array;
};

export type EntryCandidate = {
  /** L2-normalized CLIP text embedding of the item's name (and description) */
  embedding: Float32Array;
  /**
   * the place of the item among the courses of the menu, in the order they are served (the order they are printed
   * in); items outside that sequence, such as the drinks of a pairing printed in a column of their own, have none
   */
  course?: number;
  /** the item has a price on the menu */
  priced?: boolean;
};

export type MatchOptions = {
  /** photos at most this cosine distance apart show the same dish (a burst, or another shot of the plate)... */
  sameSubjectDistance: number;
  /** ...when taken within this many minutes of each other */
  sameSubjectMinutes: number;
  /** a match below this probability is left out (the suggestions remain) */
  minScore: number;
  /** a match at or above this probability, and ahead of the runner-up by `margin`, is sure */
  sureScore: number;
  margin: number;
  /** the log-probability cost of giving a dish the same item as another dish instead of an item of its own */
  sharePenalty: number;
  /**
   * CLIP likes some texts for every photo of a meal (a long description, a word like "caviar"): at a meal of at least
   * `centerSubjects` dishes, each item's similarity is measured against its average over the meal's dishes, pooled with
   * `pooling` dishes at the average of all items (a meal of a few dishes can't tell a text CLIP likes from a dish)
   */
  pooling: number;
  centerSubjects: number;
  /** added to the similarity of the best "not on the menu" text */
  offListBias: number;
  /**
   * whether dishes follow the order of the courses: 'source' always, 'none' never, 'auto' for menus with few prices
   * where the order fits the photos better than most shuffled orders
   */
  order: 'auto' | 'source' | 'none';
  /** with 'auto', at most this fraction of shuffled orders of the courses may fit the photos as well as the menu order */
  orderEvidence: number;
  /** the log-probability cost of each course between two matched dishes that no photo shows */
  skipPenalty: number;
  /** the log-probability cost of matching an item outside the courses (a drink of the pairing) out of order */
  asidePenalty: number;
  /**
   * the courses of a tasting menu come at a roughly even pace: a dish photographed a fraction of the way through the
   * meal is about that fraction of the way through the courses; each unit of the difference beyond `paceTolerance`
   * costs this much log probability
   */
  pacePenalty: number;
  paceTolerance: number;
  /** the log-probability cost of a dish not on the menu, at a tasting menu where most dishes are courses */
  offPenalty: number;
  /**
   * the logit scale of the probabilities of a dish over the items: below CLIP's own, as the differences between
   * menu items are smaller than between the labels CLIP was made for
   */
  temperature: number;
};

/** calibrated on real meals, see `src/utils/collections/packs/food/benchmark.spec.ts` */
export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  sameSubjectDistance: 0.03,
  sameSubjectMinutes: 5,
  minScore: 0.05,
  sureScore: 0.5,
  margin: 0.2,
  sharePenalty: Math.log(8),
  pooling: 3,
  centerSubjects: 4,
  offListBias: 0,
  order: 'auto',
  orderEvidence: 0.15,
  skipPenalty: 0,
  asidePenalty: 2,
  pacePenalty: 10,
  paceTolerance: 0.2,
  offPenalty: 0.5,
  temperature: 70,
};

export type MatchSuggestion = {
  /** index of the candidate item */
  item: number;
  /** probability that the dish is this item, 0..1 */
  score: number;
  /** cosine similarity of the photo and the item's text */
  similarity: number;
};

export type SubjectMatch = {
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
  offList?: number;
  suggestions: MatchSuggestion[];
};

export type MatchResult = {
  matches: SubjectMatch[];
  /** the dishes were matched in the order of the courses of the menu */
  ordered: boolean;
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

const average = (members: number[], value: (index: number) => number) => {
  let sum = 0;
  for (const member of members) {
    sum += value(member);
  }
  return sum / members.length;
};

/**
 * Groups photos of the same dish: near-identical photos (a burst, or the plate shot again) taken within a few
 * minutes. Plated courses of a tasting menu look alike to CLIP (white plates on white tablecloths), so anything less
 * alike, or further apart in time, is another dish.
 */
export const groupSubjectPhotos = (
  photos: SubjectPhoto[],
  options: Pick<MatchOptions, 'sameSubjectDistance' | 'sameSubjectMinutes'>,
) => {
  const order = photos.map((_, index) => index).toSorted((a, b) => photos[a].time - photos[b].time);
  const unionFind = new UnionFind(photos.length);
  for (const [position, i] of order.entries()) {
    for (const j of order.slice(position + 1)) {
      if (photos[j].time - photos[i].time > options.sameSubjectMinutes * 60_000) {
        break;
      }
      if (cosineDistance(photos[i].embedding, photos[j].embedding) <= options.sameSubjectDistance) {
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

const logSumExp = (values: number[]) => {
  const max = Math.max(...values);
  if (max === -Infinity) {
    return -Infinity;
  }
  let sum = 0;
  for (const value of values) {
    sum += Math.exp(value - max);
  }
  return max + Math.log(sum);
};

/** what a dish is: a course, an item aside from the courses, the course of the dish before, or not on the menu */
type Choice = { kind: 'course' | 'aside' | 'share' | 'off'; item: number };

export type Alignment = {
  /** the log probability of the best alignment */
  total: number;
  choices: Choice[];
  /** the probability of each dish being each item, over all alignments */
  marginals: number[][];
  /** the probability of each dish not being on the menu */
  offMarginals: number[];
};

type Step = { to: number; weight: number; choice: Choice };

export type AlignOptions = Pick<
  MatchOptions,
  'sharePenalty' | 'skipPenalty' | 'asidePenalty' | 'pacePenalty' | 'paceTolerance' | 'offPenalty'
> & {
  /** how far through the meal each dish was photographed, 0..1 */
  pace?: number[];
};

/**
 * Aligns dishes (in time order) with courses (in menu order): each dish takes a later course than the dish before
 * it, the same course (another plate of it) at `sharePenalty`, an item outside the courses at `asidePenalty`, or none
 * (not on the menu); each course that no photo shows between two dishes costs `skipPenalty`. `logs` are the log
 * probabilities of each dish over the items, with a last column for "not on the menu". Returns the best alignment
 * (Viterbi) and, with `marginals`, the probability of each dish being each item over all alignments
 * (forward-backward).
 */
export const alignCourses = (
  logs: number[][],
  courses: number[],
  aside: number[],
  settings: AlignOptions,
  marginals = true,
): Alignment => {
  const { sharePenalty, skipPenalty, asidePenalty, pacePenalty, paceTolerance, offPenalty, pace } = settings;
  const dishes = logs.length;
  // a state is the number of courses served so far (the last one taken)
  const states = courses.length + 1;
  const offPace = (dish: number, course: number) =>
    pace && pacePenalty > 0 && courses.length > 1
      ? pacePenalty * Math.max(0, Math.abs(pace[dish] - (course - 1) / (courses.length - 1)) - paceTolerance)
      : 0;
  const steps = (dish: number, state: number): Step[] => {
    const row = logs[dish];
    const result: Step[] = [{ to: state, weight: row.at(-1)! - offPenalty, choice: { kind: 'off', item: -1 } }];
    for (let next = state + 1; next < states; next++) {
      const item = courses[next - 1];
      const skipped = state === 0 ? 0 : next - state - 1;
      result.push({
        to: next,
        weight: row[item] - skipPenalty * skipped - offPace(dish, next),
        choice: { kind: 'course', item },
      });
    }
    if (state > 0) {
      const item = courses[state - 1];
      result.push({
        to: state,
        weight: row[item] - sharePenalty - offPace(dish, state),
        choice: { kind: 'share', item },
      });
    }
    for (const item of aside) {
      result.push({ to: state, weight: row[item] - asidePenalty, choice: { kind: 'aside', item } });
    }
    return result;
  };
  const start = Array.from({ length: states }, (_, state) => (state === 0 ? 0 : -Infinity));

  // Viterbi
  let best = start;
  const back: Array<Array<{ from: number; choice: Choice } | undefined>> = [];
  for (let dish = 0; dish < dishes; dish++) {
    const next = Array.from({ length: states }, () => -Infinity);
    const from: Array<{ from: number; choice: Choice } | undefined> = Array.from({ length: states });
    for (let state = 0; state < states; state++) {
      if (best[state] === -Infinity) {
        continue;
      }
      for (const { to, weight, choice } of steps(dish, state)) {
        if (!(best[state] + weight > next[to])) {
          continue;
        }

        next[to] = best[state] + weight;
        from[to] = { from: state, choice };
      }
    }
    best = next;
    back.push(from);
  }
  let state = best.indexOf(Math.max(...best));
  const total = best[state];
  const choices: Choice[] = [];
  for (let dish = dishes - 1; dish >= 0; dish--) {
    const step = back[dish][state]!;
    choices.unshift(step.choice);
    state = step.from;
  }
  if (!marginals) {
    return { total, choices, marginals: [], offMarginals: [] };
  }

  // forward-backward
  const forward: number[][] = [start];
  for (let dish = 0; dish < dishes; dish++) {
    const terms: number[][] = Array.from({ length: states }, () => []);
    for (let state = 0; state < states; state++) {
      if (forward[dish][state] !== -Infinity) {
        for (const { to, weight } of steps(dish, state)) {
          terms[to].push(forward[dish][state] + weight);
        }
      }
    }
    forward.push(terms.map((values) => logSumExp(values)));
  }
  const backward: number[][] = Array.from({ length: dishes + 1 });
  backward[dishes] = Array.from({ length: states }, () => 0);
  for (let dish = dishes - 1; dish >= 0; dish--) {
    backward[dish] = Array.from({ length: states }, (_, state) =>
      logSumExp(steps(dish, state).map(({ to, weight }) => weight + backward[dish + 1][to])),
    );
  }
  const logZ = logSumExp(forward[dishes]);
  const items = Math.max(0, (logs[0]?.length ?? 1) - 1);
  const result: Alignment = { total, choices, marginals: [], offMarginals: [] };
  for (let dish = 0; dish < dishes; dish++) {
    const byItem: number[][] = Array.from({ length: items }, () => []);
    const byOff: number[] = [];
    for (let state = 0; state < states; state++) {
      if (forward[dish][state] === -Infinity) {
        continue;
      }
      for (const { to, weight, choice } of steps(dish, state)) {
        const value = forward[dish][state] + weight + backward[dish + 1][to] - logZ;
        if (choice.kind === 'off') {
          byOff.push(value);
        } else {
          byItem[choice.item].push(value);
        }
      }
    }
    result.marginals.push(byItem.map((values) => Math.exp(logSumExp(values))));
    result.offMarginals.push(Math.exp(logSumExp(byOff)));
  }
  return result;
};

/** a fixed sequence of pseudo-random numbers, so that the same meal always gets the same answer */
const random = (seed: number) => {
  let value = seed;
  return () => {
    value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return value / 2_147_483_648;
  };
};

const shuffle = <T>(values: T[], next: () => number) => {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const value = result[i];
    result[i] = result[j];
    result[j] = value;
  }
  return result;
};

/** shuffled orders of the courses the menu order is compared with */
const SHUFFLES = 40;

/**
 * The fraction of shuffled orders of the courses that fit the photos at least as well as the menu order (the order of
 * an à la carte menu tells nothing about the order of the photos, that of a tasting menu does).
 */
export const getOrderRank = (
  logs: number[][],
  courses: number[],
  aside: number[],
  settings: AlignOptions,
  total = alignCourses(logs, courses, aside, settings, false).total,
) => {
  const next = random(courses.length * 7919 + logs.length);
  let beaten = 0;
  for (let i = 0; i < SHUFFLES; i++) {
    if (alignCourses(logs, shuffle(courses, next), aside, settings, false).total >= total) {
      beaten++;
    }
  }
  return beaten / SHUFFLES;
};

/**
 * Matches the dish photos of a meal with the items of its menu. The CLIP image embedding of each photo is compared
 * with the CLIP text embedding of each item, as a difference from the item's average similarity over the meal's
 * dishes (CLIP likes some texts for every photo); with `baselines` (generic "food", "bread", "coffee"... texts) the
 * best of them takes part as "not on the menu", measured the same way. Photos of the same dish (near-identical,
 * minutes apart) are grouped and share one item; each group gets probabilities over the items and "not on the menu"
 * (a softmax at CLIP's temperature).
 *
 * At a tasting menu (items with `course` numbers and few prices) dishes are photographed in the order of the
 * courses: the groups, in time order, are aligned with the courses, skipping courses no photo shows and dishes that
 * are not on the menu (amuse-bouches, bread, coffee, petits fours), when that order fits the photos better than most
 * shuffled orders. The score of each match is then its probability over all alignments. Otherwise the groups get
 * different items in a one-to-one assignment that maximizes the total log probability, except that a group may share
 * its favourite item with another group at a cost of `sharePenalty` (two plates of the same dish). Weak matches, and
 * matches that are not a group's favourite, are marked unsure; every group keeps its top suggestions.
 */
export const matchSubjects = (
  photos: SubjectPhoto[],
  items: EntryCandidate[],
  options: Partial<MatchOptions> & {
    suggestions?: number;
    /** text embeddings of dishes that are usually not on menus, e.g. "a photo of food", "a photo of bread" */
    baselines?: Float32Array[];
  } = {},
): MatchResult => {
  const settings = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const baselines = options.baselines ?? [];
  const suggestions = options.suggestions ?? 3;
  const groups = groupSubjectPhotos(photos, settings);

  const similarities = groups.map((members) =>
    items.map((item) => average(members, (member) => dot(photos[member].embedding, item.embedding))),
  );
  const baselineSimilarities = groups.map((members) =>
    baselines.map((baseline) => average(members, (member) => dot(photos[member].embedding, baseline))),
  );

  // each text against its average over the meal, pooled with the average of all texts
  const center = (rows: number[][]) => {
    if (rows.length < settings.centerSubjects) {
      return rows;
    }
    const all = rows.flat();
    const grand = all.length > 0 ? all.reduce((sum, value) => sum + value, 0) / all.length : 0;
    const means = (rows[0] ?? []).map(
      (_, column) =>
        (rows.reduce((sum, row) => sum + row[column], 0) + settings.pooling * grand) / (rows.length + settings.pooling),
    );
    return rows.map((row) => row.map((value, column) => value - means[column]));
  };
  const centered = center(similarities);
  const centeredBaselines = center(baselineSimilarities);
  const hasOff = baselines.length > 0;
  const probabilities = groups.map((_, group) =>
    softmax(
      hasOff ? [...centered[group], Math.max(...centeredBaselines[group]) + settings.offListBias] : centered[group],
      settings.temperature,
    ),
  );
  const logs = probabilities.map((row) => [
    ...row.slice(0, items.length).map((value) => Math.log(Math.max(value, 1e-12))),
    hasOff ? Math.log(Math.max(row[items.length], 1e-12)) : -Infinity,
  ]);

  // the courses in menu order, and the items aside from them
  const courses = items
    .map((item, index) => ({ course: item.course, index }))
    .filter(({ course }) => course !== undefined)
    .toSorted((a, b) => a.course! - b.course!)
    .map(({ index }) => index);
  const aside = items.map((_, index) => index).filter((index) => items[index].course === undefined);
  const priced = courses.filter((index) => items[index].priced).length;

  // how far through the meal each group was photographed
  const times = groups.map((members) => photos[members[0]].time);
  const first = Math.min(...times);
  const span = Math.max(...times) - first;
  const alignOptions: AlignOptions = {
    ...settings,
    pace: times.map((time) => (span > 0 ? (time - first) / span : 0)),
  };

  let alignment: Alignment | undefined;
  if (settings.order !== 'none' && courses.length >= 2 && groups.length >= 2) {
    const candidate = alignCourses(logs, courses, aside, alignOptions);
    // few prices, and about as many courses as dishes (not a long list to choose from)
    const tasting = priced < 0.3 * courses.length && courses.length <= 2 * groups.length + 3;
    if (
      settings.order === 'source' ||
      (tasting && getOrderRank(logs, courses, aside, alignOptions, candidate.total) <= settings.orderEvidence)
    ) {
      alignment = candidate;
    }
  }

  const matches = alignment
    ? toAlignedMatches(groups, photos, similarities, alignment, settings, suggestions, hasOff)
    : toAssignedMatches(groups, photos, items, similarities, probabilities, logs, settings, suggestions, hasOff);

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
    ordered: alignment !== undefined,
  };
};

/** a subject photo for a pack's own assignment: the text read on it (OCR) too */
export type AssignPhoto = SubjectPhoto & {
  text?: string;
  /**
   * the OCR boxes of the photo, for a pack whose subjects carry their source (`source.onSubjects`, e.g. the label of
   * a bottle): read at full resolution, with the words only the stored OCR has
   */
  ocr?: OcrBoxInput[];
};

/** an entry for a pack's own assignment: its name and description as read, and when its source photo was taken */
export type AssignEntry = Omit<EntryCandidate, 'embedding'> & {
  name: string;
  description?: string;
  /** L2-normalized CLIP text embedding of the entry, when smart search is enabled */
  embedding?: Float32Array;
  /** local capture time in ms of the source photo the entry was read on */
  sourceTime?: number;
};

export type AssignOptions = MatchOptions & {
  /** text embeddings of subjects that are usually not on the sources, see `matchSubjects` */
  baselines: Float32Array[];
  suggestions: number;
};

/**
 * The assignment of a pack's own: the matches, and the entries it read on the subjects themselves (e.g. the label of
 * each bottle), which come after the given ones (the matches' `item` counts on from them)
 */
export type AssignResult = MatchResult & {
  entries?: Array<{ name: string; description?: string; sourceId?: string }>;
};

/**
 * A pack's own way of assigning the subjects of a visit to its entries, in place of `matchSubjects` (which matches
 * them by what CLIP sees), e.g. by time for the legs of a trip. Photos without an embedding have an empty one.
 */
export type SubjectAssigner = (photos: AssignPhoto[], entries: AssignEntry[], options: AssignOptions) => AssignResult;

/** the matches of `matchSubjects` */
export const getSubjectMatches = (...args: Parameters<typeof matchSubjects>): SubjectMatch[] =>
  matchSubjects(...args).matches;

const toSuggestions = (scores: number[], similarities: number[], count: number) =>
  scores
    .map((score, item) => ({ item, score, similarity: similarities[item] }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ item, score, similarity }) => ({ item, score: round(score), similarity: round(similarity) }));

const toAlignedMatches = (
  groups: number[][],
  photos: SubjectPhoto[],
  similarities: number[][],
  { choices, marginals, offMarginals }: Alignment,
  settings: MatchOptions,
  suggestions: number,
  hasOff: boolean,
): SubjectMatch[] =>
  groups.map((members, group) => {
    const scores = marginals[group];
    const choice = choices[group];
    const matched = choice.kind !== 'off' && scores[choice.item] >= settings.minScore;
    const score = matched ? scores[choice.item] : 0;
    const runnerUp = Math.max(offMarginals[group], ...scores.filter((_, item) => item !== choice.item));
    const sure = matched && score >= settings.sureScore && score - runnerUp >= settings.margin;
    return {
      ids: members.map((member) => photos[member].id),
      ...(matched && { item: choice.item }),
      score: round(score),
      unsure: !sure,
      ...(hasOff && { offList: round(offMarginals[group]) }),
      suggestions: toSuggestions(scores, similarities[group], suggestions),
    };
  });

const toAssignedMatches = (
  groups: number[][],
  photos: SubjectPhoto[],
  items: EntryCandidate[],
  similarities: number[][],
  probabilities: number[][],
  logs: number[][],
  settings: MatchOptions,
  suggestions: number,
  hasOff: boolean,
): SubjectMatch[] => {
  // log probabilities make the assignment prefer confident matches over many lukewarm ones; the extra columns of
  // each group are "share my favourite item" and "not on the menu"
  const matrix = logs.map((row, index) => {
    const itemLogs = row.slice(0, items.length);
    const favourite = itemLogs.length > 0 ? Math.max(...itemLogs) : -Infinity;
    return [
      ...itemLogs,
      ...groups.map((_, other) => (other === index ? favourite - settings.sharePenalty : -Infinity)),
      ...groups.map((_, other) => (other === index ? row[items.length] : -Infinity)),
    ];
  });
  const finite = matrix.map((row) => row.map((value) => (Number.isFinite(value) ? value : -1e6)));
  const assignment = items.length > 0 ? assignMax(finite) : groups.map(() => -1);

  return groups.map((members, index) => {
    const row = probabilities[index].slice(0, items.length);
    const offScore = hasOff ? probabilities[index][items.length] : 0;
    const favourite = row.length > 0 ? row.indexOf(Math.max(...row)) : -1;

    let assigned = assignment[index];
    if (assigned >= items.length + groups.length) {
      assigned = -1;
    } else if (assigned >= items.length) {
      assigned = favourite;
    }
    const score = assigned >= 0 ? row[assigned] : 0;
    const matched = assigned >= 0 && score >= settings.minScore;
    const runnerUp = Math.max(offScore, ...row.filter((_, item) => item !== assigned));
    const sure =
      matched && favourite === assigned && score >= settings.sureScore && score - runnerUp >= settings.margin;

    return {
      ids: members.map((member) => photos[member].id),
      ...(matched && { item: assigned }),
      score: round(matched ? score : 0),
      unsure: !sure,
      ...(hasOff && { offList: round(offScore) }),
      suggestions: toSuggestions(row, similarities[index], suggestions),
    };
  });
};

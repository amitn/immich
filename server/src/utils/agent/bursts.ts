import { BurstGroupSource, BurstKeepReason } from 'src/enum.js';
import { ClusterItem, UnionFind, cosineDistance, getClusterDefaults } from 'src/utils/agent/clustering.js';
import { PhotoScore } from 'src/utils/agent/scoring.js';

/**
 * Burst cleanup (#9): groups of near-identical photos (noodle's duplicate groups, stacks, and bursts found here), the
 * photo of each group worth keeping, and why.
 */

/** what the user prefers to keep, applied in this order before the quality score */
export type BurstRules = {
  /** keep a RAW photo over a JPEG or HEIC of the same moment */
  preferRaw: boolean;
  /** keep a photo edited in the app over the unedited ones */
  preferEdited: boolean;
  /** keep the photo with the most pixels (then the biggest file) */
  preferLargest: boolean;
};

export const DEFAULT_BURST_RULES: BurstRules = { preferRaw: false, preferEdited: true, preferLargest: false };

export const toBurstRules = (rules?: Partial<BurstRules>): BurstRules => ({
  preferRaw: rules?.preferRaw ?? DEFAULT_BURST_RULES.preferRaw,
  preferEdited: rules?.preferEdited ?? DEFAULT_BURST_RULES.preferEdited,
  preferLargest: rules?.preferLargest ?? DEFAULT_BURST_RULES.preferLargest,
});

/** photos taken at most this far apart (chained) can be a burst */
export const BURST_MAX_SECONDS = 3;

export type BurstOptions = {
  /** seconds between two photos of a burst, chained: a 10-photo burst can last longer */
  maxSeconds: number;
  /** cosine distance of the CLIP embeddings at or below which two photos taken that close show the same moment */
  maxDistance: number;
};

/** from the duplicate detection `maxDistance`: the `burstDistance` of `cluster_similar` */
export const getBurstDefaults = (duplicateMaxDistance: number): BurstOptions => ({
  maxSeconds: BURST_MAX_SECONDS,
  maxDistance: getClusterDefaults(duplicateMaxDistance).burstDistance,
});

/** the ids of photos that have another photo within `maxSeconds`: the only ones that can be in a burst */
export const getBurstCandidates = (items: Array<{ id: string; time: number }>, maxSeconds: number) => {
  const sorted = items.toSorted((a, b) => a.time - b.time);
  const maxMs = maxSeconds * 1000;
  const ids = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    if (!(sorted[i].time - sorted[i - 1].time <= maxMs)) {
      continue;
    }

    ids.add(sorted[i].id);
    ids.add(sorted[i - 1].id);
  }
  return ids;
};

/**
 * Bursts: photos taken within `maxSeconds` of each other (chained) whose embeddings are at most `maxDistance` apart.
 * Only neighbours in time are compared, so it scales with the number of photos, not its square. Photos without an
 * embedding are never in a burst. Returns the groups of two or more photos, in time order.
 */
export const clusterBursts = (items: ClusterItem[], options: BurstOptions): string[][] => {
  const sorted = items
    .filter((item) => !!item.embedding)
    .toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const unionFind = new UnionFind(sorted.length);
  const maxMs = options.maxSeconds * 1000;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].time - sorted[i].time <= maxMs; j++) {
      if (
        unionFind.find(i) !== unionFind.find(j) &&
        cosineDistance(sorted[i].embedding!, sorted[j].embedding!) <= options.maxDistance
      ) {
        unionFind.union(i, j);
      }
    }
  }

  const groups = new Map<number, string[]>();
  for (const [i, item] of sorted.entries()) {
    const root = unionFind.find(i);
    groups.set(root, [...(groups.get(root) ?? []), item.id]);
  }
  return groups
    .values()
    .filter((ids) => ids.length > 1)
    .toArray();
};

/** a photo of the scope, as `getForBurstScan` returns it */
export type BurstScanAsset = {
  id: string;
  ownerId: string;
  time: number;
  isImage: boolean;
  duplicateId: string | null;
  stackId: string | null;
  /** a copy made by the assistant (crop, improved, artwork...), stacked with its original: not a burst */
  isCopy: boolean;
};

export type BurstGroupDraft = {
  key: string;
  source: BurstGroupSource;
  duplicateId: string | null;
  stackId: string | null;
  assetIds: string[];
  /** the time of the newest photo, to list the newest groups first */
  time: number;
};

const toDraft = (
  source: BurstGroupSource,
  id: string,
  members: BurstScanAsset[],
  extra: Pick<BurstGroupDraft, 'duplicateId' | 'stackId'>,
): BurstGroupDraft => ({
  key: `${source}:${id}`,
  source,
  ...extra,
  assetIds: members.map(({ id }) => id),
  time: Math.max(...members.map(({ time }) => time)),
});

/**
 * Splits the photos of a scope into noodle's duplicate groups and stacks (of two or more photos of the scope), and the
 * rest, which `clusterBursts` may group. Stacks that hold the assistant's copies are left alone: they keep versions of
 * a photo on purpose. A photo is in one group at most: its duplicate group, else its stack.
 */
export const partitionBurstScan = (assets: BurstScanAsset[]) => {
  const byDuplicate = new Map<string, BurstScanAsset[]>();
  const byStack = new Map<string, BurstScanAsset[]>();
  for (const asset of assets) {
    if (asset.duplicateId) {
      byDuplicate.set(asset.duplicateId, [...(byDuplicate.get(asset.duplicateId) ?? []), asset]);
    }
  }

  const grouped = new Set<string>();
  const groups: BurstGroupDraft[] = [];
  for (const [duplicateId, members] of byDuplicate) {
    if (!(members.length > 1)) {
      continue;
    }

    groups.push(toDraft(BurstGroupSource.Duplicate, duplicateId, members, { duplicateId, stackId: null }));
    for (const { id } of members) {
      grouped.add(id);
    }
  }

  for (const asset of assets) {
    if (asset.stackId && !grouped.has(asset.id)) {
      byStack.set(asset.stackId, [...(byStack.get(asset.stackId) ?? []), asset]);
    }
  }
  const stacked = new Set<string>();
  for (const [stackId, members] of byStack) {
    for (const { id } of members) {
      stacked.add(id);
    }
    if (members.length > 1 && members.every(({ isCopy }) => !isCopy)) {
      groups.push(toDraft(BurstGroupSource.Stack, stackId, members, { duplicateId: null, stackId }));
    }
  }

  // stacked photos stay out of bursts even when their stack is not cleaned up: they were grouped on purpose
  const rest = assets.filter(({ id, isImage, isCopy }) => isImage && !isCopy && !grouped.has(id) && !stacked.has(id));
  return { groups, rest };
};

export const toBurstDrafts = (clusters: string[][], assets: Map<string, BurstScanAsset>): BurstGroupDraft[] =>
  clusters.map((ids) => {
    const members = ids.map((id) => assets.get(id)!);
    return toDraft(BurstGroupSource.Burst, ids[0], members, { duplicateId: null, stackId: null });
  });

/** a photo of a group to rank */
export type BurstCandidate = {
  id: string;
  isRaw: boolean;
  isEdited: boolean;
  /** width × height, 0 when unknown */
  pixels: number;
  /** bytes, 0 when unknown */
  fileSize: number;
  isFavorite: boolean;
  rating: number | null;
  score: PhotoScore;
};

export type BurstRanking = {
  /** best first */
  order: string[];
  keepId: string;
  reasons: BurstKeepReason[];
};

const sizeOrder = (a: BurstCandidate, b: BurstCandidate) => b.pixels - a.pixels || b.fileSize - a.fileSize;

/** the rules in order, then the quality score, then the size, then the id */
export const compareBurstCandidates = (rules: BurstRules) => (a: BurstCandidate, b: BurstCandidate) => {
  if (rules.preferRaw && a.isRaw !== b.isRaw) {
    return a.isRaw ? -1 : 1;
  }
  if (rules.preferEdited && a.isEdited !== b.isEdited) {
    return a.isEdited ? -1 : 1;
  }
  if (rules.preferLargest && sizeOrder(a, b) !== 0) {
    return sizeOrder(a, b);
  }
  return b.score.overall - a.score.overall || sizeOrder(a, b) || a.id.localeCompare(b.id);
};

const beats = (value: number, others: number[]) => others.length > 0 && others.every((other) => value > other);

/**
 * Ranks the photos of a group and says why the first one is kept: the rules that picked it (`raw`, `edited`,
 * `largest`) and what it does better than every other photo of the group (`sharpest`, `bestExposed`, `mostFaces`,
 * `largestFaces`, `favorite`, `highestRated`); `bestOverall` when it only wins on the overall score.
 */
export const rankBurst = (candidates: BurstCandidate[], rules: BurstRules): BurstRanking => {
  const ordered = candidates.toSorted(compareBurstCandidates(rules));
  const [keeper, ...others] = ordered;
  if (!keeper) {
    throw new Error('A group needs at least one photo');
  }

  const reasons: BurstKeepReason[] = [];
  const largest = others.length > 0 && others.every((other) => sizeOrder(keeper, other) < 0);
  if (rules.preferRaw && keeper.isRaw && others.some(({ isRaw }) => !isRaw)) {
    reasons.push(BurstKeepReason.Raw);
  }
  if (rules.preferEdited && keeper.isEdited && others.some(({ isEdited }) => !isEdited)) {
    reasons.push(BurstKeepReason.Edited);
  }
  if (rules.preferLargest && largest) {
    reasons.push(BurstKeepReason.Largest);
  }

  const best = (pick: (candidate: BurstCandidate) => number) =>
    beats(
      pick(keeper),
      others.map((other) => pick(other)),
    );
  if (best(({ score }) => score.sharpness)) {
    reasons.push(BurstKeepReason.Sharpest);
  }
  if (best(({ score }) => score.exposure)) {
    reasons.push(BurstKeepReason.BestExposed);
  }
  if (best(({ score }) => score.faces)) {
    reasons.push(BurstKeepReason.MostFaces);
  } else if (keeper.score.faces > 0 && best(({ score }) => score.faceScore)) {
    reasons.push(BurstKeepReason.LargestFaces);
  }
  if (keeper.isFavorite && others.some(({ isFavorite }) => !isFavorite)) {
    reasons.push(BurstKeepReason.Favorite);
  }
  if (best(({ rating }) => rating ?? 0)) {
    reasons.push(BurstKeepReason.HighestRated);
  }

  if (reasons.length === 0) {
    if (beats(keeper.score.overall, [others[0]?.score.overall ?? keeper.score.overall])) {
      reasons.push(BurstKeepReason.BestOverall);
    } else if (largest) {
      reasons.push(BurstKeepReason.Largest);
    }
  }

  return { order: ordered.map(({ id }) => id), keepId: keeper.id, reasons };
};

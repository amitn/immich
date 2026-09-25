export type ClusterItem = {
  id: string;
  /** capture time in ms */
  time: number;
  /** L2-normalized embedding, see `parseEmbedding` */
  embedding?: Float32Array | null;
};

export type ClusterOptions = {
  /** cosine distance at or below which two photos are near-duplicates regardless of time */
  maxDistance: number;
  /** looser cosine distance used for photos taken within `maxSeconds` of each other (bursts) */
  burstDistance: number;
  maxSeconds: number;
};

export type Cluster = {
  ids: string[];
  /** seconds between the first and the last photo */
  span: number;
};

/** default thresholds derived from the duplicate detection `maxDistance` */
export const getClusterDefaults = (duplicateMaxDistance: number): ClusterOptions => {
  const maxDistance = Math.min(duplicateMaxDistance * 2, 0.05);
  return { maxDistance, burstDistance: Math.max(maxDistance, 0.1), maxSeconds: 5 };
};

/** parses the pgvector text format (`[0.1,0.2,...]`) into an L2-normalized vector */
export const parseEmbedding = (text: string): Float32Array => {
  const trimmed = text.trim();
  const body = trimmed.startsWith('[') ? trimmed.slice(1, -1) : trimmed;
  const parts = body.length > 0 ? body.split(',') : [];
  const vector = new Float32Array(parts.length);
  let norm = 0;
  for (let i = 0; i < parts.length; i++) {
    const value = Number(parts[i]);
    vector[i] = Number.isFinite(value) ? value : 0;
    norm += vector[i] * vector[i];
  }

  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }
  return vector;
};

/** cosine distance of two L2-normalized vectors */
export const cosineDistance = (a: Float32Array, b: Float32Array) => {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
};

export class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    while (this.parent[i] !== root) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return;
    }
    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA]++;
    }
  }
}

/**
 * Groups near-duplicates and bursts. Photos are joined when their distance is at most `maxDistance`,
 * or at most `burstDistance` when taken within `maxSeconds`. Returns every group ordered by time,
 * including single-photo groups; photos without an embedding are always alone.
 */
export const clusterSimilar = (items: ClusterItem[], options: ClusterOptions): Cluster[] => {
  const sorted = items.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const unionFind = new UnionFind(sorted.length);
  const maxMs = options.maxSeconds * 1000;
  const threshold = Math.max(options.maxDistance, options.burstDistance);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i].embedding;
    if (!a) {
      continue;
    }
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j].embedding;
      if (!b) {
        continue;
      }
      const isBurst = sorted[j].time - sorted[i].time <= maxMs;
      const limit = isBurst ? threshold : options.maxDistance;
      if (unionFind.find(i) !== unionFind.find(j) && cosineDistance(a, b) <= limit) {
        unionFind.union(i, j);
      }
    }
  }

  const groups = new Map<number, ClusterItem[]>();
  for (const [i, item] of sorted.entries()) {
    const root = unionFind.find(i);
    const group = groups.get(root);
    if (group) {
      group.push(item);
    } else {
      groups.set(root, [item]);
    }
  }

  return groups
    .values()
    .map((group) => ({
      ids: group.map(({ id }) => id),
      span: Math.round((group.at(-1)!.time - group[0].time) / 1000),
    }))
    .toArray();
};

/** maps every id to the index of its group in `clusters` */
export const toClusterIndex = (clusters: Cluster[]) => {
  const index = new Map<string, number>();
  for (const [i, cluster] of clusters.entries()) {
    for (const id of cluster.ids) {
      index.set(id, i);
    }
  }
  return index;
};

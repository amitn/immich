import { describe, expect, it } from 'vitest';
import {
  ClusterItem,
  UnionFind,
  clusterSimilar,
  cosineDistance,
  getClusterDefaults,
  parseEmbedding,
  toClusterIndex,
} from 'src/utils/agent/clustering.js';

/** a unit vector at `degrees` in the first two dimensions; cosine distance is 1 - cos(angle) */
const vector = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return parseEmbedding(`[${Math.cos(radians)},${Math.sin(radians)},0]`);
};

const item = (id: string, seconds: number, degrees: number | null): ClusterItem => ({
  id,
  time: seconds * 1000,
  embedding: degrees === null ? null : vector(degrees),
});

// 1 - cos(8°) ≈ 0.0097, 1 - cos(20°) ≈ 0.060, 1 - cos(40°) ≈ 0.23
const options = { maxDistance: 0.02, burstDistance: 0.1, maxSeconds: 5 };

describe('parseEmbedding', () => {
  it('should parse and normalize the pgvector format', () => {
    const result = parseEmbedding('[3,4]');
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.8);
  });

  it('should accept values without brackets and scientific notation', () => {
    const result = parseEmbedding('1e-3, 0');
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBe(0);
  });

  it('should handle an empty vector', () => {
    expect(parseEmbedding('[]')).toHaveLength(0);
  });

  it('should not divide by zero', () => {
    expect([...parseEmbedding('[0,0]')]).toEqual([0, 0]);
  });
});

describe('cosineDistance', () => {
  it('should be 0 for identical vectors', () => {
    expect(cosineDistance(vector(10), vector(10))).toBeCloseTo(0);
  });

  it('should be 1 for orthogonal vectors', () => {
    expect(cosineDistance(vector(0), vector(90))).toBeCloseTo(1);
  });

  it('should be 2 for opposite vectors', () => {
    expect(cosineDistance(vector(0), vector(180))).toBeCloseTo(2);
  });
});

describe('UnionFind', () => {
  it('should join sets transitively', () => {
    const unionFind = new UnionFind(5);
    unionFind.union(0, 1);
    unionFind.union(3, 4);
    unionFind.union(1, 4);
    expect(unionFind.find(0)).toBe(unionFind.find(3));
    expect(unionFind.find(2)).not.toBe(unionFind.find(0));
  });
});

describe('getClusterDefaults', () => {
  it('should loosen the duplicate threshold', () => {
    expect(getClusterDefaults(0.01)).toEqual({ maxDistance: 0.02, burstDistance: 0.1, maxSeconds: 5 });
  });

  it('should cap the threshold', () => {
    expect(getClusterDefaults(0.1).maxDistance).toBe(0.05);
  });
});

describe('clusterSimilar', () => {
  it('should return nothing for no items', () => {
    expect(clusterSimilar([], options)).toEqual([]);
  });

  it('should join near-duplicates regardless of time', () => {
    const clusters = clusterSimilar([item('a', 0, 0), item('b', 3600, 8), item('c', 7200, 90)], options);
    expect(clusters).toEqual([
      { ids: ['a', 'b'], span: 3600 },
      { ids: ['c'], span: 0 },
    ]);
  });

  it('should use the looser threshold for bursts', () => {
    const clusters = clusterSimilar([item('a', 0, 0), item('b', 2, 20), item('c', 60, 40)], options);
    expect(clusters.map(({ ids }) => ids)).toEqual([['a', 'b'], ['c']]);
  });

  it('should not join similar-ish photos far apart in time', () => {
    const clusters = clusterSimilar([item('a', 0, 0), item('b', 600, 20)], options);
    expect(clusters).toHaveLength(2);
  });

  it('should not join very different photos in a burst', () => {
    const clusters = clusterSimilar([item('a', 0, 0), item('b', 1, 40)], options);
    expect(clusters).toHaveLength(2);
  });

  it('should chain bursts transitively', () => {
    const clusters = clusterSimilar([item('a', 0, 0), item('b', 4, 15), item('c', 8, 30), item('d', 12, 45)], options);
    expect(clusters).toEqual([{ ids: ['a', 'b', 'c', 'd'], span: 12 }]);
  });

  it('should keep photos without embeddings alone', () => {
    const clusters = clusterSimilar([item('a', 0, 0), item('b', 1, null), item('c', 2, 0)], options);
    expect(clusters.map(({ ids }) => ids)).toEqual([['a', 'c'], ['b']]);
  });

  it('should order clusters and members by time', () => {
    const clusters = clusterSimilar([item('z', 100, 90), item('y', 50, 0), item('x', 51, 1)], options);
    expect(clusters.map(({ ids }) => ids)).toEqual([['y', 'x'], ['z']]);
  });
});

describe('toClusterIndex', () => {
  it('should map ids to cluster indexes', () => {
    const index = toClusterIndex([
      { ids: ['a', 'b'], span: 0 },
      { ids: ['c'], span: 0 },
    ]);
    expect(Object.fromEntries(index)).toEqual({ a: 0, b: 0, c: 1 });
  });
});

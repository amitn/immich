import { describe, expect, it } from 'vitest';
import { BurstGroupSource, BurstKeepReason } from 'src/enum.js';
import {
  BurstCandidate,
  BurstScanAsset,
  DEFAULT_BURST_RULES,
  clusterBursts,
  getBurstCandidates,
  getBurstDefaults,
  partitionBurstScan,
  rankBurst,
  toBurstDrafts,
  toBurstRules,
} from 'src/utils/agent/bursts.js';
import { parseEmbedding } from 'src/utils/agent/clustering.js';
import { PhotoScore } from 'src/utils/agent/scoring.js';

/** a unit vector at `degrees`; 1 - cos(10°) ≈ 0.015, 1 - cos(40°) ≈ 0.23 */
const vector = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return parseEmbedding(`[${Math.cos(radians)},${Math.sin(radians)},0]`);
};

const score = (overrides: Partial<PhotoScore> = {}): PhotoScore => ({
  sharpness: 0.5,
  exposure: 0.5,
  faces: 0,
  faceArea: 0,
  faceScore: 0,
  aesthetic: 0.5,
  overall: 0.5,
  ...overrides,
});

const candidate = (id: string, overrides: Partial<BurstCandidate> = {}): BurstCandidate => ({
  id,
  isRaw: false,
  isEdited: false,
  pixels: 12_000_000,
  fileSize: 3_000_000,
  isFavorite: false,
  rating: null,
  score: score(),
  ...overrides,
});

const asset = (id: string, overrides: Partial<BurstScanAsset> = {}): BurstScanAsset => ({
  id,
  ownerId: 'user',
  time: 0,
  isImage: true,
  duplicateId: null,
  stackId: null,
  isCopy: false,
  ...overrides,
});

const noRules = { preferRaw: false, preferEdited: false, preferLargest: false };

describe('toBurstRules', () => {
  it('should prefer edited photos by default', () => {
    expect(toBurstRules()).toEqual(DEFAULT_BURST_RULES);
    expect(DEFAULT_BURST_RULES).toEqual({ preferRaw: false, preferEdited: true, preferLargest: false });
  });

  it('should take the rules given', () => {
    expect(toBurstRules({ preferRaw: true, preferEdited: false })).toEqual({
      preferRaw: true,
      preferEdited: false,
      preferLargest: false,
    });
  });
});

describe('getBurstDefaults', () => {
  it('should use the burst distance of cluster_similar and a few seconds', () => {
    expect(getBurstDefaults(0.01)).toEqual({ maxSeconds: 3, maxDistance: 0.1 });
  });
});

describe('getBurstCandidates', () => {
  it('should keep the photos that have another one within seconds', () => {
    const items = [
      { id: 'a', time: 0 },
      { id: 'b', time: 2000 },
      { id: 'c', time: 60_000 },
      { id: 'd', time: 120_000 },
      { id: 'e', time: 121_000 },
    ];
    expect([...getBurstCandidates(items, 3)].toSorted()).toEqual(['a', 'b', 'd', 'e']);
  });
});

describe('clusterBursts', () => {
  const options = { maxSeconds: 3, maxDistance: 0.1 };

  it('should group similar photos taken within seconds, chained', () => {
    const groups = clusterBursts(
      [
        { id: 'a', time: 0, embedding: vector(0) },
        { id: 'b', time: 2000, embedding: vector(5) },
        { id: 'c', time: 4000, embedding: vector(10) },
        // the same scene, but a minute later: not a burst (the duplicate detection finds those)
        { id: 'd', time: 64_000, embedding: vector(10) },
      ],
      options,
    );
    expect(groups).toEqual([['a', 'b', 'c']]);
  });

  it('should keep different photos taken in the same second apart', () => {
    const groups = clusterBursts(
      [
        { id: 'a', time: 0, embedding: vector(0) },
        { id: 'b', time: 0, embedding: vector(60) },
      ],
      options,
    );
    expect(groups).toEqual([]);
  });

  it('should leave photos without an embedding out', () => {
    const groups = clusterBursts(
      [
        { id: 'a', time: 0, embedding: vector(0) },
        { id: 'b', time: 0, embedding: null },
        { id: 'c', time: 1000, embedding: vector(1) },
      ],
      options,
    );
    expect(groups).toEqual([['a', 'c']]);
  });
});

describe('partitionBurstScan', () => {
  it('should take the duplicate groups, then the stacks, and leave the rest to burst detection', () => {
    const { groups, rest } = partitionBurstScan([
      asset('d1', { duplicateId: 'dup', time: 5000 }),
      asset('d2', { duplicateId: 'dup', time: 1000 }),
      asset('s1', { stackId: 'stack' }),
      asset('s2', { stackId: 'stack' }),
      asset('alone', { duplicateId: 'other' }),
      asset('free'),
    ]);

    expect(groups).toEqual([
      {
        key: 'duplicate:dup',
        source: BurstGroupSource.Duplicate,
        duplicateId: 'dup',
        stackId: null,
        assetIds: ['d1', 'd2'],
        time: 5000,
      },
      {
        key: 'stack:stack',
        source: BurstGroupSource.Stack,
        duplicateId: null,
        stackId: 'stack',
        assetIds: ['s1', 's2'],
        time: 0,
      },
    ]);
    // the only photo of its duplicate group in the scope can still be in a burst
    expect(rest.map(({ id }) => id)).toEqual(['alone', 'free']);
  });

  it('should leave the stacks of copies alone, and their photos out of bursts', () => {
    const { groups, rest } = partitionBurstScan([
      asset('original', { stackId: 'stack' }),
      asset('crop', { stackId: 'stack', isCopy: true }),
      asset('video', { isImage: false }),
      asset('copy', { isCopy: true }),
    ]);
    expect(groups).toEqual([]);
    expect(rest).toEqual([]);
  });

  it('should make bursts from clusters', () => {
    const assets = new Map([
      ['a', asset('a', { time: 1000 })],
      ['b', asset('b', { time: 3000 })],
    ]);
    expect(toBurstDrafts([['a', 'b']], assets)).toEqual([
      {
        key: 'burst:a',
        source: BurstGroupSource.Burst,
        duplicateId: null,
        stackId: null,
        assetIds: ['a', 'b'],
        time: 3000,
      },
    ]);
  });
});

describe('rankBurst', () => {
  it('should keep the sharpest photo, and say why', () => {
    const ranking = rankBurst(
      [
        candidate('blurry', { score: score({ sharpness: 0.2, overall: 0.4 }) }),
        candidate('sharp', { score: score({ sharpness: 0.9, overall: 0.7 }) }),
        candidate('soft', { score: score({ sharpness: 0.5, overall: 0.5 }) }),
      ],
      noRules,
    );
    expect(ranking).toEqual({
      order: ['sharp', 'soft', 'blurry'],
      keepId: 'sharp',
      reasons: [BurstKeepReason.Sharpest],
    });
  });

  it('should tell every way the kept photo is better', () => {
    const ranking = rankBurst(
      [
        candidate('a', {
          isFavorite: true,
          rating: 4,
          score: score({ sharpness: 0.8, exposure: 0.9, faces: 3, faceScore: 0.8, overall: 0.9 }),
        }),
        candidate('b', { score: score({ sharpness: 0.6, exposure: 0.5, faces: 2, faceScore: 0.9, overall: 0.6 }) }),
      ],
      noRules,
    );
    expect(ranking.reasons).toEqual([
      BurstKeepReason.Sharpest,
      BurstKeepReason.BestExposed,
      BurstKeepReason.MostFaces,
      BurstKeepReason.Favorite,
      BurstKeepReason.HighestRated,
    ]);
  });

  it('should tell larger faces when the faces are as many', () => {
    const ranking = rankBurst(
      [
        candidate('a', { score: score({ faces: 2, faceScore: 0.9, overall: 0.6 }) }),
        candidate('b', { score: score({ faces: 2, faceScore: 0.6, overall: 0.55 }) }),
      ],
      noRules,
    );
    expect(ranking.reasons).toEqual([BurstKeepReason.LargestFaces]);
  });

  it('should keep the best overall photo when it is not the best at anything', () => {
    const ranking = rankBurst(
      [
        candidate('a', { score: score({ sharpness: 0.8, exposure: 0.6, overall: 0.62 }) }),
        candidate('b', { score: score({ sharpness: 0.7, exposure: 0.5, overall: 0.64 }) }),
        candidate('c', { score: score({ sharpness: 0.9, exposure: 0.4, overall: 0.6 }) }),
      ],
      noRules,
    );
    expect(ranking.keepId).toBe('b');
    expect(ranking.reasons).toEqual([BurstKeepReason.BestOverall]);
  });

  it('should break a tie on the size, then the id', () => {
    expect(rankBurst([candidate('a'), candidate('b', { pixels: 24_000_000 })], noRules)).toEqual({
      order: ['b', 'a'],
      keepId: 'b',
      reasons: [BurstKeepReason.Largest],
    });
    expect(rankBurst([candidate('b'), candidate('a')], noRules)).toEqual({
      order: ['a', 'b'],
      keepId: 'a',
      reasons: [],
    });
  });

  describe('rules', () => {
    const sharpJpeg = candidate('jpeg', { score: score({ sharpness: 0.9, overall: 0.8 }) });
    const raw = candidate('raw', { isRaw: true, score: score({ sharpness: 0.6, overall: 0.6 }) });
    const edited = candidate('edited', { isEdited: true, score: score({ sharpness: 0.5, overall: 0.55 }) });
    const large = candidate('large', { pixels: 48_000_000, score: score({ sharpness: 0.4, overall: 0.5 }) });

    it('should go by the quality score without rules', () => {
      expect(rankBurst([raw, sharpJpeg, edited, large], noRules).keepId).toBe('jpeg');
    });

    it('should keep the RAW photo first', () => {
      const ranking = rankBurst([sharpJpeg, raw, edited], { ...noRules, preferRaw: true });
      expect(ranking.keepId).toBe('raw');
      expect(ranking.reasons).toEqual([BurstKeepReason.Raw]);
    });

    it('should keep the edited photo', () => {
      const ranking = rankBurst([sharpJpeg, raw, edited], { ...noRules, preferEdited: true });
      expect(ranking.keepId).toBe('edited');
      expect(ranking.reasons).toEqual([BurstKeepReason.Edited]);
    });

    it('should keep the largest photo', () => {
      const ranking = rankBurst([sharpJpeg, large], { ...noRules, preferLargest: true });
      expect(ranking.keepId).toBe('large');
      expect(ranking.reasons).toEqual([BurstKeepReason.Largest]);
    });

    it('should apply the rules in order: RAW, edited, largest', () => {
      const editedRaw = candidate('editedRaw', { isRaw: true, isEdited: true, score: score({ overall: 0.3 }) });
      const rules = { preferRaw: true, preferEdited: true, preferLargest: true };
      expect(rankBurst([large, edited, raw, editedRaw], rules).order).toEqual(['editedRaw', 'raw', 'edited', 'large']);
    });

    it('should rank by quality among photos the rules can not tell apart', () => {
      const sharpRaw = candidate('sharpRaw', { isRaw: true, score: score({ sharpness: 0.9, overall: 0.8 }) });
      const ranking = rankBurst([raw, sharpRaw, sharpJpeg], { ...noRules, preferRaw: true });
      expect(ranking.order).toEqual(['sharpRaw', 'raw', 'jpeg']);
      // it is RAW like another photo, so only the quality is a reason against that one
      expect(ranking.reasons).toEqual([BurstKeepReason.Raw]);
    });

    it('should not name a rule that did not decide', () => {
      const ranking = rankBurst([sharpJpeg, candidate('blurry', { score: score({ sharpness: 0.2, overall: 0.3 }) })], {
        preferRaw: true,
        preferEdited: true,
        preferLargest: true,
      });
      expect(ranking.keepId).toBe('jpeg');
      expect(ranking.reasons).toEqual([BurstKeepReason.Sharpest]);
    });
  });
});

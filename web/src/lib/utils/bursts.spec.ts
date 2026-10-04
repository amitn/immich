import { BurstGroupSource, BurstKeepReason, type BurstGroupResponseDto } from '@immich/sdk';
import {
  DEFAULT_BURST_RULES,
  getBurstArchiveIds,
  getBurstReasonKey,
  getBurstSourceKey,
  loadBurstRules,
  saveBurstRules,
} from '$lib/utils/bursts';

const photo = (assetId: string, isOwned = true) => ({
  assetId,
  isOwned,
  isRaw: false,
  isEdited: false,
  width: null,
  height: null,
  fileSize: null,
  sharpness: 0.5,
  exposure: 0.5,
  faces: 0,
  score: 0.5,
});

const group = (assets: ReturnType<typeof photo>[], readOnly = false): BurstGroupResponseDto => ({
  key: 'burst:a',
  source: BurstGroupSource.Burst,
  duplicateId: null,
  stackId: null,
  takenAt: '2026-06-01T10:00:00.000Z',
  assets,
  keepAssetId: assets[0].assetId,
  reasons: [],
  archiveAssetIds: [],
  readOnly,
});

describe('burst rules', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should prefer edited photos by default', () => {
    expect(loadBurstRules()).toEqual(DEFAULT_BURST_RULES);
  });

  it('should remember the rules', () => {
    saveBurstRules({ preferRaw: true, preferEdited: false, preferLargest: true });
    expect(loadBurstRules()).toEqual({ preferRaw: true, preferEdited: false, preferLargest: true });
  });

  it('should ignore what it can not read', () => {
    localStorage.setItem('burst-cleanup-rules', '{"preferRaw": "yes"');
    expect(loadBurstRules()).toEqual(DEFAULT_BURST_RULES);
    localStorage.setItem('burst-cleanup-rules', '{"preferRaw": "yes", "preferLargest": true}');
    expect(loadBurstRules()).toEqual({ ...DEFAULT_BURST_RULES, preferLargest: true });
  });

  it('should work without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadBurstRules()).toEqual(DEFAULT_BURST_RULES);
    expect(() => saveBurstRules(DEFAULT_BURST_RULES)).not.toThrow();
  });
});

describe('getBurstArchiveIds', () => {
  it('should archive the photos of the user but the one to keep', () => {
    const value = group([photo('a'), photo('b'), photo('c', false)]);
    expect(getBurstArchiveIds(value, 'a')).toEqual(['b']);
    expect(getBurstArchiveIds(value, 'b')).toEqual(['a']);
  });

  it('should archive nothing of a read-only group', () => {
    expect(getBurstArchiveIds(group([photo('a'), photo('b')], true), 'a')).toEqual([]);
  });
});

describe('labels', () => {
  it('should have a label for every reason and source', () => {
    for (const reason of Object.values(BurstKeepReason)) {
      expect(getBurstReasonKey(reason)).toMatch(/^burst_reason_/);
    }
    for (const source of Object.values(BurstGroupSource)) {
      expect(getBurstSourceKey(source)).toMatch(/^burst_source_/);
    }
  });
});

import { BurstGroupSource, BurstKeepReason, type BurstGroupResponseDto } from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

/** what burst cleanup keeps first, before the quality score (see `BurstRulesDto`) */
export type BurstRules = { preferRaw: boolean; preferEdited: boolean; preferLargest: boolean };

export const DEFAULT_BURST_RULES: BurstRules = { preferRaw: false, preferEdited: true, preferLargest: false };

const RULES_KEY = 'burst-cleanup-rules';

/** the rules the viewer chose last time, in this browser */
export const loadBurstRules = (): BurstRules => {
  try {
    const stored = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null') as Partial<BurstRules> | null;
    if (!stored || typeof stored !== 'object') {
      return { ...DEFAULT_BURST_RULES };
    }
    return {
      preferRaw: typeof stored.preferRaw === 'boolean' ? stored.preferRaw : DEFAULT_BURST_RULES.preferRaw,
      preferEdited: typeof stored.preferEdited === 'boolean' ? stored.preferEdited : DEFAULT_BURST_RULES.preferEdited,
      preferLargest:
        typeof stored.preferLargest === 'boolean' ? stored.preferLargest : DEFAULT_BURST_RULES.preferLargest,
    };
  } catch {
    return { ...DEFAULT_BURST_RULES };
  }
};

export const saveBurstRules = (rules: BurstRules) => {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // a remembered choice only
  }
};

/** the photos that keeping `keepAssetId` archives: the user's own others (none in a read-only group) */
export const getBurstArchiveIds = (group: BurstGroupResponseDto, keepAssetId: string) =>
  group.readOnly
    ? []
    : group.assets.filter(({ assetId, isOwned }) => isOwned && assetId !== keepAssetId).map(({ assetId }) => assetId);

const reasonKeys: Record<BurstKeepReason, Translations> = {
  [BurstKeepReason.Raw]: 'burst_reason_raw',
  [BurstKeepReason.Edited]: 'burst_reason_edited',
  [BurstKeepReason.Largest]: 'burst_reason_largest',
  [BurstKeepReason.Sharpest]: 'burst_reason_sharpest',
  [BurstKeepReason.BestExposed]: 'burst_reason_best_exposed',
  [BurstKeepReason.MostFaces]: 'burst_reason_most_faces',
  [BurstKeepReason.LargestFaces]: 'burst_reason_largest_faces',
  [BurstKeepReason.Favorite]: 'burst_reason_favorite',
  [BurstKeepReason.HighestRated]: 'burst_reason_highest_rated',
  [BurstKeepReason.BestOverall]: 'burst_reason_best_overall',
};

/** the i18n key of why a photo is kept, e.g. "Sharpest" */
export const getBurstReasonKey = (reason: BurstKeepReason) => reasonKeys[reason];

const sourceKeys: Record<BurstGroupSource, Translations> = {
  [BurstGroupSource.Duplicate]: 'burst_source_duplicate',
  [BurstGroupSource.Stack]: 'burst_source_stack',
  [BurstGroupSource.Burst]: 'burst_source_burst',
};

/** the i18n key of where a group comes from, e.g. "Duplicates" */
export const getBurstSourceKey = (source: BurstGroupSource) => sourceKeys[source];

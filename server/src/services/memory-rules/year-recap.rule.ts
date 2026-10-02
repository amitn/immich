import { DateTime } from 'luxon';
import { YearRecapRepository } from 'src/repositories/year-recap.repository.js';
import { medianTime, pickEvenlySpaced } from 'src/services/memory-rules/curation.util.js';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface.js';
import { YearRecapAsset, getYearRecapStats } from 'src/utils/year-recap.js';

export const YEAR_RECAP_RULE_ID = 'year_recap';
/** a year with fewer photos and videos than this is not recapped */
export const MIN_ASSETS = 30;
/** nor one photographed in fewer months */
export const MIN_MONTHS = 3;
export const ASSET_CAP = 30;
/** the first day of January the recap of the year before can be made on: the last photos of the year are uploaded */
export const FIRST_DAY = 2;
/** the last one, when the first days had no slot left */
export const LAST_DAY = 8;
/** the recap stays until this day of January, whichever day it was made on */
export const LAST_VISIBLE_DAY = 15;
const monthOf = (asset: YearRecapAsset) => new Date(asset.time).getUTCMonth();

/**
 * The photos the card shows: every month of the year gets its share (one at a time, round-robin, like
 * `sampleAssetsAcrossGroups`), filled with its favorites first and then its other photos, each spread over its days.
 * In time order.
 */
export const pickCardAssets = (assets: YearRecapAsset[], cap = ASSET_CAP): string[] => {
  const months = Map.groupBy(assets, monthOf)
    .entries()
    .toArray()
    .toSorted(([a], [b]) => a - b)
    .map(([, group]) => group.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id)));

  const quotas = months.map(() => 0);
  let remaining = Math.min(cap, assets.length);
  while (remaining > 0) {
    for (const [index, group] of months.entries()) {
      if (remaining > 0 && quotas[index] < group.length) {
        quotas[index]++;
        remaining--;
      }
    }
  }

  return months.flatMap((group, index) => {
    const favorites = group.filter((asset) => asset.isFavorite);
    const others = group.filter((asset) => !asset.isFavorite);
    const picked = [
      ...pickEvenlySpaced(favorites, Math.min(quotas[index], favorites.length)),
      ...pickEvenlySpaced(others, Math.max(0, quotas[index] - favorites.length)),
    ];
    return picked.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id)).map(({ id }) => id);
  });
};

/**
 * "2026 in review" (#12): early in January, the year that just ended, with its stats (photos, places, people, pets,
 * trips, and what the journals saw: dishes and restaurants, museums, concerts…). It stays two weeks, and offers a
 * highlight video and a book of the year. The photos the user keeps out of their memories are left out of the stats
 * too.
 */
export class YearRecapMemoryRule implements MemoryRule {
  readonly id = YEAR_RECAP_RULE_ID;

  constructor(private repository: Pick<YearRecapRepository, 'getAssets' | 'getPeople' | 'getJournalTags'>) {}

  async evaluate({ ownerId, target, exclusions }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.month !== 1 || target.day < FIRST_DAY || target.day > LAST_DAY) {
      return [];
    }

    const year = target.year - 1;
    const assets = await this.repository.getAssets(ownerId, year, exclusions);
    if (assets.length < MIN_ASSETS || new Set(assets.map((asset) => monthOf(asset))).size < MIN_MONTHS) {
      return [];
    }

    const [people, tags] = await Promise.all([
      this.repository.getPeople(ownerId, year, exclusions),
      this.repository.getJournalTags(ownerId, year, exclusions),
    ]);
    const stats = getYearRecapStats(year, assets, people, tags);

    return [
      {
        ruleId: this.id,
        dedupeKey: `${YEAR_RECAP_RULE_ID}:${year}`,
        // above the month and season recaps, below a birthday, which waits a year too
        score: 240 + Math.min(Math.round(assets.length / 50), 50),
        assetIds: pickCardAssets(assets),
        memoryAt: DateTime.fromJSDate(medianTime(assets.map((asset) => ({ localDateTime: new Date(asset.time) }))), {
          zone: 'utc',
        }),
        context: { ...stats },
        visibleForDays: LAST_VISIBLE_DAY - target.day + 1,
      },
    ];
  }
}

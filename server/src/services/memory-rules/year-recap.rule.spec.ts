import { DateTime } from 'luxon';
import { AssetType } from 'src/enum.js';
import {
  ASSET_CAP,
  FIRST_DAY,
  LAST_DAY,
  LAST_VISIBLE_DAY,
  MIN_ASSETS,
  YearRecapMemoryRule,
  pickCardAssets,
} from 'src/services/memory-rules/year-recap.rule.js';
import { NO_MEMORY_EXCLUSIONS } from 'src/utils/memory-exclusions.js';
import { YearRecapAsset } from 'src/utils/year-recap.js';

const target = DateTime.fromISO('2026-01-02', { zone: 'utc' });

/** `count` photos of 2025, spread over the given months (1-12), in Lisbon */
const photos = (count: number, months = [1, 4, 8, 12], extra: Partial<YearRecapAsset> = {}): YearRecapAsset[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `a-${String(index).padStart(3, '0')}`,
    type: AssetType.Image,
    isFavorite: false,
    time: Date.UTC(2025, months[index % months.length] - 1, 1 + (index % 20), 12),
    latitude: null,
    longitude: null,
    city: 'Lisbon',
    state: null,
    country: 'Portugal',
    ...extra,
  }));

const ruleWith = (assets: YearRecapAsset[], people: unknown[] = [], tags: unknown[] = []) => {
  const repository = {
    getAssets: vi.fn().mockResolvedValue(assets),
    getPeople: vi.fn().mockResolvedValue(people),
    getJournalTags: vi.fn().mockResolvedValue(tags),
  };
  return { rule: new YearRecapMemoryRule(repository as never), repository };
};

describe(YearRecapMemoryRule.name, () => {
  it.each(['2026-01-01', '2026-01-09', '2026-02-02', '2026-12-31'])('makes nothing on %s', async (day) => {
    const { rule, repository } = ruleWith(photos(100));

    await expect(rule.evaluate({ ownerId: 'user-1', target: DateTime.fromISO(day, { zone: 'utc' }) })).resolves.toEqual(
      [],
    );
    expect(repository.getAssets).not.toHaveBeenCalled();
  });

  it('recaps the year that just ended, with its stats, early in January', async () => {
    const { rule, repository } = ruleWith(
      photos(120),
      [
        { id: 'p1', name: 'Dana', type: 'person', count: 40 },
        { id: 'p2', name: 'Eli', type: 'person', count: 10 },
        { id: 'pet', name: 'Rex', type: 'pet', count: 5 },
      ],
      [
        { id: 'a-001', value: 'Food/Da Enzo/Cacio e pepe' },
        { id: 'a-002', value: 'Food/Da Enzo/Carbonara' },
        { id: 'a-003', value: 'Food/Noma/Menu' },
        { id: 'a-004', value: 'Art/Louvre/Mona Lisa' },
      ],
    );

    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target, exclusions: NO_MEMORY_EXCLUSIONS });

    expect(repository.getAssets).toHaveBeenCalledWith('user-1', 2025, NO_MEMORY_EXCLUSIONS);
    expect(candidate).toMatchObject({
      ruleId: 'year_recap',
      dedupeKey: 'year_recap:2025',
      visibleForDays: LAST_VISIBLE_DAY - FIRST_DAY + 1,
      context: {
        year: 2025,
        count: 120,
        photoCount: 120,
        places: 1,
        countries: 1,
        topPlaces: ['Lisbon'],
        people: 2,
        topPeople: [
          { id: 'p1', name: 'Dana' },
          { id: 'p2', name: 'Eli' },
        ],
        pets: 1,
        journals: {
          food: { places: 2, entries: 2 },
          museum: { places: 1, entries: 1 },
        },
      },
    });
    // no prose: the clients word the card
    expect(candidate.title).toBeUndefined();
    expect(candidate.assetIds).toHaveLength(ASSET_CAP);
    expect(candidate.score).toBeGreaterThan(200);
  });

  it('stays until the same day of January, whichever day it is made on', async () => {
    const { rule } = ruleWith(photos(60));

    const [candidate] = await rule.evaluate({
      ownerId: 'user-1',
      target: DateTime.fromISO(`2026-01-0${LAST_DAY}`, { zone: 'utc' }),
    });

    expect(candidate.visibleForDays).toBe(LAST_VISIBLE_DAY - LAST_DAY + 1);
  });

  it('reads the year without what the user keeps out of their memories', async () => {
    const exclusions = { ...NO_MEMORY_EXCLUSIONS, personIds: ['p1'], documents: true };
    const { rule, repository } = ruleWith(photos(60));

    await rule.evaluate({ ownerId: 'user-1', target, exclusions });

    expect(repository.getAssets).toHaveBeenCalledWith('user-1', 2025, exclusions);
    expect(repository.getPeople).toHaveBeenCalledWith('user-1', 2025, exclusions);
    expect(repository.getJournalTags).toHaveBeenCalledWith('user-1', 2025, exclusions);
  });

  it(`needs at least ${MIN_ASSETS} photos and videos`, async () => {
    const { rule, repository } = ruleWith(photos(MIN_ASSETS - 1));

    await expect(rule.evaluate({ ownerId: 'user-1', target })).resolves.toEqual([]);
    expect(repository.getPeople).not.toHaveBeenCalled();
  });

  it('needs photos from at least three months', async () => {
    const { rule } = ruleWith(photos(200, [6, 7]));

    await expect(rule.evaluate({ ownerId: 'user-1', target })).resolves.toEqual([]);
  });

  describe('pickCardAssets', () => {
    it('shows every month, its favorites first, in time order', () => {
      const assets = [
        ...photos(40, [3]),
        ...photos(2, [3], { isFavorite: true }).map((asset, index) => ({ ...asset, id: `fav-${index}` })),
        ...photos(40, [9]).map((asset) => ({ ...asset, id: `sep-${asset.id}` })),
      ];

      const picked = pickCardAssets(assets, 6);

      expect(picked).toHaveLength(6);
      expect(picked).toEqual(expect.arrayContaining(['fav-0', 'fav-1']));
      expect(picked.filter((id) => id.startsWith('sep-'))).toHaveLength(3);
      const times = picked.map((id) => assets.find((asset) => asset.id === id)!.time);
      expect(times).toEqual(times.toSorted((a, b) => a - b));
    });

    it('gives a small month all its photos and the others the rest', () => {
      const assets = [...photos(1, [2]), ...photos(30, [5]).map((asset) => ({ ...asset, id: `may-${asset.id}` }))];

      const picked = pickCardAssets(assets, 10);

      expect(picked).toHaveLength(10);
      expect(picked.filter((id) => id.startsWith('may-'))).toHaveLength(9);
    });
  });
});

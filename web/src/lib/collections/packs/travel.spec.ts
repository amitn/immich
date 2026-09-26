import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries } from '@immich/sdk';
import en from '$i18n/en.json';
import travelPack from '$lib/collections/packs/travel';
import { collectionPacks, getCollectionPack } from '$lib/collections/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('the travel pack', () => {
  it('should be found by the registry after food', () => {
    expect(getCollectionPack('travel')).toBe(travelPack);
    expect(collectionPacks.indexOf(travelPack)).toBeGreaterThan(0);
    expect(travelPack.hasPlaceLookup()).toBe(false);
    expect(en.collections.travel.book_style_name).toBe('Travel');
    expect(en.collections.travel.name_action).toBe('Name the legs of a trip…');
  });

  it('should call the collection endpoints with its pack', async () => {
    const target = { albumId: 'album' };
    vi.mocked(findCollectionVisits).mockResolvedValue({
      pack: 'travel',
      count: 0,
      photos: 0,
      truncated: false,
      visits: [],
      warnings: [],
    });
    vi.mocked(matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(saveCollectionEntries).mockResolvedValue({ place: 'Crete, October 2016', results: [] });

    await travelPack.api.findVisits(target);
    await travelPack.api.matchVisit({ subjectIds: ['a'], sourceIds: ['b'] });
    await travelPack.api.saveEntries({ place: 'Crete, October 2016', photos: [{ id: 'b', source: true }] });

    expect(findCollectionVisits).toHaveBeenCalledWith({ pack: 'travel', collectionVisitsDto: target });
    expect(matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'travel',
      collectionMatchDto: { subjectIds: ['a'], sourceIds: ['b'] },
    });
    expect(saveCollectionEntries).toHaveBeenCalledWith({
      pack: 'travel',
      collectionEntriesDto: { place: 'Crete, October 2016', photos: [{ id: 'b', source: true }] },
    });
  });
});

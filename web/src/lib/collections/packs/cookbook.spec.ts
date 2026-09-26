import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries } from '@immich/sdk';
import { cookbookPack } from '$lib/collections/packs/cookbook';
import { collectionPacks } from '$lib/collections/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('cookbook pack', () => {
  it('should be listed after food, with the cookbook book style', () => {
    expect(collectionPacks.map(({ id }) => id).indexOf('cookbook')).toBeGreaterThan(0);
    expect(cookbookPack).toMatchObject({ tagRoot: 'Recipes', bookStylePreset: 'cookbook' });
    expect(cookbookPack.hasPlaceLookup()).toBe(false);
  });

  it('should call the generic collection endpoints with its pack', async () => {
    vi.mocked(findCollectionVisits).mockResolvedValue({
      pack: 'cookbook',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(saveCollectionEntries).mockResolvedValue({ place: 'Quiche', results: [] });

    await cookbookPack.api.findVisits({ albumId: 'album' });
    await cookbookPack.api.matchVisit({ subjectIds: ['a'], sourceIds: ['r'] });
    await cookbookPack.api.saveEntries({ place: 'Quiche', photos: [{ id: 'r', source: true }] });

    expect(findCollectionVisits).toHaveBeenCalledWith({ pack: 'cookbook', collectionVisitsDto: { albumId: 'album' } });
    expect(matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'cookbook',
      collectionMatchDto: { subjectIds: ['a'], sourceIds: ['r'] },
    });
    expect(saveCollectionEntries).toHaveBeenCalledWith({
      pack: 'cookbook',
      collectionEntriesDto: { place: 'Quiche', photos: [{ id: 'r', source: true }] },
    });
  });
});

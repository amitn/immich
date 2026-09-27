import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries } from '@immich/sdk';
import { getCollectionLabel } from '$lib/collections/pack';
import { winePack } from '$lib/collections/packs/wine';
import { collectionPacks } from '$lib/collections/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('wine pack', () => {
  it('should be listed after food, with the Cellar notes book style', () => {
    const ids = collectionPacks.map(({ id }) => id);
    expect(ids.indexOf('wine')).toBeGreaterThan(ids.indexOf('food'));
    expect(winePack).toMatchObject({ tagRoot: 'Wine', bookStylePreset: 'wine', order: 20 });
    expect(getCollectionLabel(winePack, 'name_action')).toBe('collections.wine.name_action');
  });

  it('should call the generic collection endpoints with its pack', async () => {
    vi.mocked(findCollectionVisits).mockResolvedValue({
      pack: 'wine',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(saveCollectionEntries).mockResolvedValue({ place: 'Noma Australia', results: [] });

    await winePack.api.findVisits({ albumId: 'album' });
    await winePack.api.matchVisit({ subjectIds: ['bottle'], sourceIds: [] });
    await winePack.api.saveEntries({ place: 'Noma Australia', photos: [{ id: 'bottle', entry: 'Snakebite' }] });

    expect(findCollectionVisits).toHaveBeenCalledWith({ pack: 'wine', collectionVisitsDto: { albumId: 'album' } });
    expect(matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'wine',
      collectionMatchDto: { subjectIds: ['bottle'], sourceIds: [] },
    });
    expect(saveCollectionEntries).toHaveBeenCalledWith({
      pack: 'wine',
      collectionEntriesDto: { place: 'Noma Australia', photos: [{ id: 'bottle', entry: 'Snakebite' }] },
    });
  });
});

import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries } from '@immich/sdk';
import { getCollectionLabel } from '$lib/collections/pack';
import { kidsArtPack } from '$lib/collections/packs/kids-art';
import { collectionPacks } from '$lib/collections/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe("kids' art pack", () => {
  it('should be listed after food, with the Refrigerator gallery book style, and never look a place up', () => {
    const ids = collectionPacks.map(({ id }) => id);
    expect(ids.indexOf('kids-art')).toBeGreaterThan(ids.indexOf('food'));
    expect(kidsArtPack).toMatchObject({ tagRoot: 'Kids art', bookStylePreset: 'kids-art', sourceOnSubjects: true });
    expect(kidsArtPack.hasPlaceLookup()).toBe(false);
    expect(getCollectionLabel(kidsArtPack, 'name_action')).toBe('collections.kids-art.name_action');
  });

  it('should call the generic collection endpoints with its pack', async () => {
    vi.mocked(findCollectionVisits).mockResolvedValue({
      pack: 'kids-art',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(saveCollectionEntries).mockResolvedValue({ place: 'Lina, 2025', results: [] });

    await kidsArtPack.api.findVisits({ albumId: 'album' });
    await kidsArtPack.api.matchVisit({ subjectIds: ['drawing'], sourceIds: [] });
    await kidsArtPack.api.saveEntries({ place: 'Lina, 2025', photos: [{ id: 'drawing', entry: 'Two foxes (age 8)' }] });

    expect(findCollectionVisits).toHaveBeenCalledWith({ pack: 'kids-art', collectionVisitsDto: { albumId: 'album' } });
    expect(matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'kids-art',
      collectionMatchDto: { subjectIds: ['drawing'], sourceIds: [] },
    });
    expect(saveCollectionEntries).toHaveBeenCalledWith({
      pack: 'kids-art',
      collectionEntriesDto: { place: 'Lina, 2025', photos: [{ id: 'drawing', entry: 'Two foxes (age 8)' }] },
    });
  });
});

import * as sdk from '@immich/sdk';
import en from '$i18n/en.json';
import { museumPack } from '$lib/collections/packs/museum';
import { collectionPacks, getCollectionPack } from '$lib/collections/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('museum pack', () => {
  it('should be listed after food, with the Gallery book style', () => {
    expect(getCollectionPack('museum')).toBe(museumPack);
    expect(collectionPacks.map(({ id }) => id).indexOf('museum')).toBeGreaterThan(0);
    expect(museumPack).toMatchObject({ tagRoot: 'Art', bookStylePreset: 'museum', order: 10 });
    expect(en.collections.museum.book_style_name).toBe('Gallery');
    expect(en.collections.museum.name_action).toBe('Name the artworks…');
  });

  it('should call the generic collection endpoints with the museum pack', async () => {
    vi.mocked(sdk.findCollectionVisits).mockResolvedValue({
      pack: 'museum',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(sdk.matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(sdk.saveCollectionEntries).mockResolvedValue({ place: 'Museu de Évora', results: [] });

    await museumPack.api.findVisits({ albumId: 'album' });
    expect(sdk.findCollectionVisits).toHaveBeenCalledWith({
      pack: 'museum',
      collectionVisitsDto: { albumId: 'album' },
    });

    await museumPack.api.matchVisit({ subjectIds: ['a'], sourceIds: ['l'] });
    expect(sdk.matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'museum',
      collectionMatchDto: { subjectIds: ['a'], sourceIds: ['l'] },
    });

    const dto = { place: 'Museu de Évora', photos: [{ id: 'a', entry: 'Calvary — Gregório Lopes, 1544' }] };
    await expect(museumPack.api.saveEntries(dto)).resolves.toEqual({ place: 'Museu de Évora', results: [] });
    expect(sdk.saveCollectionEntries).toHaveBeenCalledWith({ pack: 'museum', collectionEntriesDto: dto });
  });
});

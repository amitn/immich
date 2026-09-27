import * as sdk from '@immich/sdk';
import en from '$i18n/en.json';
import { naturePack } from '$lib/collections/packs/nature';
import { collectionPacks, getCollectionPack } from '$lib/collections/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('nature pack', () => {
  it('should be listed after food, with the Field guide book style', () => {
    expect(getCollectionPack('nature')).toBe(naturePack);
    expect(collectionPacks.map(({ id }) => id).indexOf('nature')).toBeGreaterThan(0);
    expect(naturePack).toMatchObject({ tagRoot: 'Nature', bookStylePreset: 'nature', order: 60 });
    expect(en.collections.nature.book_style_name).toBe('Field guide');
    expect(en.collections.nature.name_action).toBe('Name the plants and animals…');
  });

  it('should call the generic collection endpoints with the nature pack', async () => {
    vi.mocked(sdk.findCollectionVisits).mockResolvedValue({
      pack: 'nature',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(sdk.matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(sdk.saveCollectionEntries).mockResolvedValue({ place: 'Kahanu Garden', results: [] });

    await naturePack.api.findVisits({ albumId: 'album' });
    expect(sdk.findCollectionVisits).toHaveBeenCalledWith({
      pack: 'nature',
      collectionVisitsDto: { albumId: 'album' },
    });

    await naturePack.api.matchVisit({ subjectIds: ['a'], sourceIds: ['l'] });
    expect(sdk.matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'nature',
      collectionMatchDto: { subjectIds: ['a'], sourceIds: ['l'] },
    });

    const dto = { place: 'Kahanu Garden', photos: [{ id: 'a', entry: "Rose 'Proper Job' (Rosa)" }] };
    await expect(naturePack.api.saveEntries(dto)).resolves.toEqual({ place: 'Kahanu Garden', results: [] });
    expect(sdk.saveCollectionEntries).toHaveBeenCalledWith({ pack: 'nature', collectionEntriesDto: dto });
  });
});

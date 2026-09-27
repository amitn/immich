import * as sdk from '@immich/sdk';
import en from '$i18n/en.json';
import { concertsPack } from '$lib/collections/packs/concerts';
import { collectionPacks, getCollectionPack } from '$lib/collections/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('concerts pack', () => {
  it('should be listed after food, with the Gig poster book style', () => {
    expect(getCollectionPack('concerts')).toBe(concertsPack);
    expect(collectionPacks.map(({ id }) => id).indexOf('concerts')).toBeGreaterThan(0);
    expect(concertsPack).toMatchObject({ tagRoot: 'Concerts', bookStylePreset: 'concerts', order: 50 });
    expect(en.collections.concerts.book_style_name).toBe('Gig poster');
    expect(en.collections.concerts.name_action).toBe('Name the acts…');
  });

  it('should call the generic collection endpoints with the concerts pack', async () => {
    vi.mocked(sdk.findCollectionVisits).mockResolvedValue({
      pack: 'concerts',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(sdk.matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(sdk.saveCollectionEntries).mockResolvedValue({ place: 'Neumos, 17 Feb 2023', results: [] });

    await concertsPack.api.findVisits({ albumId: 'album' });
    expect(sdk.findCollectionVisits).toHaveBeenCalledWith({
      pack: 'concerts',
      collectionVisitsDto: { albumId: 'album' },
    });

    await concertsPack.api.matchVisit({ subjectIds: ['a'], sourceIds: ['l'] });
    expect(sdk.matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'concerts',
      collectionMatchDto: { subjectIds: ['a'], sourceIds: ['l'] },
    });

    const dto = { place: 'Neumos, 17 Feb 2023', photos: [{ id: 'a', entry: 'The Beths' }] };
    await expect(concertsPack.api.saveEntries(dto)).resolves.toEqual({ place: 'Neumos, 17 Feb 2023', results: [] });
    expect(sdk.saveCollectionEntries).toHaveBeenCalledWith({ pack: 'concerts', collectionEntriesDto: dto });
  });
});

import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries } from '@immich/sdk';
import { getCollectionLabel } from '$lib/journals/pack';
import { gardenPack } from '$lib/journals/packs/garden';
import { collectionPacks } from '$lib/journals/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('garden pack', () => {
  it('should be listed after food, with the Garden journal book style', () => {
    const ids = collectionPacks.map(({ id }) => id);
    expect(ids.indexOf('garden')).toBeGreaterThan(ids.indexOf('food'));
    expect(gardenPack).toMatchObject({ tagRoot: 'Garden', bookStylePreset: 'garden' });
    expect(gardenPack.sourceOnSubjects).toBeUndefined();
    expect(getCollectionLabel(gardenPack, 'name_action')).toBe('journals.garden.name_action');
  });

  it('should call the generic collection endpoints with its pack', async () => {
    vi.mocked(findCollectionVisits).mockResolvedValue({
      pack: 'garden',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(saveCollectionEntries).mockResolvedValue({ place: 'Hawea Pl garden', results: [] });

    await gardenPack.api.findVisits({ albumId: 'album' });
    await gardenPack.api.matchVisit({ subjectIds: ['tree'], sourceIds: ['tag'] });
    await gardenPack.api.saveEntries({
      place: 'Hawea Pl garden',
      photos: [
        { id: 'tag', source: true },
        { id: 'tree', entry: "Peach 'Tropic Prince'" },
      ],
    });

    expect(findCollectionVisits).toHaveBeenCalledWith({ pack: 'garden', collectionVisitsDto: { albumId: 'album' } });
    expect(matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'garden',
      collectionMatchDto: { subjectIds: ['tree'], sourceIds: ['tag'] },
    });
    expect(saveCollectionEntries).toHaveBeenCalledWith({
      pack: 'garden',
      collectionEntriesDto: {
        place: 'Hawea Pl garden',
        photos: [
          { id: 'tag', source: true },
          { id: 'tree', entry: "Peach 'Tropic Prince'" },
        ],
      },
    });
  });
});

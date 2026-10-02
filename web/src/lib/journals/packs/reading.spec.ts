import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries } from '@immich/sdk';
import { getCollectionLabel } from '$lib/journals/pack';
import { readingPack } from '$lib/journals/packs/reading';
import { collectionPacks } from '$lib/journals/registry';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  findCollectionVisits: vi.fn(),
  matchCollectionVisit: vi.fn(),
  saveCollectionEntries: vi.fn(),
}));

describe('reading pack', () => {
  it('should be listed after food, with the Reading journal book style and labels on the subjects', () => {
    const ids = collectionPacks.map(({ id }) => id);
    expect(ids.indexOf('reading')).toBeGreaterThan(ids.indexOf('food'));
    expect(readingPack).toMatchObject({ tagRoot: 'Reading', bookStylePreset: 'reading', sourceOnSubjects: true });
    expect(readingPack.hasPlaceLookup()).toBe(false);
    expect(getCollectionLabel(readingPack, 'name_action')).toBe('journals.reading.name_action');
  });

  it('should call the generic collection endpoints with its pack', async () => {
    vi.mocked(findCollectionVisits).mockResolvedValue({
      pack: 'reading',
      count: 0,
      truncated: false,
      photos: 0,
      visits: [],
      warnings: [],
    });
    vi.mocked(matchCollectionVisit).mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });
    vi.mocked(saveCollectionEntries).mockResolvedValue({ place: 'Reading 2022', results: [] });

    await readingPack.api.findVisits({ albumId: 'album' });
    await readingPack.api.matchVisit({ subjectIds: ['cover'], sourceIds: [] });
    await readingPack.api.saveEntries({
      place: 'Reading 2022',
      photos: [{ id: 'cover', entry: 'Wanderungen in den Dolomiten — Paul Grohmann' }],
    });

    expect(findCollectionVisits).toHaveBeenCalledWith({ pack: 'reading', collectionVisitsDto: { albumId: 'album' } });
    expect(matchCollectionVisit).toHaveBeenCalledWith({
      pack: 'reading',
      collectionMatchDto: { subjectIds: ['cover'], sourceIds: [] },
    });
    expect(saveCollectionEntries).toHaveBeenCalledWith({
      pack: 'reading',
      collectionEntriesDto: {
        place: 'Reading 2022',
        photos: [{ id: 'cover', entry: 'Wanderungen in den Dolomiten — Paul Grohmann' }],
      },
    });
  });
});

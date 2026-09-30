import { getAllTags, searchCollections, type CollectionSearchVisitDto, type TagResponseDto } from '@immich/sdk';
import { goto } from '$app/navigation';
import { getTypedSearchDisplayText } from '$lib/utils/typed-search/typed-search-name-cache';
import {
  ASK_ASSISTANT_ID,
  formatJournalVisit,
  getJournalVisitId,
  runJournalsProvider,
  type JournalItem,
} from './global-search-journals';
import { GlobalSearchManager, RECONCILE_ORDER_BY_SCOPE } from './global-search-manager.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { mockPage, flags } = vi.hoisted(() => ({
  mockPage: {
    route: { id: '/(user)/photos/[[assetId=id]]' as string | null },
    params: {} as Record<string, string>,
    url: new URL('https://gallery.test/spaces/space-1'),
  },
  flags: { valueOrUndefined: { assistant: true, search: true } as Record<string, boolean> | undefined },
}));

vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { authenticated: true, user: { id: 'me', isAdmin: false }, preferences: {} },
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({ featureFlagsManager: flags }));

vi.mock('$lib/utils/typed-search/typed-search-name-cache', () => ({
  getTypedSearchDisplayText: vi.fn(),
  storeTypedSearchNames: vi.fn(),
  consumeTypedSearchNamesInto: vi.fn(),
}));

vi.mock('@immich/sdk', async (original) => ({
  ...(await original<typeof import('@immich/sdk')>()),
  searchCollections: vi.fn(),
  getAllTags: vi.fn(),
  searchSmart: vi.fn(),
  searchAssets: vi.fn(),
  searchPerson: vi.fn(),
  searchPlaces: vi.fn(),
  getMlHealth: vi.fn(),
  getAlbumNames: vi.fn(),
  getAllSpaces: vi.fn(),
  getAllPeople: vi.fn(),
}));

const visit = (overrides: Partial<CollectionSearchVisitDto> = {}): CollectionSearchVisitDto => ({
  pack: 'food',
  tag: 'Food/Noma Australia',
  place: 'Noma Australia',
  date: '2016-03-23',
  city: 'Sydney',
  entries: [{ name: 'Wattleseed' } as never],
  photoIds: ['p1', 'p2'],
  ...overrides,
});

const response = (visits: CollectionSearchVisitDto[], total = visits.length) =>
  ({ terms: {}, total, visits }) as Awaited<ReturnType<typeof searchCollections>>;

const signal = new AbortController().signal;

describe(runJournalsProvider.name, () => {
  beforeEach(() => {
    vi.mocked(searchCollections).mockReset();
    flags.valueOrUndefined = { assistant: true };
  });

  it('should list the matching visits, then a row that asks the assistant', async () => {
    vi.mocked(searchCollections).mockResolvedValue(response([visit()], 7));

    const result = await runJournalsProvider(' what did we eat at noma ', signal);

    expect(searchCollections).toHaveBeenCalledWith({ q: 'what did we eat at noma' }, { signal });
    expect(result).toEqual({
      status: 'ok',
      total: 8,
      items: [
        { id: 'Food/Noma Australia|2016-03-23', kind: 'visit', visit: visit() },
        { id: ASK_ASSISTANT_ID, kind: 'ask', question: 'what did we eat at noma' },
      ],
    });
  });

  it('should list at most four visits', async () => {
    vi.mocked(searchCollections).mockResolvedValue(
      response(Array.from({ length: 6 }, (_, i) => visit({ date: `2016-03-2${i}` }))),
    );
    const result = await runJournalsProvider('noma', signal);
    expect(result.status === 'ok' && result.items.filter(({ kind }) => kind === 'visit')).toHaveLength(4);
  });

  it('should not offer to ask the assistant when it is not configured', async () => {
    flags.valueOrUndefined = { assistant: false };
    vi.mocked(searchCollections).mockResolvedValue(response([]));
    expect(await runJournalsProvider('noma', signal)).toEqual({ status: 'empty' });
  });

  it('should still offer the assistant when the collections cannot be searched', async () => {
    vi.mocked(searchCollections).mockRejectedValue(new Error('boom'));
    const result = await runJournalsProvider('noma', signal);
    expect(result).toEqual({
      status: 'ok',
      total: 1,
      items: [{ id: ASK_ASSISTANT_ID, kind: 'ask', question: 'noma' }],
    });

    flags.valueOrUndefined = { assistant: false };
    expect(await runJournalsProvider('noma', signal)).toEqual({ status: 'empty' });
  });

  it('should let an abort through, as the other providers do', async () => {
    vi.mocked(searchCollections).mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(runJournalsProvider('noma', signal)).rejects.toThrow('aborted');
  });

  it('should format a visit', () => {
    expect(formatJournalVisit(visit())).toBe('2016-03-23 · Sydney');
    expect(formatJournalVisit(visit({ endDate: '2016-03-25', city: undefined, country: 'Australia' }))).toBe(
      '2016-03-23 – 2016-03-25 · Australia',
    );
    expect(getJournalVisitId(visit())).toBe('Food/Noma Australia|2016-03-23');
  });
});

describe('the journals section of the palette', () => {
  const visitItem: JournalItem = { id: getJournalVisitId(visit()), kind: 'visit', visit: visit() };

  beforeEach(() => {
    vi.mocked(goto).mockReset();
    vi.mocked(getAllTags).mockReset();
    vi.mocked(searchCollections).mockReset();
    vi.mocked(getTypedSearchDisplayText).mockReturnValue(undefined);
    flags.valueOrUndefined = { assistant: true, search: true };
    mockPage.url = new URL('https://gallery.test/spaces/space-1');
  });

  it('should come after the tags, before the pages', () => {
    const order = RECONCILE_ORDER_BY_SCOPE.all;
    expect(order.indexOf('journals')).toBe(order.indexOf('tags') + 1);
    expect(order.at(-1)).toBe('navigation');
    expect(RECONCILE_ORDER_BY_SCOPE.collections).not.toContain('journals');
  });

  it('should search the collections for a query of 3 characters or more', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(searchCollections).mockResolvedValue(response([visit()]));
      const m = new GlobalSearchManager();
      m.open();

      m.setQuery('no');
      await vi.advanceTimersByTimeAsync(200);
      expect(searchCollections).not.toHaveBeenCalled();
      expect(m.sections.journals).toEqual({ status: 'idle' });

      m.setQuery('noma');
      await vi.advanceTimersByTimeAsync(200);
      expect(searchCollections).toHaveBeenCalledWith({ q: 'noma' }, expect.anything());
      expect(m.sections.journals).toMatchObject({ status: 'ok', total: 2 });

      // a prefix scope leaves it out
      m.setQuery('#noma');
      await vi.advanceTimersByTimeAsync(200);
      expect(m.sections.journals).toEqual({ status: 'idle' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('should preview the active row', () => {
    const m = new GlobalSearchManager();
    m.query = 'noma';
    m.sections.journals = { status: 'ok', items: [visitItem], total: 1 };
    m.activeItemId = `journal:${visitItem.id}`;
    expect(m.getActiveItem()).toEqual({ kind: 'journal', data: visitItem });

    m.activeItemId = null;
    m.reconcileCursor();
    expect(m.activeItemId).toBe(`journal:${visitItem.id}`);
  });

  it("should open a visit on the timeline filtered by its place's tag, whatever the surface", async () => {
    vi.mocked(getAllTags).mockResolvedValue([
      { id: 'tag-noma', value: 'Food/Noma Australia', name: 'Noma Australia' } as TagResponseDto,
    ]);
    const m = new GlobalSearchManager();
    m.open();

    await m.activateJournal(visitItem);

    expect(m.isOpen).toBe(false);
    expect(goto).toHaveBeenCalledWith('/photos?tags=tag-noma');
  });

  it('should fall back to the Tags page of a tag it does not know', async () => {
    vi.mocked(getAllTags).mockResolvedValue([]);
    await new GlobalSearchManager().activateJournal(visitItem);
    expect(goto).toHaveBeenCalledWith('/tags?path=Food%2FNoma%20Australia');
  });

  it('should ask the assistant the question in a new chat', async () => {
    await new GlobalSearchManager().activateJournal({
      id: ASK_ASSISTANT_ID,
      kind: 'ask',
      question: 'what did we eat?',
    });
    expect(goto).toHaveBeenCalledWith('/assistant?prompt=what%20did%20we%20eat%3F');
  });
});

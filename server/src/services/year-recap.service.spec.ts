import { BadRequestException } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import {
  AssetType,
  BookDraftKind,
  JobStatus,
  MemoryType,
  NotificationLevel,
  NotificationType,
  UserMetadataKey,
} from 'src/enum.js';
import { BookDraftService } from 'src/services/book-draft.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { YearRecapService } from 'src/services/year-recap.service.js';
import { YearRecapAsset } from 'src/utils/year-recap.js';
import { factory, newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const photo = (index: number, type = AssetType.Image): YearRecapAsset => ({
  id: `a-${index}`,
  type,
  isFavorite: false,
  time: Date.UTC(2025, index % 12, 1 + (index % 25), 12),
  latitude: null,
  longitude: null,
  city: 'Lisbon',
  state: null,
  country: 'Portugal',
});

const year = (count: number) => Array.from({ length: count }, (_, index) => photo(index));

const recapMemory = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'recap-memory',
    ownerId: 'owner',
    type: MemoryType.Rule,
    isSaved: false,
    memoryAt: new Date('2025-07-01T00:00:00.000Z'),
    data: { ruleId: 'year_recap', dedupeKey: 'year_recap:2025', context: { year: 2025, count: 120, places: 4 } },
    assets: [],
    ...overrides,
  }) as never;

const user = (preferences: Record<string, unknown> = {}) =>
  ({
    id: 'owner',
    name: 'Demo',
    email: 'demo@example.com',
    isAdmin: false,
    quotaUsageInBytes: 0,
    quotaSizeInBytes: null,
    metadata: [{ key: UserMetadataKey.Preferences, value: preferences }],
  }) as never;

const draftOf = (bookId: string, overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  key: 'recap:2025',
  kind: BookDraftKind.Recap,
  reason: 'Your 2025',
  memoryId: 'recap-memory',
  createdAt: new Date(),
  book: { id: bookId, title: '2025 in review', pageCount: 30 } as never,
  ...overrides,
});

describe(YearRecapService.name, () => {
  let sut: YearRecapService;
  let mocks: ServiceMocks;
  let draftCandidate: MockInstance<BookDraftService['draftCandidate']>;
  let getDrafts: MockInstance<BookDraftService['getDrafts']>;
  let createHighlight: MockInstance<HighlightService['create']>;
  const auth = factory.auth({ user: { id: 'owner' } });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(YearRecapService));
    mocks.user.getMetadata.mockResolvedValue([]);
    mocks.yearRecap.getAssets.mockResolvedValue(year(120));
    mocks.yearRecap.getPeople.mockResolvedValue([]);
    mocks.yearRecap.getJournalTags.mockResolvedValue([]);
    mocks.bookDraft.getRuleMemories.mockResolvedValue([
      { id: 'recap-memory', type: MemoryType.Rule, data: { ruleId: 'year_recap', context: { year: 2025 } } } as never,
    ]);
    mocks.bookDraft.getKeys.mockResolvedValue(new Set());
    mocks.notification.create.mockResolvedValue({ id: newUuid() } as never);
    draftCandidate = vi.spyOn(BookDraftService.prototype, 'draftCandidate').mockResolvedValue('book-1');
    getDrafts = vi.spyOn(BookDraftService.prototype, 'getDrafts').mockResolvedValue([]);
    createHighlight = vi
      .spyOn(HighlightService.prototype, 'create')
      .mockResolvedValue({ id: 'highlight-1', title: '2025 in review' } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handlePrepare', () => {
    it('tells the owner, and drafts the book of the year', async () => {
      mocks.memory.get.mockResolvedValue(recapMemory());
      mocks.user.get.mockResolvedValue(user());
      getDrafts.mockResolvedValue([draftOf('book-1')]);

      await expect(sut.handlePrepare({ id: 'recap-memory' })).resolves.toBe(JobStatus.Success);

      expect(draftCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ id: 'owner' }) }),
        expect.objectContaining({
          key: 'recap:2025',
          kind: BookDraftKind.Recap,
          title: '2025 in review',
          memoryId: 'recap-memory',
          assetIds: expect.arrayContaining(['a-0', 'a-119']),
        }),
        { notify: false },
      );
      expect(mocks.notification.create).toHaveBeenCalledWith({
        userId: 'owner',
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: 'Your 2025 in review is ready',
        description: '120 photos, 4 places. Watch it, make a video of it, or keep the book of the year',
        data: JSON.stringify({ memoryId: 'recap-memory', year: 2025, bookId: 'book-1' }),
      });
    });

    it('only tells the owner when they have suggested books off', async () => {
      mocks.memory.get.mockResolvedValue(recapMemory());
      mocks.user.get.mockResolvedValue(user({ bookDrafts: { enabled: false } }));

      await sut.handlePrepare({ id: 'recap-memory' });

      expect(draftCandidate).not.toHaveBeenCalled();
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '120 photos, 4 places. Watch it, or make a video or a book of it',
          data: JSON.stringify({ memoryId: 'recap-memory', year: 2025 }),
        }),
      );
    });

    it('does nothing for a user who turned the recaps off', async () => {
      mocks.memory.get.mockResolvedValue(recapMemory());
      mocks.user.get.mockResolvedValue(user({ memories: { types: { year_recap: false } } }));

      await expect(sut.handlePrepare({ id: 'recap-memory' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.notification.create).not.toHaveBeenCalled();
      expect(draftCandidate).not.toHaveBeenCalled();
    });

    it('skips a memory that is not a year recap', async () => {
      mocks.memory.get.mockResolvedValue(recapMemory({ data: { ruleId: 'month_recap', context: { year: 2025 } } }));

      await expect(sut.handlePrepare({ id: 'recap-memory' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('does not draft the book of the year twice', async () => {
      mocks.memory.get.mockResolvedValue(recapMemory());
      mocks.user.get.mockResolvedValue(user());
      mocks.bookDraft.getKeys.mockResolvedValue(new Set(['recap:2025']));

      await sut.handlePrepare({ id: 'recap-memory' });

      expect(draftCandidate).not.toHaveBeenCalled();
      expect(mocks.notification.create).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('gives the stats, the memory and the draft waiting', async () => {
      getDrafts.mockResolvedValue([draftOf('book-1')]);

      const recap = await sut.get(auth, 2025);

      expect(recap).toMatchObject({
        year: 2025,
        memoryId: 'recap-memory',
        stats: { year: 2025, count: 120, places: 1 },
        draft: { book: { id: 'book-1' } },
      });
    });

    it('adds the exclusions of the request to the user’s', async () => {
      mocks.memoryExclusion.getAll.mockResolvedValue([
        {
          id: newUuid(),
          type: 'album',
          personGroupId: null,
          albumId: 'album-1',
          startDate: null,
          endDate: null,
          createdAt: new Date(),
          personName: null,
          personType: null,
          albumName: 'Work',
        },
      ] as never);

      await sut.get(auth, 2025, {
        excludePersonIds: ['dana'],
        excludeDateRanges: [{ startDate: '2025-03-01', endDate: '2025-03-31' }],
      });

      expect(mocks.yearRecap.getAssets).toHaveBeenCalledWith('owner', 2025, {
        personIds: ['dana'],
        albumIds: ['album-1'],
        dateRanges: [{ from: '2025-03-01', to: '2025-03-31' }],
        documents: false,
      });
    });
  });

  describe('createBook', () => {
    it('returns the draft waiting', async () => {
      const draft = draftOf('book-1');
      getDrafts.mockResolvedValue([draft]);

      await expect(sut.createBook(auth, 2025)).resolves.toBe(draft);
      expect(draftCandidate).not.toHaveBeenCalled();
    });

    it('drafts a new one without someone, under a key of its own', async () => {
      mocks.bookDraft.getKeys.mockResolvedValue(new Set(['recap:2025']));
      getDrafts.mockResolvedValue([draftOf('book-1', { key: 'recap:2025:1' })]);

      await sut.createBook(auth, 2025, { excludePersonIds: ['dana'], title: 'Our 2025' });

      expect(draftCandidate).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({ key: expect.stringMatching(/^recap:2025:\d+$/), title: 'Our 2025' }),
        { notify: false },
      );
      expect(mocks.yearRecap.getAssets).toHaveBeenCalledWith(
        'owner',
        2025,
        expect.objectContaining({ personIds: ['dana'] }),
      );
    });

    it('refuses a year without photos', async () => {
      mocks.yearRecap.getAssets.mockResolvedValue([photo(1, AssetType.Video)]);

      await expect(sut.createBook(auth, 2025)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createVideo', () => {
    it('makes the video of the recap memory', async () => {
      await sut.createVideo(auth, 2025, { format: 'vertical' });

      expect(createHighlight).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({ memoryId: 'recap-memory', format: 'vertical', title: '2025 in review' }),
        undefined,
      );
    });

    it('makes it of the year’s photos without someone', async () => {
      await sut.createVideo(auth, 2025, { excludePeopleNamed: undefined, excludePersonIds: ['dana'] } as never);

      expect(createHighlight).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({ assetIds: expect.arrayContaining(['a-0']), title: '2025 in review' }),
        undefined,
      );
      expect(createHighlight.mock.calls[0][1]).not.toHaveProperty('memoryId');
    });

    it('makes it of the year’s photos when there is no recap memory', async () => {
      mocks.bookDraft.getRuleMemories.mockResolvedValue([]);

      await sut.createVideo(auth, 2024);

      expect(mocks.yearRecap.getAssets).toHaveBeenCalledWith('owner', 2024, expect.anything());
      expect(createHighlight.mock.calls[0][1]).toMatchObject({ assetIds: expect.any(Array) });
    });

    it('refuses a year without photos or videos', async () => {
      mocks.bookDraft.getRuleMemories.mockResolvedValue([]);
      mocks.yearRecap.getAssets.mockResolvedValue([]);

      await expect(sut.createVideo(auth, 2024)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

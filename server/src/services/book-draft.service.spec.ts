import { BadRequestException } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import { defaults } from 'src/dtos/config.dto.js';
import {
  ActivityLogAction,
  BookDraftKind,
  BookDraftState,
  BookStatus,
  JobName,
  JobStatus,
  MemoryType,
  NotificationLevel,
  NotificationType,
  UserMetadataKey,
} from 'src/enum.js';
import { BookDraftService, MAX_PENDING_DRAFTS } from 'src/services/book-draft.service.js';
import { BookAutoLayoutResult, BookService } from 'src/services/book.service.js';
import { ActivityRecorder, toBookSnapshot } from 'src/utils/activity-log.js';
import { BookFactory, BookPageFactory } from 'test/factories/book.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const drafts = defaults.books.drafts;
const NOW = new Date('2026-09-27T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** a user row with their preferences */
const user = (preferences: Record<string, unknown> = {}) =>
  ({
    id: newUuid(),
    name: 'Demo',
    email: 'demo@immich.dev',
    isAdmin: false,
    quotaUsageInBytes: 0,
    quotaSizeInBytes: null,
    metadata: [{ key: UserMetadataKey.Preferences, value: preferences }],
  }) as never;

/** three meals of five dishes each in 2025: a "2025 in food" draft */
const foodYear = () =>
  [1, 2, 3].flatMap((meal) => [
    { id: newUuid(), time: Date.UTC(2025, meal, 10, 20), value: `Food/Restaurant ${meal}/Menu` },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: newUuid(),
      time: Date.UTC(2025, meal, 10, 20) + (i + 1) * 5 * 60_000,
      value: `Food/Restaurant ${meal}/Dish ${i + 1}`,
    })),
  ]);

/** the Rome trip of 1–3 June 2025, with 45 photos */
const romeTrip = () =>
  Array.from({ length: 45 }, (_, i) => ({
    id: newUuid(),
    time: Date.UTC(2025, 5, 1, 8) + Math.floor(i / 15) * 24 * HOUR + (i % 15) * HOUR,
    latitude: 41.9,
    longitude: 12.5,
    city: 'Rome',
    state: 'Lazio',
    country: 'Italy',
  }));

describe(BookDraftService.name, () => {
  let sut: BookDraftService;
  let mocks: ServiceMocks;
  let createDraft: MockInstance<BookService['createDraft']>;

  const auth = factory.auth();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BookDraftService));
    mocks.bookDraft.getPending.mockResolvedValue([]);
    mocks.bookDraft.getKeys.mockResolvedValue(new Set());
    mocks.bookDraft.getCollectionTags.mockResolvedValue([]);
    mocks.bookDraft.getTimeline.mockResolvedValue([]);
    mocks.bookDraft.getPeopleWithBirthdays.mockResolvedValue([]);
    mocks.bookDraft.getPersonPhotos.mockResolvedValue([]);
    mocks.bookDraft.getRuleMemories.mockResolvedValue([]);
    mocks.bookDraft.claim.mockImplementation((values) =>
      Promise.resolve({ id: newUuid(), state: BookDraftState.Drafted, bookId: null, ...values } as never),
    );
    mocks.bookDraft.update.mockResolvedValue();
    mocks.bookDraft.delete.mockResolvedValue();
    mocks.book.update.mockResolvedValue();
    mocks.book.delete.mockResolvedValue();
    mocks.notification.create.mockResolvedValue({ id: newUuid() } as never);
    createDraft = vi
      .spyOn(BookService.prototype, 'createDraft')
      .mockImplementation(() => Promise.resolve({ book: { id: newUuid() } } as unknown as BookAutoLayoutResult));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('draftBooks', () => {
    it('should draft a new book, record its key and notify the user', async () => {
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual(['food:2025']);

      expect(mocks.bookDraft.claim).toHaveBeenCalledWith({
        ownerId: auth.user.id,
        key: 'food:2025',
        kind: BookDraftKind.Yearly,
        title: '2025 in food',
        reason: 'You visited 3 restaurants in 2025 and photographed 15 dishes',
        memoryId: null,
      });
      expect(createDraft).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({ title: '2025 in food', stylePreset: 'food', includeMaps: false }),
      );
      const [{ book }] = await Promise.all(createDraft.mock.results.map((result) => result.value));
      expect(mocks.bookDraft.update).toHaveBeenCalledWith(expect.any(String), { bookId: book.id });
      expect(mocks.notification.create).toHaveBeenCalledWith({
        userId: auth.user.id,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: 'A new photo book is ready to review: 2025 in food',
        description: 'You visited 3 restaurants in 2025 and photographed 15 dishes',
        data: JSON.stringify({ bookId: book.id }),
      });
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith('on_notification', auth.user.id, expect.anything());
    });

    it('should be idempotent: a key is never drafted twice', async () => {
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());
      mocks.bookDraft.getKeys.mockResolvedValue(new Set(['food:2025']));

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual([]);
      expect(createDraft).not.toHaveBeenCalled();
    });

    it('should not draft again a suggestion the user discarded', async () => {
      // a discarded suggestion keeps its key
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());
      mocks.bookDraft.getKeys.mockResolvedValue(new Set(['food:2025']));
      await sut.draftBooks(auth, drafts, NOW);
      expect(mocks.bookDraft.claim).not.toHaveBeenCalled();
    });

    it('should skip a key claimed by another run', async () => {
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());
      mocks.bookDraft.claim.mockResolvedValue(undefined);

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual([]);
      expect(createDraft).not.toHaveBeenCalled();
    });

    it('should draft at most maxPerRun books, the newest first', async () => {
      mocks.bookDraft.getCollectionTags.mockResolvedValue([
        ...foodYear(),
        ...foodYear().map((tag) => ({ ...tag, time: tag.time - 365 * 24 * HOUR })),
      ]);
      mocks.bookDraft.getTimeline.mockResolvedValue(romeTrip());

      await expect(sut.draftBooks(auth, { ...drafts, maxPerRun: 2 }, NOW)).resolves.toEqual([
        'food:2025',
        'trip:2025-06-01',
      ]);
      expect(createDraft).toHaveBeenCalledTimes(2);
    });

    it('should not draft more while the user has many drafts to review', async () => {
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());
      mocks.bookDraft.getPending.mockResolvedValue(Array.from({ length: MAX_PENDING_DRAFTS }, () => ({}) as never));

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual([]);
      expect(mocks.bookDraft.getCollectionTags).not.toHaveBeenCalled();
    });

    it('should leave out the kinds the admin disabled', async () => {
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());
      mocks.bookDraft.getTimeline.mockResolvedValue(romeTrip());

      await expect(sut.draftBooks(auth, { ...drafts, yearly: false, birthdays: false }, NOW)).resolves.toEqual([
        'trip:2025-06-01',
      ]);
      expect(mocks.bookDraft.getCollectionTags).toHaveBeenCalledWith(auth.user.id, ['Travel/'], {
        personIds: [],
        dateRanges: [],
        albumIds: [],
        documents: false,
      });
      expect(mocks.bookDraft.getPeopleWithBirthdays).not.toHaveBeenCalled();
    });

    it('should draft a trip away from home with maps in the classic style', async () => {
      mocks.bookDraft.getTimeline.mockResolvedValue(romeTrip());

      await sut.draftBooks(auth, drafts, NOW);

      expect(createDraft).toHaveBeenCalledWith(auth, {
        title: 'Our trip to Rome',
        subtitle: '1–3 June 2025',
        stylePreset: 'classic',
        assetIds: expect.any(Array),
        includeMaps: true,
        targetPageCount: undefined,
      });
    });

    it('should base a trip on the memory of it, under the key of the trip the timeline found', async () => {
      const timeline: Array<Record<string, unknown>> = romeTrip();
      // a photo of the last evening, taken without a location
      timeline.push({ ...timeline[0], id: newUuid(), time: Date.UTC(2025, 5, 3, 23), latitude: null, longitude: null });
      mocks.bookDraft.getTimeline.mockResolvedValue(timeline as never);
      const memoryId = newUuid();
      mocks.bookDraft.getRuleMemories.mockResolvedValue([
        {
          id: memoryId,
          type: MemoryType.Rule,
          memoryAt: new Date('2025-06-20T00:00:00.000Z'),
          data: {
            ruleId: 'recent_trip',
            dedupeKey: 'recent_trip:it|rome:2025-06-20',
            context: {
              city: 'Rome',
              country: 'Italy',
              placeLabel: 'Rome, Italy',
              tripWindowStart: '2025-06-01T08:00:00.000Z',
              tripWindowEnd: '2025-06-03T22:00:00.000Z',
            },
          },
        },
        {
          id: newUuid(),
          type: MemoryType.Rule,
          memoryAt: new Date('2025-06-01T00:00:00.000Z'),
          data: {
            ruleId: 'trip_anniversary',
            context: { city: 'Rome', tripStart: '2025-06-01T08:00:00.000Z', tripEnd: '2025-06-03T22:00:00.000Z' },
          },
        },
      ] as never);

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual(['trip:2025-06-01']);

      expect(mocks.bookDraft.getRuleMemories).toHaveBeenCalledWith(auth.user.id, [
        'recent_trip',
        'trip_anniversary',
        'birthday',
      ]);
      expect(mocks.bookDraft.claim).toHaveBeenCalledTimes(1);
      expect(mocks.bookDraft.claim).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'trip:2025-06-01', kind: BookDraftKind.Trip, memoryId }),
      );
      expect(createDraft).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({ title: 'Our trip to Rome', subtitle: '1–3 June 2025', includeMaps: true }),
      );
      // every photo of the memory's window, the one without a location too
      expect(createDraft.mock.calls[0][1].assetIds).toHaveLength(46);
    });

    it('should not suggest again a trip suggested before its memory was made', async () => {
      mocks.bookDraft.getTimeline.mockResolvedValue(romeTrip());
      mocks.bookDraft.getKeys.mockResolvedValue(new Set(['trip:2025-06-01']));
      mocks.bookDraft.getRuleMemories.mockResolvedValue([
        {
          id: newUuid(),
          type: MemoryType.Rule,
          memoryAt: new Date('2025-06-20T00:00:00.000Z'),
          data: {
            ruleId: 'recent_trip',
            context: { tripWindowStart: '2025-06-02T08:00:00.000Z', tripWindowEnd: '2025-06-03T22:00:00.000Z' },
          },
        },
      ] as never);

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual([]);
      expect(createDraft).not.toHaveBeenCalled();
    });

    it('should link a birthday book to the birthday memory of the same day', async () => {
      const personId = newUuid();
      const memoryId = newUuid();
      mocks.bookDraft.getPeopleWithBirthdays.mockResolvedValue([
        { id: personId, name: 'Maya', birthDate: '2019-03-10' },
      ]);
      mocks.bookDraft.getPersonPhotos.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({ id: newUuid(), time: Date.UTC(2025, 5, 1) + i * 24 * HOUR })),
      );
      mocks.bookDraft.getRuleMemories.mockResolvedValue([
        {
          id: memoryId,
          type: MemoryType.Rule,
          memoryAt: new Date('2026-03-10T00:00:00.000Z'),
          data: { ruleId: 'birthday', context: { personId, personName: 'Maya' } },
        },
      ] as never);

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual([`birthday:${personId}:7`]);
      expect(mocks.bookDraft.claim).toHaveBeenCalledWith(expect.objectContaining({ memoryId }));
    });

    it('should draft a birthday book from the photos of the person', async () => {
      const personId = newUuid();
      mocks.bookDraft.getPeopleWithBirthdays.mockResolvedValue([
        { id: personId, name: 'Maya', birthDate: '2019-03-10' },
      ]);
      mocks.bookDraft.getPersonPhotos.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({ id: newUuid(), time: Date.UTC(2025, 5, 1) + i * 24 * HOUR })),
      );

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual([`birthday:${personId}:7`]);
      expect(mocks.bookDraft.getPersonPhotos).toHaveBeenCalledWith(
        auth.user.id,
        personId,
        new Date('2025-03-10T00:00:00.000Z'),
        new Date('2026-03-11T00:00:00.000Z'),
        { personIds: [], dateRanges: [], albumIds: [], documents: false },
      );
      expect(createDraft).toHaveBeenCalledWith(
        auth,
        expect.objectContaining({ title: 'Maya turns 7', stylePreset: 'soft' }),
      );
    });

    it('should forget the key when the layout fails, so it is tried again', async () => {
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());
      createDraft.mockRejectedValue(new BadRequestException('There are no photos to lay out'));

      await expect(sut.draftBooks(auth, drafts, NOW)).resolves.toEqual([]);
      expect(mocks.bookDraft.delete).toHaveBeenCalled();
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('handleQueueAll', () => {
    it('should queue a job per user who wants suggestions', async () => {
      const [on, off] = [user(), user({ bookDrafts: { enabled: false } })];
      mocks.user.getList.mockResolvedValue([on, off]);

      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Success);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.BookDraftsGenerate, data: { id: (on as { id: string }).id } },
      ]);
    });

    it('should skip when the admin disabled suggested books', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ books: { drafts: { enabled: false } } });
      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('handleGenerate', () => {
    it('should skip a user who turned suggestions off', async () => {
      mocks.user.get.mockResolvedValue(user({ bookDrafts: { enabled: false } }));
      await expect(sut.handleGenerate({ id: newUuid() })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.bookDraft.getPending).not.toHaveBeenCalled();
    });

    it('should skip a user that does not exist', async () => {
      mocks.user.get.mockResolvedValue(undefined);
      await expect(sut.handleGenerate({ id: newUuid() })).resolves.toBe(JobStatus.Skipped);
    });

    it('should draft the books of the user', async () => {
      const row = user();
      mocks.user.get.mockResolvedValue(row);
      mocks.bookDraft.getCollectionTags.mockResolvedValue(foodYear());

      await expect(sut.handleGenerate({ id: (row as { id: string }).id })).resolves.toBe(JobStatus.Success);
      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ id: (row as { id: string }).id }) }),
        expect.objectContaining({ title: '2025 in food' }),
      );
    });
  });

  describe('getDrafts', () => {
    it('should list the drafts waiting for the user with their books', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id, status: BookStatus.Draft, title: '2025 in food' });
      const kept = BookFactory.create({ ownerId: auth.user.id, status: BookStatus.Active });
      const createdAt = new Date('2026-09-27T01:00:00.000Z');
      mocks.bookDraft.getPending.mockResolvedValue([
        {
          id: 'draft-1',
          key: 'food:2025',
          kind: BookDraftKind.Yearly,
          reason: 'Six meals',
          bookId: book.id,
          createdAt,
        },
        { id: 'draft-2', key: 'food:2024', kind: BookDraftKind.Yearly, reason: 'Kept', bookId: kept.id, createdAt },
      ] as never);
      mocks.book.get.mockImplementation((id) => Promise.resolve([book, kept].find((item) => item.id === id)));

      await expect(sut.getDrafts(auth)).resolves.toEqual([
        {
          id: 'draft-1',
          key: 'food:2025',
          kind: BookDraftKind.Yearly,
          reason: 'Six meals',
          createdAt,
          book: expect.objectContaining({ id: book.id, title: '2025 in food', status: BookStatus.Draft }),
        },
      ]);
    });
  });

  describe('refresh', () => {
    it('should queue a run for the user', async () => {
      mocks.user.getMetadata.mockResolvedValue([]);
      await sut.refresh(auth);
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.BookDraftsGenerate, data: { id: auth.user.id } });
    });

    it('should refuse when the user turned suggestions off', async () => {
      mocks.user.getMetadata.mockResolvedValue([
        { key: UserMetadataKey.Preferences, value: { bookDrafts: { enabled: false } } },
      ]);
      await expect(sut.refresh(auth)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should refuse when the admin disabled suggested books', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ books: { drafts: { enabled: false } } });
      await expect(sut.refresh(auth)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('keep', () => {
    it('should require access', async () => {
      await expect(sut.keep(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.update).not.toHaveBeenCalled();
    });

    it('should make the draft one of the user’s books', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id, status: BookStatus.Draft });
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.book.get.mockResolvedValueOnce(book).mockResolvedValue({ ...book, status: BookStatus.Active });
      mocks.bookDraft.getByBookId.mockResolvedValue({ id: 'draft-1' } as never);

      await expect(sut.keep(auth, book.id)).resolves.toEqual(
        expect.objectContaining({ id: book.id, status: BookStatus.Active }),
      );
      expect(mocks.book.update).toHaveBeenCalledWith(book.id, { status: BookStatus.Active });
      expect(mocks.bookDraft.update).toHaveBeenCalledWith('draft-1', { state: BookDraftState.Kept });
    });

    it('should refuse a book that is not a draft', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id });
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.book.get.mockResolvedValue(book);
      await expect(sut.keep(auth, book.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should record keeping the draft, to undo it', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id, status: BookStatus.Draft, title: '2025 in food' });
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.book.get.mockResolvedValueOnce(book).mockResolvedValue({ ...book, status: BookStatus.Active });
      mocks.bookDraft.getByBookId.mockResolvedValue({ id: 'draft-1' } as never);
      mocks.activityLog.create.mockResolvedValue({ id: 'change' } as never);

      await sut.keep(auth, book.id, ActivityRecorder.web());

      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ActivityLogAction.BookDraftKeep,
          summary: 'Kept the suggested book “2025 in food”',
          undo: { bookId: book.id, draftId: 'draft-1' },
        }),
      );
    });
  });

  describe('discard', () => {
    it('should delete the draft and remember the suggestion was discarded', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id, status: BookStatus.Draft });
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.book.get.mockResolvedValue(book);
      mocks.bookDraft.getByBookId.mockResolvedValue({ id: 'draft-1', state: BookDraftState.Drafted } as never);

      await sut.discard(auth, book.id);

      expect(mocks.bookDraft.update).toHaveBeenCalledWith('draft-1', { state: BookDraftState.Discarded });
      expect(mocks.book.delete).toHaveBeenCalledWith(book.id);
    });

    it('should refuse a book that is not a draft', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id });
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.book.get.mockResolvedValue(book);
      await expect(sut.discard(auth, book.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.delete).not.toHaveBeenCalled();
    });

    it('should record the discarded draft with a copy of its pages, to lay it out again on undo', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id, status: BookStatus.Draft, title: 'Crete' });
      const pages = [BookPageFactory.create({ bookId: book.id, position: 0 })];
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue(pages);
      mocks.bookDraft.getByBookId.mockResolvedValue({ id: 'draft-1', state: BookDraftState.Drafted } as never);
      mocks.activityLog.create.mockResolvedValue({ id: 'change' } as never);

      await sut.discard(auth, book.id, ActivityRecorder.web());

      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ActivityLogAction.BookDraftDiscard,
          summary: 'Discarded the suggested book “Crete”',
          undo: {
            bookId: book.id,
            draftId: 'draft-1',
            draftState: BookDraftState.Drafted,
            book: { ownerId: auth.user.id, status: BookStatus.Draft, createdAt: book.createdAt.toISOString() },
            snapshot: toBookSnapshot(book, pages),
          },
        }),
      );
    });
  });
});

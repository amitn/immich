import { defaultBookStyle } from 'src/dtos/book.dto.js';
import { ActivityLogAction, ActivityLogSource } from 'src/enum.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import {
  ActivityRecorder,
  BOOK_REVISIONS_KEPT,
  beginBookChange,
  fingerprintBook,
  recordActivity,
  stableStringify,
  toBookSnapshot,
} from 'src/utils/activity-log.js';
import { factory, newUuid } from 'test/small.factory.js';
import { automock } from 'test/utils.js';

const auth = factory.auth();

const book = (title = 'Sicily') => ({
  title,
  subtitle: null,
  pageWidthMm: 210,
  pageHeightMm: 210,
  style: defaultBookStyle,
  coverAssetId: null,
  albumId: null,
});

const page = (assetIds: string[], id = newUuid()) => ({
  id,
  layout: 'two',
  sectionTitle: null,
  caption: null,
  background: null,
  map: null,
  assets: assetIds.map((assetId, slot) => ({ slot, assetId, crop: null, caption: null })),
});

const setup = () => {
  const activityLogRepository = automock(ActivityLogRepository);
  const bookRepository = automock(BookRepository);
  activityLogRepository.create.mockResolvedValue({ id: 'change' } as never);
  activityLogRepository.createRevision.mockResolvedValue({ id: 'revision', createdAt: new Date() });
  activityLogRepository.pruneRevisions.mockResolvedValue();
  return { activityLogRepository, bookRepository, deps: { activityLogRepository, bookRepository } };
};

describe('activity log utils', () => {
  describe('stableStringify', () => {
    it('should sort keys at every level and skip undefined values', () => {
      expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined, e: null }] })).toBe('{"a":[{"d":2,"e":null}],"b":1}');
      expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    });
  });

  describe('fingerprintBook', () => {
    it('should be equal for equal books, whatever the key order', () => {
      const first = toBookSnapshot(book(), [page(['a'], 'page')]);
      const second = toBookSnapshot({ ...book(), style: { ...defaultBookStyle } }, [page(['a'], 'page')]);
      expect(fingerprintBook(first)).toBe(fingerprintBook(second));
    });

    it('should change with the title, the pages and the photos', () => {
      const original = fingerprintBook(toBookSnapshot(book(), [page(['a'], 'page')]));
      expect(fingerprintBook(toBookSnapshot(book('Rome'), [page(['a'], 'page')]))).not.toBe(original);
      expect(fingerprintBook(toBookSnapshot(book(), [page(['b'], 'page')]))).not.toBe(original);
      expect(fingerprintBook(toBookSnapshot(book(), [page(['a'], 'other')]))).not.toBe(original);
    });
  });

  describe('recordActivity', () => {
    it('should do nothing without a recorder', async () => {
      const repository = automock(ActivityLogRepository);

      await expect(
        recordActivity({ repository }, auth.user.id, undefined, {
          action: ActivityLogAction.SharedLinkCreate,
          summary: 'Shared',
          undo: { sharedLinkId: 'link' },
        }),
      ).resolves.toBeUndefined();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should write the change with its origin and keep its id', async () => {
      const repository = automock(ActivityLogRepository);
      repository.create.mockResolvedValue({ id: 'change' } as never);
      const recorder = ActivityRecorder.assistant({ sessionId: 'session', toolName: 'add_to_album', groupId: 'turn' });

      await recordActivity({ repository }, auth.user.id, recorder, {
        action: ActivityLogAction.AlbumAddAssets,
        summary: 'Added 2 photos to “Trip”',
        targetId: 'album',
        assetIds: ['a', 'b', 'a'],
        undo: { albumId: 'album', assetIds: ['a', 'b'] },
      });

      expect(repository.create).toHaveBeenCalledWith({
        userId: auth.user.id,
        source: ActivityLogSource.Assistant,
        sessionId: 'session',
        toolName: 'add_to_album',
        groupId: 'turn',
        action: ActivityLogAction.AlbumAddAssets,
        summary: 'Added 2 photos to “Trip”',
        targetId: 'album',
        assetIds: ['a', 'b'],
        undo: { albumId: 'album', assetIds: ['a', 'b'] },
      });
      expect(recorder.ids).toEqual(['change']);
    });

    it('should give every web request its own group', () => {
      const first = ActivityRecorder.web();
      const second = ActivityRecorder.web();
      expect(first.origin).toMatchObject({ source: ActivityLogSource.Web });
      expect(first.origin.groupId).not.toBe(second.origin.groupId);
    });

    it('should not fail the change when the log can not be written', async () => {
      const repository = automock(ActivityLogRepository);
      repository.create.mockRejectedValue(new Error('down'));
      const logger = { warn: vi.fn() };

      await expect(
        recordActivity({ repository, logger }, auth.user.id, ActivityRecorder.web(), {
          action: ActivityLogAction.SharedLinkCreate,
          summary: 'Shared',
          undo: { sharedLinkId: 'link' },
        }),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('beginBookChange', () => {
    it('should do nothing without a recorder', async () => {
      const { deps, bookRepository } = setup();

      await expect(beginBookChange(deps, undefined, 'book')).resolves.toBeUndefined();
      expect(bookRepository.get).not.toHaveBeenCalled();
    });

    it('should record an edit with the snapshot of the book before it', async () => {
      const { deps, bookRepository, activityLogRepository } = setup();
      const before = [page(['a'])];
      const after = [...before, page(['b'])];
      bookRepository.get.mockResolvedValue(book() as never);
      bookRepository.getPages.mockResolvedValueOnce(before as never).mockResolvedValueOnce(after as never);
      const recorder = ActivityRecorder.web();

      const change = await beginBookChange(deps, recorder, 'book');
      await change!.finish(auth, { summary: (title) => `Added a page to “${title}”` });

      expect(activityLogRepository.createRevision).toHaveBeenCalledWith('book', toBookSnapshot(book(), before));
      expect(activityLogRepository.pruneRevisions).toHaveBeenCalledWith('book', BOOK_REVISIONS_KEPT);
      expect(activityLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ActivityLogAction.BookEdit,
          summary: 'Added a page to “Sicily”',
          targetId: 'book',
          undo: { bookId: 'book', revisionId: 'revision', fingerprint: fingerprintBook(toBookSnapshot(book(), after)) },
        }),
      );
      expect(recorder.ids).toEqual(['change']);
    });

    it('should not record an edit that changed nothing', async () => {
      const { deps, bookRepository, activityLogRepository } = setup();
      const pages = [page(['a'])];
      bookRepository.get.mockResolvedValue(book() as never);
      bookRepository.getPages.mockResolvedValue(pages as never);

      const change = await beginBookChange(deps, ActivityRecorder.web(), 'book');
      await change!.finish(auth, { summary: () => 'Nothing' });

      expect(activityLogRepository.createRevision).not.toHaveBeenCalled();
      expect(activityLogRepository.create).not.toHaveBeenCalled();
    });

    it('should record a new book with its fingerprint', async () => {
      const { deps, bookRepository, activityLogRepository } = setup();
      const pages = [page(['a'])];
      bookRepository.get.mockResolvedValue(book() as never);
      bookRepository.getPages.mockResolvedValue(pages as never);

      const change = await beginBookChange(deps, ActivityRecorder.web());
      await change!.finish(auth, { bookId: 'book', summary: (title) => `Created “${title}”` });

      expect(activityLogRepository.createRevision).not.toHaveBeenCalled();
      expect(activityLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ActivityLogAction.BookCreate,
          summary: 'Created “Sicily”',
          undo: { bookId: 'book', fingerprint: fingerprintBook(toBookSnapshot(book(), pages)) },
        }),
      );
    });
  });
});

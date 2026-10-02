import { BadRequestException } from '@nestjs/common';
import { defaultBookStyle } from 'src/dtos/book.dto.js';
import {
  ActivityLogAction,
  ActivityLogSource,
  ActivityUndoStatus,
  ArtJobStatus,
  BookDraftState,
  BookStatus,
  HighlightJobStatus,
  JobStatus,
  NotificationType,
} from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { AlbumService } from 'src/services/album.service.js';
import { ArtService } from 'src/services/art.service.js';
import { AssetService } from 'src/services/asset.service.js';
import { BookStyleService } from 'src/services/book-style.service.js';
import { BookService } from 'src/services/book.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { SharedLinkService } from 'src/services/shared-link.service.js';
import { TagService } from 'src/services/tag.service.js';
import { ActivityUndoMap, BookSnapshot, fingerprintBook, toBookSnapshot } from 'src/utils/activity-log.js';
import { factory, newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const auth = factory.auth();

type Row = Awaited<ReturnType<ServiceMocks['activityLog']['getByIds']>>[number];

let clock = Date.UTC(2026, 8, 27, 10);

/** an activity log row of the user, one second after the previous one */
const row = <A extends ActivityLogAction>(action: A, undo: ActivityUndoMap[A] | null, values: Partial<Row> = {}) =>
  ({
    id: newUuid(),
    userId: auth.user.id,
    source: ActivityLogSource.Assistant,
    sessionId: newUuid(),
    toolName: 'some_tool',
    action,
    summary: `Did ${action}`,
    targetId: null,
    assetIds: [],
    undo,
    groupId: newUuid(),
    createdAt: new Date((clock += 1000)),
    undoneAt: null,
    undoneBy: null,
    ...values,
  }) as Row;

const bookRow = (values: Partial<{ title: string; style: object; coverAssetId: string | null }> = {}) =>
  ({
    id: newUuid(),
    ownerId: auth.user.id,
    albumId: null,
    coverAssetId: null,
    title: 'Sicily',
    subtitle: null,
    pageWidthMm: 210,
    pageHeightMm: 210,
    style: defaultBookStyle,
    status: BookStatus.Active,
    createdAt: new Date(),
    ...values,
  }) as never;

const page = (assetIds: string[], values: Record<string, unknown> = {}) => ({
  id: newUuid(),
  layout: 'two',
  sectionTitle: null,
  caption: null,
  background: null,
  map: null,
  assets: assetIds.map((assetId, slot) => ({ slot, assetId, crop: null, caption: null })),
  ...values,
});

const asset = (id: string, values: Record<string, unknown> = {}) => ({
  id,
  ownerId: auth.user.id,
  stackId: null as string | null,
  deletedAt: null as Date | null,
  status: 'active',
  originalFileName: 'IMG.jpg',
  description: null as string | null,
  ...values,
});

/** makes the book repository return the book and its pages; returns its snapshot */
const setBookOf = (
  mocks: ServiceMocks,
  book: ReturnType<typeof bookRow> | undefined,
  pages: ReturnType<typeof page>[] = [],
) => {
  mocks.book.get.mockResolvedValue(book);
  mocks.book.getPages.mockResolvedValue(pages as never);
  return book ? toBookSnapshot(book as never, pages as never) : undefined;
};

describe(ActivityLogService.name, () => {
  let sut: ActivityLogService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ActivityLogService));
    mocks.activityLog.getByIds.mockResolvedValue([]);
    mocks.activityLog.search.mockResolvedValue([]);
    mocks.activityLog.setUndone.mockImplementation((ids) => Promise.resolve(ids));
    mocks.activityLog.clearUndone.mockResolvedValue();
    mocks.activityLog.getBookPlacements.mockResolvedValue([]);
    mocks.activityLog.getAlbumsOfAssets.mockResolvedValue([]);
    mocks.activityLog.getAssets.mockResolvedValue([]);
    mocks.activityLog.countBookSharedLinks.mockResolvedValue(0);
    mocks.book.update.mockResolvedValue();
    mocks.book.replacePages.mockResolvedValue();
    mocks.bookDraft.update.mockResolvedValue();
    mocks.stack.delete.mockResolvedValue();
    mocks.asset.update.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** makes `getByIds` return the rows (of the user) */
  const withRows = (...rows: Row[]) => {
    mocks.activityLog.getByIds.mockImplementation((userId, ids) =>
      Promise.resolve(rows.filter((row) => row.userId === userId && ids.includes(row.id))),
    );
    mocks.activityLog.search.mockImplementation((userId, { groupId }) =>
      Promise.resolve(rows.filter((row) => row.userId === userId && row.groupId === groupId)),
    );
  };

  const undoOne = async (row: Row) => {
    withRows(row);
    const { results } = await sut.undo(auth, row.id);
    return results[0];
  };

  describe('search', () => {
    it('should list the changes of the user', async () => {
      const change = row(ActivityLogAction.AlbumAddAssets, { albumId: newUuid(), assetIds: [] });
      mocks.activityLog.search.mockResolvedValue([change]);

      await expect(sut.search(auth, { sessionId: change.sessionId!, limit: 10, offset: 0 })).resolves.toEqual([
        expect.objectContaining({ id: change.id, summary: change.summary, canUndo: true, canRedo: false }),
      ]);
      expect(mocks.activityLog.search).toHaveBeenCalledWith(auth.user.id, {
        sessionId: change.sessionId,
        limit: 10,
        offset: 0,
      });
    });

    it('should offer redo for undone album changes only', async () => {
      const added = row(
        ActivityLogAction.AlbumAddAssets,
        { albumId: newUuid(), assetIds: [] },
        { undoneAt: new Date() },
      );
      const copy = row(ActivityLogAction.AssetCopy, { copies: [] }, { undoneAt: new Date() });
      mocks.activityLog.search.mockResolvedValue([added, copy]);

      const [first, second] = await sut.search(auth, { limit: 10, offset: 0 });
      expect(first).toMatchObject({ canUndo: false, canRedo: true });
      expect(second).toMatchObject({ canUndo: false, canRedo: false });
    });
  });

  describe('undo', () => {
    it('should only undo changes of the user', async () => {
      const change = row(ActivityLogAction.SharedLinkCreate, { sharedLinkId: newUuid() }, { userId: newUuid() });
      withRows(change);

      await expect(sut.undo(auth, change.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.activityLog.getByIds).toHaveBeenCalledWith(auth.user.id, [change.id]);
      expect(mocks.activityLog.setUndone).not.toHaveBeenCalled();
    });

    it('should report a change that was already undone', async () => {
      const change = row(ActivityLogAction.SharedLinkCreate, { sharedLinkId: newUuid() }, { undoneAt: new Date() });

      await expect(undoOne(change)).resolves.toMatchObject({ status: ActivityUndoStatus.AlreadyUndone });
      expect(mocks.activityLog.setUndone).not.toHaveBeenCalled();
    });

    it('should refuse a change without an inverse', async () => {
      await expect(undoOne(row(ActivityLogAction.SharedLinkCreate, null))).resolves.toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: 'This change can not be undone',
      });
    });

    it('should report a failure and not mark the change', async () => {
      mocks.sharedLink.get.mockRejectedValue(new Error('database is down'));

      await expect(
        undoOne(row(ActivityLogAction.SharedLinkCreate, { sharedLinkId: newUuid() })),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Failed, message: 'database is down' });
      expect(mocks.activityLog.setUndone).not.toHaveBeenCalled();
    });

    it('should undo a whole group newest first, and go on after a refusal', async () => {
      const groupId = newUuid();
      const albumId = newUuid();
      const first = row(ActivityLogAction.AlbumAddAssets, { albumId, assetIds: ['a'] }, { groupId });
      const second = row(ActivityLogAction.SharedLinkCreate, null, { groupId });
      const third = row(ActivityLogAction.AlbumAddAssets, { albumId, assetIds: ['b'] }, { groupId });
      withRows(first, second, third);
      mocks.activityLog.getAlbumState.mockResolvedValue({ albumName: 'Trip', deletedAt: null } as never);
      const removeAssets = vi
        .spyOn(AlbumService.prototype, 'removeAssets')
        .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));

      const response = await sut.undoAll(auth, { groupId });

      expect(response.results.map(({ id }) => id)).toEqual([third.id, second.id, first.id]);
      expect(response.results.map(({ status }) => status)).toEqual([
        ActivityUndoStatus.Undone,
        ActivityUndoStatus.Refused,
        ActivityUndoStatus.Undone,
      ]);
      expect(response).toMatchObject({ undone: 2, refused: 1 });
      expect(removeAssets.mock.calls.map((call) => call[2].ids)).toEqual([['b'], ['a']]);
      expect(mocks.activityLog.setUndone).toHaveBeenCalledWith([third.id], ActivityLogSource.Web);
      expect(mocks.activityLog.setUndone).toHaveBeenCalledWith([first.id], ActivityLogSource.Web);
      expect(mocks.activityLog.setUndone).not.toHaveBeenCalledWith([second.id], expect.anything());
    });

    it('should record that the assistant undid a change', async () => {
      const change = row(ActivityLogAction.SharedLinkCreate, { sharedLinkId: newUuid() });
      withRows(change);
      mocks.sharedLink.get.mockResolvedValue(undefined);

      await sut.undoAll(auth, { ids: [change.id] }, ActivityLogSource.Assistant);

      expect(mocks.activityLog.setUndone).toHaveBeenCalledWith([change.id], ActivityLogSource.Assistant);
    });
  });

  describe('albums', () => {
    const albumId = newUuid();
    const created = (assetIds: string[]) =>
      row(ActivityLogAction.AlbumCreate, { albumId, name: 'Sicily', description: null, assetIds });
    const state = (values: Record<string, unknown> = {}) =>
      ({
        id: albumId,
        albumName: 'Sicily',
        description: '',
        deletedAt: null,
        assetIds: ['a', 'b'],
        sharedUsers: 0,
        sharedLinks: 0,
        ...values,
      }) as never;

    it('should delete an album that is unchanged since it was created', async () => {
      mocks.activityLog.getAlbumState.mockResolvedValue(state());
      const remove = vi.spyOn(AlbumService.prototype, 'delete').mockResolvedValue();

      await expect(undoOne(created(['b', 'a']))).resolves.toMatchObject({ status: ActivityUndoStatus.Undone });
      expect(remove).toHaveBeenCalledWith(auth, albumId);
    });

    it.each([
      ['renamed', { albumName: 'Sicily 2009' }, 'it was renamed to “Sicily 2009”'],
      ['with a new description', { description: 'Summer' }, 'its description was changed'],
      ['with photos added', { assetIds: ['a', 'b', 'c'] }, '1 photo were added'],
      ['with photos removed', { assetIds: ['a'] }, '1 photo were removed'],
      ['shared', { sharedUsers: 1 }, 'it is shared'],
      ['shared with a link', { sharedLinks: 1 }, 'it is shared'],
    ])('should keep an album %s', async (_, values, reason) => {
      mocks.activityLog.getAlbumState.mockResolvedValue(state(values));
      const remove = vi.spyOn(AlbumService.prototype, 'delete').mockResolvedValue();

      const result = await undoOne(created(['a', 'b']));

      expect(result.status).toBe(ActivityUndoStatus.Refused);
      expect(result.message).toContain(reason);
      expect(result.message).toContain('Albums have no trash');
      expect(remove).not.toHaveBeenCalled();
    });

    it('should not fail when the album was deleted already', async () => {
      mocks.activityLog.getAlbumState.mockResolvedValue(undefined);

      await expect(undoOne(created([]))).resolves.toMatchObject({
        status: ActivityUndoStatus.Undone,
        warnings: ['The album was already deleted'],
      });
    });

    it('should remove exactly the photos that were added', async () => {
      mocks.activityLog.getAlbumState.mockResolvedValue(state());
      const removeAssets = vi.spyOn(AlbumService.prototype, 'removeAssets').mockResolvedValue([
        { id: 'a', success: true },
        { id: 'b', success: false, error: 'not_found' as never },
      ]);

      await expect(
        undoOne(row(ActivityLogAction.AlbumAddAssets, { albumId, assetIds: ['a', 'b'] })),
      ).resolves.toMatchObject({
        status: ActivityUndoStatus.Undone,
        warnings: ['1 photo had already been removed from the album'],
      });
      expect(removeAssets).toHaveBeenCalledWith(auth, albumId, { ids: ['a', 'b'] });
    });

    it('should put removed photos back', async () => {
      mocks.activityLog.getAlbumState.mockResolvedValue(state());
      const addAssets = vi.spyOn(AlbumService.prototype, 'addAssets').mockResolvedValue([{ id: 'a', success: true }]);

      await expect(
        undoOne(row(ActivityLogAction.AlbumRemoveAssets, { albumId, assetIds: ['a'] })),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Undone });
      expect(addAssets).toHaveBeenCalledWith(auth, albumId, { ids: ['a'] });
    });

    it('should report the photos that could not be put back', async () => {
      mocks.activityLog.getAlbumState.mockResolvedValue(state());
      vi.spyOn(AlbumService.prototype, 'addAssets').mockResolvedValue([
        { id: 'a', success: true },
        { id: 'b', success: false, error: 'no_permission' as never },
      ]);

      await expect(
        undoOne(row(ActivityLogAction.AlbumRemoveAssets, { albumId, assetIds: ['a', 'b'] })),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Partial, message: expect.stringContaining('1 photo') });
    });

    it('should refuse to put photos back into a deleted album', async () => {
      mocks.activityLog.getAlbumState.mockResolvedValue(undefined);

      await expect(
        undoOne(row(ActivityLogAction.AlbumRemoveAssets, { albumId, assetIds: ['a'] })),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Refused });
    });
  });

  describe('copies', () => {
    const source = newUuid();
    const copy = newUuid();
    const stackId = newUuid();
    const copied = () => row(ActivityLogAction.AssetCopy, { copies: [{ id: copy, sourceId: source }] });

    it('should move the copy to the trash and remove the stack it made', async () => {
      mocks.activityLog.getAssets.mockResolvedValue([asset(copy, { stackId })] as never);
      mocks.activityLog.getStack.mockResolvedValue({ id: stackId, primaryAssetId: source, assetIds: [source, copy] });
      const deleteAll = vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      await expect(undoOne(copied())).resolves.toMatchObject({ status: ActivityUndoStatus.Undone, warnings: [] });
      expect(mocks.stack.delete).toHaveBeenCalledWith(stackId);
      expect(deleteAll).toHaveBeenCalledWith(auth, { ids: [copy], force: false });
    });

    it('should take the copy out of a larger stack, keeping the original on top', async () => {
      const other = newUuid();
      mocks.activityLog.getAssets.mockResolvedValue([asset(copy, { stackId })] as never);
      mocks.activityLog.getStack.mockResolvedValue({
        id: stackId,
        primaryAssetId: copy,
        assetIds: [other, source, copy],
      });
      mocks.stack.update.mockResolvedValue({} as never);
      vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      await undoOne(copied());

      expect(mocks.stack.delete).not.toHaveBeenCalled();
      expect(mocks.stack.update).toHaveBeenCalledWith(stackId, { primaryAssetId: source });
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: copy, stackId: null });
    });

    it('should refuse while the copy is placed in a book', async () => {
      mocks.activityLog.getBookPlacements.mockResolvedValue([
        { assetId: copy, bookId: newUuid(), title: 'Sicily', position: 2 },
      ]);
      const deleteAll = vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      const result = await undoOne(copied());

      expect(result.status).toBe(ActivityUndoStatus.Refused);
      expect(result.message).toContain('“Sicily” (page 3)');
      expect(deleteAll).not.toHaveBeenCalled();
    });

    it('should refuse while the copy is the cover of a book', async () => {
      mocks.activityLog.getBookPlacements.mockResolvedValue([
        { assetId: copy, bookId: newUuid(), title: 'Sicily', position: null },
      ]);

      await expect(undoOne(copied())).resolves.toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: expect.stringContaining('the cover of “Sicily”'),
      });
    });

    it('should not trash a copy twice', async () => {
      mocks.activityLog.getAssets.mockResolvedValue([asset(copy, { deletedAt: new Date() })] as never);
      const deleteAll = vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      await expect(undoOne(copied())).resolves.toMatchObject({
        status: ActivityUndoStatus.Undone,
        warnings: ['1 photo were already in the trash'],
      });
      expect(deleteAll).not.toHaveBeenCalled();
    });

    it('should warn about the albums of the copy', async () => {
      mocks.activityLog.getAssets.mockResolvedValue([asset(copy)] as never);
      mocks.activityLog.getAlbumsOfAssets.mockResolvedValue([{ assetId: copy, albumId: newUuid(), albumName: 'Trip' }]);
      vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      await expect(undoOne(copied())).resolves.toMatchObject({
        warnings: ['It was also in the album “Trip”, which no longer shows it'],
      });
    });

    it('should trash created assets such as collages', async () => {
      mocks.activityLog.getAssets.mockResolvedValue([asset(copy)] as never);
      const deleteAll = vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      await undoOne(row(ActivityLogAction.AssetCreate, { assetIds: [copy] }));

      expect(deleteAll).toHaveBeenCalledWith(auth, { ids: [copy], force: false });
    });
  });

  describe('artworks', () => {
    const jobId = newUuid();
    const job = (values: Record<string, unknown>) =>
      ({ id: jobId, sourceAssetId: 'source', resultAssetId: null, ...values }) as never;

    it('should refuse while the artwork is being made', async () => {
      mocks.artJob.get.mockResolvedValue(job({ status: ArtJobStatus.Running }));

      await expect(undoOne(row(ActivityLogAction.Artwork, { jobId }))).resolves.toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: 'The artwork is still being made: undo it once it is done',
      });
    });

    it('should move the artwork to the trash', async () => {
      mocks.artJob.get.mockResolvedValue(job({ status: ArtJobStatus.Completed, resultAssetId: 'art' }));
      mocks.activityLog.getAssets.mockResolvedValue([asset('art')] as never);
      const deleteAll = vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      await expect(undoOne(row(ActivityLogAction.Artwork, { jobId }))).resolves.toMatchObject({
        status: ActivityUndoStatus.Undone,
      });
      expect(deleteAll).toHaveBeenCalledWith(auth, { ids: ['art'], force: false });
    });

    it('should undo an artwork that failed', async () => {
      mocks.artJob.get.mockResolvedValue(job({ status: ArtJobStatus.Failed }));

      await expect(undoOne(row(ActivityLogAction.Artwork, { jobId }))).resolves.toMatchObject({
        status: ActivityUndoStatus.Undone,
        warnings: ['No artwork was made'],
      });
    });
  });

  describe('styles', () => {
    const styleId = newUuid();
    const updatedAt = new Date('2026-09-27T10:00:00.000Z');

    it('should delete a saved book style', async () => {
      mocks.book.getStyle.mockResolvedValue({ id: styleId, name: 'Wedding', updatedAt } as never);
      const remove = vi.spyOn(BookStyleService.prototype, 'delete').mockResolvedValue();

      await expect(
        undoOne(row(ActivityLogAction.BookStyleCreate, { styleId, updatedAt: updatedAt.toISOString() })),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Undone });
      expect(remove).toHaveBeenCalledWith(auth, styleId);
    });

    it('should keep a book style edited since', async () => {
      mocks.book.getStyle.mockResolvedValue({ id: styleId, name: 'Wedding', updatedAt: new Date() } as never);
      const remove = vi.spyOn(BookStyleService.prototype, 'delete').mockResolvedValue();

      await expect(
        undoOne(row(ActivityLogAction.BookStyleCreate, { styleId, updatedAt: updatedAt.toISOString() })),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Refused });
      expect(remove).not.toHaveBeenCalled();
    });

    it('should delete a saved art style', async () => {
      mocks.artJob.getStyle.mockResolvedValue({ id: styleId, name: 'Linocut', updatedAt } as never);
      const remove = vi.spyOn(ArtService.prototype, 'deleteStyle').mockResolvedValue();

      await undoOne(row(ActivityLogAction.ArtStyleCreate, { styleId, updatedAt: updatedAt.toISOString() }));

      expect(remove).toHaveBeenCalledWith(auth, styleId);
    });
  });

  describe('books', () => {
    it('should delete a new book that is unchanged', async () => {
      const book = bookRow();
      const snapshot = setBookOf(mocks, book, [page(['a'])])!;
      const remove = vi.spyOn(BookService.prototype, 'delete').mockResolvedValue();

      await expect(
        undoOne(
          row(ActivityLogAction.BookCreate, { bookId: (book as any).id, fingerprint: fingerprintBook(snapshot) }),
        ),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Undone });
      expect(remove).toHaveBeenCalledWith(auth, (book as any).id);
    });

    it('should keep a new book that was changed since', async () => {
      const book = bookRow();
      const before = setBookOf(mocks, book, [page(['a'])])!;
      setBookOf(mocks, book, [page(['a']), page(['b'])]);
      const remove = vi.spyOn(BookService.prototype, 'delete').mockResolvedValue();

      await expect(
        undoOne(row(ActivityLogAction.BookCreate, { bookId: (book as any).id, fingerprint: fingerprintBook(before) })),
      ).resolves.toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: expect.stringContaining('was changed after it was created'),
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it('should keep a new book that is shared', async () => {
      const book = bookRow();
      const snapshot = setBookOf(mocks, book)!;
      mocks.activityLog.countBookSharedLinks.mockResolvedValue(1);

      await expect(
        undoOne(
          row(ActivityLogAction.BookCreate, { bookId: (book as any).id, fingerprint: fingerprintBook(snapshot) }),
        ),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Refused, message: expect.stringContaining('link') });
    });

    describe('edits', () => {
      const book = bookRow();
      const bookId = (book as any).id as string;
      const kept = page(['a', 'b']);
      const before: BookSnapshot = toBookSnapshot(book as never, [kept] as never);

      beforeEach(() => {
        mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([bookId]));
        mocks.activityLog.getRevision.mockResolvedValue({
          id: 'revision',
          bookId,
          snapshot: before,
          createdAt: new Date(),
        });
        mocks.activityLog.getAssets.mockResolvedValue([asset('a'), asset('b')] as never);
      });

      it('should restore the book from its snapshot', async () => {
        const after = setBookOf(mocks, bookRow({ title: 'Sicily 2009' }), [kept, page(['c'])])!;
        mocks.book.get.mockResolvedValue({ ...(book as any), title: 'Sicily 2009' });

        await expect(
          undoOne(
            row(ActivityLogAction.BookEdit, { bookId, revisionId: 'revision', fingerprint: fingerprintBook(after) }),
          ),
        ).resolves.toMatchObject({ status: ActivityUndoStatus.Undone });
        expect(mocks.book.update).toHaveBeenCalledWith(bookId, expect.objectContaining({ title: 'Sicily' }));
        expect(mocks.book.replacePages).toHaveBeenCalledWith(bookId, [
          expect.objectContaining({ id: kept.id, layout: 'two', assets: kept.assets }),
        ]);
      });

      it('should leave out the photos deleted since', async () => {
        const after = setBookOf(mocks, book, [page(['c'])])!;
        mocks.activityLog.getAssets.mockResolvedValue([asset('a')] as never);

        await expect(
          undoOne(
            row(ActivityLogAction.BookEdit, { bookId, revisionId: 'revision', fingerprint: fingerprintBook(after) }),
          ),
        ).resolves.toMatchObject({ warnings: ['1 photo of the book were deleted since and left out'] });
        expect(mocks.book.replacePages).toHaveBeenCalledWith(bookId, [
          expect.objectContaining({ assets: [kept.assets[0]] }),
        ]);
      });

      it('should refuse when the book was edited again', async () => {
        const after = setBookOf(mocks, book, [page(['c'])])!;
        setBookOf(mocks, book, [page(['d'])]);

        await expect(
          undoOne(
            row(ActivityLogAction.BookEdit, { bookId, revisionId: 'revision', fingerprint: fingerprintBook(after) }),
          ),
        ).resolves.toMatchObject({
          status: ActivityUndoStatus.Refused,
          message: 'The book “Sicily” was changed again after this: undo the later changes first',
        });
        expect(mocks.book.replacePages).not.toHaveBeenCalled();
      });

      it('should refuse when the snapshot is no longer kept', async () => {
        const after = setBookOf(mocks, book, [page(['c'])])!;
        mocks.activityLog.getRevision.mockResolvedValue(undefined);

        await expect(
          undoOne(
            row(ActivityLogAction.BookEdit, { bookId, revisionId: 'revision', fingerprint: fingerprintBook(after) }),
          ),
        ).resolves.toMatchObject({ status: ActivityUndoStatus.Refused, message: expect.stringContaining('too old') });
      });

      it('should refuse when the book was deleted', async () => {
        mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set());

        await expect(
          undoOne(row(ActivityLogAction.BookEdit, { bookId, revisionId: 'revision', fingerprint: 'x' })),
        ).resolves.toMatchObject({ status: ActivityUndoStatus.Refused });
      });

      it('should restore the book, then trash the copies the change placed in it', async () => {
        const after = setBookOf(mocks, book, [page(['copy', 'b'])])!;
        mocks.activityLog.getAssets.mockImplementation((ids) => Promise.resolve(ids.map((id) => asset(id)) as never));
        const deleteAll = vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

        await expect(
          undoOne(
            row(ActivityLogAction.BookEdit, {
              bookId,
              revisionId: 'revision',
              fingerprint: fingerprintBook(after),
              copies: [{ id: 'copy', sourceId: 'a' }],
            }),
          ),
        ).resolves.toMatchObject({ status: ActivityUndoStatus.Undone });
        expect(mocks.book.replacePages).toHaveBeenCalled();
        expect(deleteAll).toHaveBeenCalledWith(auth, { ids: ['copy'], force: false });
      });
    });

    it('should make a kept draft a draft again', async () => {
      const book = bookRow();
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([(book as any).id]));
      mocks.book.get.mockResolvedValue(book);

      await undoOne(row(ActivityLogAction.BookDraftKeep, { bookId: (book as any).id, draftId: 'draft' }));

      expect(mocks.book.update).toHaveBeenCalledWith((book as any).id, { status: BookStatus.Draft });
      expect(mocks.bookDraft.update).toHaveBeenCalledWith('draft', { state: BookDraftState.Drafted });
    });

    it('should lay out a discarded draft again, with the same id', async () => {
      const book = bookRow();
      const bookId = (book as any).id as string;
      const pages = [page(['a'])];
      const snapshot = toBookSnapshot(book as never, pages as never);
      mocks.book.get.mockResolvedValue(undefined);
      mocks.book.create.mockResolvedValue({} as never);
      mocks.activityLog.getAssets.mockResolvedValue([asset('a')] as never);

      await expect(
        undoOne(
          row(ActivityLogAction.BookDraftDiscard, {
            bookId,
            draftId: 'draft',
            draftState: BookDraftState.Drafted,
            book: { ownerId: auth.user.id, status: BookStatus.Draft, createdAt: new Date().toISOString() },
            snapshot,
          }),
        ),
      ).resolves.toMatchObject({ status: ActivityUndoStatus.Undone });
      expect(mocks.book.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: bookId, ownerId: auth.user.id, status: BookStatus.Draft, title: 'Sicily' }),
      );
      expect(mocks.book.replacePages).toHaveBeenCalledWith(bookId, [expect.objectContaining({ id: pages[0].id })]);
      expect(mocks.bookDraft.update).toHaveBeenCalledWith('draft', { state: BookDraftState.Drafted, bookId });
    });
  });

  describe('collection names', () => {
    const dish = newUuid();
    const menu = newUuid();
    const named = () =>
      row(ActivityLogAction.CollectionEntries, {
        pack: 'food',
        photos: [
          {
            id: dish,
            tag: 'Food/Nino/Carbonara',
            tagAdded: true,
            previousTags: ['Food/Nino/Cacio e pepe'],
            description: 'Carbonara · Nino',
            previousDescription: '',
          },
          { id: menu, tag: 'Food/Nino/Menu', tagAdded: true, previousTags: [] },
        ],
      });

    beforeEach(() => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([dish, menu]));
      mocks.tag.upsertValue.mockImplementation(({ value }) => Promise.resolve({ id: `tag:${value}`, value } as never));
    });

    it('should restore the previous tags and description', async () => {
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([
        { assetId: dish, tagId: 'carbonara', value: 'Food/Nino/Carbonara' },
        { assetId: menu, tagId: 'menu', value: 'Food/Nino/Menu' },
      ]);
      mocks.activityLog.getAssets.mockResolvedValue([
        asset(dish, { description: 'Carbonara · Nino' }),
        asset(menu),
      ] as never);
      const removeAssets = vi.spyOn(TagService.prototype, 'removeAssets').mockResolvedValue([]);
      const addAssets = vi.spyOn(TagService.prototype, 'addAssets').mockResolvedValue([]);
      const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);

      await expect(undoOne(named())).resolves.toMatchObject({ status: ActivityUndoStatus.Undone, warnings: [] });
      expect(removeAssets).toHaveBeenCalledWith(auth, 'carbonara', { ids: [dish] });
      expect(removeAssets).toHaveBeenCalledWith(auth, 'menu', { ids: [menu] });
      expect(addAssets).toHaveBeenCalledWith(auth, 'tag:Food/Nino/Cacio e pepe', { ids: [dish] });
      expect(update).toHaveBeenCalledWith(auth, dish, { description: '' });
    });

    it('should keep a description the user edited since', async () => {
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([
        { assetId: dish, tagId: 'carbonara', value: 'Food/Nino/Carbonara' },
        { assetId: menu, tagId: 'menu', value: 'Food/Nino/Menu' },
      ]);
      mocks.activityLog.getAssets.mockResolvedValue([asset(dish, { description: 'Best ever' }), asset(menu)] as never);
      vi.spyOn(TagService.prototype, 'removeAssets').mockResolvedValue([]);
      vi.spyOn(TagService.prototype, 'addAssets').mockResolvedValue([]);
      const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);

      await expect(undoOne(named())).resolves.toMatchObject({
        warnings: ['The description of a photo was edited since, so it was kept'],
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('should leave photos named again since', async () => {
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([
        { assetId: dish, tagId: 'amatriciana', value: 'Food/Nino/Amatriciana' },
        { assetId: menu, tagId: 'menu', value: 'Food/Nino/Menu' },
      ]);
      mocks.activityLog.getAssets.mockResolvedValue([asset(dish), asset(menu)] as never);
      const removeAssets = vi.spyOn(TagService.prototype, 'removeAssets').mockResolvedValue([]);
      vi.spyOn(TagService.prototype, 'addAssets').mockResolvedValue([]);

      await expect(undoOne(named())).resolves.toMatchObject({
        status: ActivityUndoStatus.Partial,
        message: '1 photo were named again since and kept their new names',
      });
      expect(removeAssets).toHaveBeenCalledTimes(1);
      expect(removeAssets).toHaveBeenCalledWith(auth, 'menu', { ids: [menu] });
    });

    it('should refuse when every photo was named again', async () => {
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
      mocks.activityLog.getAssets.mockResolvedValue([asset(dish), asset(menu)] as never);

      await expect(undoOne(named())).resolves.toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: 'The photos were named again since: undo that change first',
      });
    });

    it('should keep a tag the photo already had', async () => {
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([
        { assetId: dish, tagId: 'carbonara', value: 'Food/Nino/Carbonara' },
      ]);
      mocks.activityLog.getAssets.mockResolvedValue([asset(dish, { description: 'Carbonara · Nino' })] as never);
      const removeAssets = vi.spyOn(TagService.prototype, 'removeAssets').mockResolvedValue([]);
      vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);

      await undoOne(
        row(ActivityLogAction.CollectionEntries, {
          pack: 'food',
          photos: [
            {
              id: dish,
              tag: 'Food/Nino/Carbonara',
              tagAdded: false,
              previousTags: [],
              description: 'Carbonara · Nino',
              previousDescription: '',
            },
          ],
        }),
      );

      expect(removeAssets).not.toHaveBeenCalled();
    });
  });

  describe('highlight videos', () => {
    const highlightId = newUuid();
    const job = (values: Record<string, unknown>) =>
      ({ id: highlightId, albumId: 'album', options: { addToAlbum: true }, resultAssetId: null, ...values }) as never;

    it('should cancel a video that is still rendering', async () => {
      mocks.highlightJob.get.mockResolvedValue(job({ status: HighlightJobStatus.Running }));
      const cancel = vi.spyOn(HighlightService.prototype, 'cancel').mockResolvedValue({} as never);

      await expect(undoOne(row(ActivityLogAction.HighlightCreate, { highlightId }))).resolves.toMatchObject({
        status: ActivityUndoStatus.Undone,
      });
      expect(cancel).toHaveBeenCalledWith(auth, highlightId);
    });

    it('should take the video out of its album and move it to the trash', async () => {
      mocks.highlightJob.get.mockResolvedValue(job({ status: HighlightJobStatus.Completed, resultAssetId: 'video' }));
      mocks.activityLog.getAssets.mockResolvedValue([asset('video')] as never);
      const removeAssets = vi.spyOn(AlbumService.prototype, 'removeAssets').mockResolvedValue([]);
      const deleteAll = vi.spyOn(AssetService.prototype, 'deleteAll').mockResolvedValue();

      await undoOne(row(ActivityLogAction.HighlightCreate, { highlightId }));

      expect(removeAssets).toHaveBeenCalledWith(auth, 'album', { ids: ['video'] });
      expect(deleteAll).toHaveBeenCalledWith(auth, { ids: ['video'], force: false });
    });
  });

  it('should delete a shared link', async () => {
    const sharedLinkId = newUuid();
    mocks.sharedLink.get.mockResolvedValue({ id: sharedLinkId } as never);
    const remove = vi.spyOn(SharedLinkService.prototype, 'remove').mockResolvedValue();

    await expect(undoOne(row(ActivityLogAction.SharedLinkCreate, { sharedLinkId }))).resolves.toMatchObject({
      status: ActivityUndoStatus.Undone,
    });
    expect(mocks.sharedLink.get).toHaveBeenCalledWith(auth.user.id, sharedLinkId);
    expect(remove).toHaveBeenCalledWith(auth, sharedLinkId);
  });

  describe('redo', () => {
    it('should add the photos to the album again', async () => {
      const change = row(
        ActivityLogAction.AlbumAddAssets,
        { albumId: 'album', assetIds: ['a'] },
        { undoneAt: new Date(), undoneBy: ActivityLogSource.Web },
      );
      withRows(change);
      const addAssets = vi.spyOn(AlbumService.prototype, 'addAssets').mockResolvedValue([]);

      await expect(sut.redo(auth, change.id)).resolves.toMatchObject({ canUndo: true, undoneAt: null });
      expect(addAssets).toHaveBeenCalledWith(auth, 'album', { ids: ['a'] });
      expect(mocks.activityLog.clearUndone).toHaveBeenCalledWith(change.id);
    });

    it('should not redo other changes', async () => {
      const change = row(ActivityLogAction.AssetCopy, { copies: [] }, { undoneAt: new Date() });
      withRows(change);

      await expect(sut.redo(auth, change.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should not redo a change that was not undone', async () => {
      const change = row(ActivityLogAction.AlbumAddAssets, { albumId: 'album', assetIds: ['a'] });
      withRows(change);

      await expect(sut.redo(auth, change.id)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('handleCleanup', () => {
    it('should remove the changes older than the retention', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ agent: { activityRetentionDays: 30 } });
      mocks.activityLog.deleteOlderThan.mockResolvedValue(3);

      await expect(sut.handleCleanup()).resolves.toBe(JobStatus.Success);

      const [date] = mocks.activityLog.deleteOlderThan.mock.calls[0];
      const days = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeCloseTo(30, 1);
    });
  });

  describe('notifyAutoApprovedChanges', () => {
    it('should tell the user to review several changes', async () => {
      mocks.activityLog.countGroup.mockResolvedValue(12);
      mocks.notification.create.mockResolvedValue({ id: newUuid() } as never);

      await sut.notifyAutoApprovedChanges(auth.user.id, { sessionId: 'session', groupId: 'group' });

      expect(mocks.notification.create).toHaveBeenCalledWith({
        userId: auth.user.id,
        type: NotificationType.Custom,
        level: 'info',
        title: 'The assistant made 12 changes',
        description: 'Review or undo them in the activity log',
        data: JSON.stringify({ activityGroupId: 'group', sessionId: 'session' }),
      });
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith('on_notification', auth.user.id, expect.anything());
    });

    it('should not notify about a single change', async () => {
      mocks.activityLog.countGroup.mockResolvedValue(1);

      await sut.notifyAutoApprovedChanges(auth.user.id, { sessionId: 'session', groupId: 'group' });

      expect(mocks.notification.create).not.toHaveBeenCalled();
    });
  });
});

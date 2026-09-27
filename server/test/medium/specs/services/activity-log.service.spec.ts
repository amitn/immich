import { Kysely } from 'kysely';
import { defaultBookStyle } from 'src/dtos/book.dto.js';
import { ActivityLogAction, ActivityLogSource, ActivityUndoStatus, AssetStatus } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { AlbumAgentTools } from 'src/services/agent-tools/album.tools.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { ActivityRecorder, snapshotBook } from 'src/utils/activity-log.js';
import { AgentTool } from 'src/utils/agent/tools.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(ActivityLogService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      ActivityLogRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetJobRepository,
      AssetRepository,
      BookRepository,
      PartnerRepository,
      SharedLinkRepository,
      StackRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  return { sut, ctx };
};

type Context = ReturnType<typeof setup>['ctx'];

const newOwner = async (ctx: Context) => {
  const { user } = await ctx.newUser();
  return { user, auth: factory.auth({ user }) };
};

const albumAssetIds = async (ctx: Context, albumId: string) => {
  const rows = await ctx.database.selectFrom('album_asset').select('assetId').where('albumId', '=', albumId).execute();
  return rows.map(({ assetId }) => assetId).toSorted();
};

const tagsOf = async (ctx: Context, assetId: string) => {
  const rows = await ctx.database
    .selectFrom('tag_asset')
    .innerJoin('tag', 'tag.id', 'tag_asset.tagId')
    .select('tag.value')
    .where('tag_asset.assetId', '=', assetId)
    .execute();
  return rows.map(({ value }) => value).toSorted();
};

const descriptionOf = async (ctx: Context, assetId: string) => {
  const row = await ctx.database
    .selectFrom('asset_exif')
    .select('description')
    .where('assetId', '=', assetId)
    .executeTakeFirst();
  return row?.description ?? '';
};

const changesOf = (ctx: Context, userId: string) => ctx.get(ActivityLogRepository).search(userId, { limit: 100 });

const albumTools = (sut: ActivityLogService) =>
  new Map(
    BaseService.create(AlbumAgentTools, sut)
      .getTools()
      .map((tool) => [tool.name, tool] as [string, AgentTool]),
  );

const newBook = async (ctx: Context, ownerId: string, assetIds: string[]) => {
  const repository = ctx.get(BookRepository);
  const book = await repository.create({
    ownerId,
    title: 'Sicily',
    pageWidthMm: 210,
    pageHeightMm: 210,
    style: defaultBookStyle,
  });
  await repository.replacePages(book.id, [
    { layout: 'cover', sectionTitle: 'Sicily', assets: [{ slot: 0, assetId: assetIds[0] }] },
    {
      layout: 'two-vertical',
      caption: 'Taormina',
      assets: assetIds.slice(1, 3).map((assetId, slot) => ({ slot, assetId, crop: null, caption: null })),
    },
  ]);
  return book;
};

const pagesOf = async (ctx: Context, bookId: string) => {
  const pages = await ctx.get(BookRepository).getPages(bookId);
  return pages.map(({ id, layout, caption, assets }) => ({
    id,
    layout,
    caption,
    assets: assets.map(({ slot, assetId }) => ({ slot, assetId })),
  }));
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ActivityLogService.name, () => {
  describe('albums', () => {
    it('should remove exactly the photos the assistant added, and put back the ones it removed', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const [{ asset: kept }, { asset: added1 }, { asset: added2 }] = await Promise.all([
        ctx.newAsset({ ownerId: user.id }),
        ctx.newAsset({ ownerId: user.id }),
        ctx.newAsset({ ownerId: user.id }),
      ]);
      const { album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Sicily' }, [kept.id]);
      const tools = albumTools(sut);
      const activity = ActivityRecorder.assistant({
        sessionId: null,
        toolName: 'add_to_album',
        groupId: factory.uuid(),
      });

      await tools
        .get('add_to_album')!
        .handler({ auth, sessionId: null, activity }, { albumId: album.id, assetIds: [kept.id, added1.id, added2.id] });
      await expect(albumAssetIds(ctx, album.id)).resolves.toEqual([kept.id, added1.id, added2.id].toSorted());
      const [change] = await changesOf(ctx, user.id);
      expect(change).toMatchObject({
        action: ActivityLogAction.AlbumAddAssets,
        summary: 'Added 2 photos to “Sicily”',
        assetIds: expect.arrayContaining([added1.id, added2.id]),
      });

      const undone = await sut.undo(auth, change.id);

      expect(undone).toMatchObject({ undone: 1, refused: 0 });
      await expect(albumAssetIds(ctx, album.id)).resolves.toEqual([kept.id]);
      const [after] = await changesOf(ctx, user.id);
      expect(after).toMatchObject({ id: change.id, undoneBy: ActivityLogSource.Web });
      expect(after.undoneAt).not.toBeNull();

      // removing and undoing it puts the photo back
      const removal = ActivityRecorder.web();
      await tools
        .get('remove_from_album')!
        .handler({ auth, sessionId: null, activity: removal }, { albumId: album.id, assetIds: [kept.id] });
      await expect(albumAssetIds(ctx, album.id)).resolves.toEqual([]);

      await sut.undo(auth, removal.ids[0]);

      await expect(albumAssetIds(ctx, album.id)).resolves.toEqual([kept.id]);
    });

    it('should delete a new album only while it is unchanged', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const [{ asset: first }, { asset: later }] = await Promise.all([
        ctx.newAsset({ ownerId: user.id }),
        ctx.newAsset({ ownerId: user.id }),
      ]);
      const tools = albumTools(sut);
      const activity = ActivityRecorder.web();
      await tools
        .get('create_album')!
        .handler({ auth, sessionId: null, activity }, { name: 'Picks', assetIds: [first.id] });
      const [created] = await changesOf(ctx, user.id);
      const albumId = created.targetId!;

      // the user added a photo since: the album is kept
      await ctx.newAlbumAsset({ albumId, assetId: later.id });
      const refused = await sut.undo(auth, created.id);
      expect(refused.results[0]).toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: expect.stringContaining('1 photo were added'),
      });
      await expect(ctx.get(AlbumRepository).getById(albumId, { withAssets: false })).resolves.toBeDefined();

      // once it is as it was created, undo deletes it
      await ctx.get(AlbumRepository).removeAssetIds(albumId, [later.id]);
      await expect(sut.undo(auth, created.id)).resolves.toMatchObject({ undone: 1 });
      await expect(ctx.get(AlbumRepository).getById(albumId, { withAssets: false })).resolves.toBeUndefined();
    });

    it('should not let another user undo a change', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const { auth: other } = await newOwner(ctx);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      const activity = ActivityRecorder.web();
      await albumTools(sut)
        .get('add_to_album')!
        .handler({ auth, sessionId: null, activity }, { albumId: album.id, assetIds: [asset.id] });

      await expect(sut.undo(other, activity.ids[0])).rejects.toThrow('Change not found');
      await expect(albumAssetIds(ctx, album.id)).resolves.toEqual([asset.id]);
    });
  });

  describe('copies', () => {
    it('should move a copy to the trash and remove the stack it made', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const { asset: source } = await ctx.newAsset({ ownerId: user.id });
      const { asset: copy } = await ctx.newAsset({ ownerId: user.id });
      const { stack } = await ctx.newStack({ ownerId: user.id }, [source.id, copy.id]);
      const activity = ActivityRecorder.web();
      await sut.record(auth, activity, {
        action: ActivityLogAction.AssetCopy,
        summary: 'Cropped a photo',
        assetIds: [copy.id, source.id],
        undo: { copies: [{ id: copy.id, sourceId: source.id }] },
      });

      await expect(sut.undo(auth, activity.ids[0])).resolves.toMatchObject({ undone: 1 });

      const assets = await ctx.get(ActivityLogRepository).getAssets([source.id, copy.id]);
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      expect(byId.get(copy.id)).toMatchObject({ status: AssetStatus.Trashed, stackId: null });
      expect(byId.get(copy.id)!.deletedAt).not.toBeNull();
      expect(byId.get(source.id)).toMatchObject({ status: AssetStatus.Active, deletedAt: null, stackId: null });
      await expect(ctx.get(StackRepository).getById(stack.id)).resolves.toBeUndefined();
    });

    it('should refuse while the copy is placed in a book', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const { asset: source } = await ctx.newAsset({ ownerId: user.id });
      const { asset: copy } = await ctx.newAsset({ ownerId: user.id });
      const book = await ctx.get(BookRepository).create({
        ownerId: user.id,
        title: 'Sicily',
        pageWidthMm: 210,
        pageHeightMm: 210,
        style: defaultBookStyle,
      });
      await ctx
        .get(BookRepository)
        .replacePages(book.id, [{ layout: 'single', assets: [{ slot: 0, assetId: copy.id }] }]);
      const activity = ActivityRecorder.web();
      await sut.record(auth, activity, {
        action: ActivityLogAction.AssetCopy,
        summary: 'Cropped a photo',
        undo: { copies: [{ id: copy.id, sourceId: source.id }] },
      });

      const { results } = await sut.undo(auth, activity.ids[0]);

      expect(results[0]).toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: expect.stringContaining('“Sicily” (page 1)'),
      });
      const [after] = await ctx.get(ActivityLogRepository).getAssets([copy.id]);
      expect(after.deletedAt).toBeNull();
    });
  });

  describe('collection names', () => {
    it('should give the photos back their tags and descriptions', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const { asset: renamed } = await ctx.newAsset({ ownerId: user.id });
      const { asset: fresh } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: renamed.id, description: 'Pasta · Old name' });
      await ctx.newExif({ assetId: fresh.id, description: '' });
      const { tag } = await ctx.newTag({ userId: user.id, value: 'Food/Old name/Pasta' });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [renamed.id] });
      const activity = ActivityRecorder.web();

      await BaseService.create(CollectionService, sut).saveEntries(
        auth,
        'food',
        {
          place: 'Nino',
          photos: [
            { id: renamed.id, entry: 'Norma' },
            { id: fresh.id, entry: 'Carbonara' },
          ],
        },
        activity,
      );
      await expect(tagsOf(ctx, renamed.id)).resolves.toEqual(['Food/Nino/Norma']);
      await expect(descriptionOf(ctx, renamed.id)).resolves.toBe('Norma · Nino');
      await expect(descriptionOf(ctx, fresh.id)).resolves.toBe('Carbonara · Nino');

      await expect(sut.undo(auth, activity.ids[0])).resolves.toMatchObject({ undone: 1, refused: 0 });

      await expect(tagsOf(ctx, renamed.id)).resolves.toEqual(['Food/Old name/Pasta']);
      await expect(tagsOf(ctx, fresh.id)).resolves.toEqual([]);
      await expect(descriptionOf(ctx, renamed.id)).resolves.toBe('Pasta · Old name');
      await expect(descriptionOf(ctx, fresh.id)).resolves.toBe('');
    });
  });

  describe('books', () => {
    it('should restore a book from its snapshot, and undo later edits first', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const assets = await Promise.all([1, 2, 3, 4].map(() => ctx.newAsset({ ownerId: user.id })));
      const [a, b, c, d] = assets.map(({ asset }) => asset.id);
      const book = await newBook(ctx, user.id, [a, b, c]);
      const repository = ctx.get(BookRepository);
      const original = await pagesOf(ctx, book.id);
      const groupId = factory.uuid();

      // first edit: a new page with photo d
      const first = ActivityRecorder.assistant({ sessionId: null, toolName: 'add_page', groupId });
      const firstChange = await sut.beginBookChange(first, book.id);
      const page = await repository.addPage(book.id, { layout: 'single' });
      await repository.upsertSlot(book.id, { pageId: page.id, slot: 0, assetId: d });
      await firstChange!.finish(auth, { summary: (title) => `Added a page to “${title}”` });

      // second edit: the caption and the title change
      const second = ActivityRecorder.assistant({ sessionId: null, toolName: 'set_caption', groupId });
      const secondChange = await sut.beginBookChange(second, book.id);
      await repository.updatePage(book.id, original[1].id, { caption: 'Taormina, 2009' });
      await repository.update(book.id, { title: 'Sicily 2009' });
      await secondChange!.finish(auth, { summary: (title) => `Changed a caption on page 2 of “${title}”` });

      // the first edit can't be undone while the second one depends on it
      const refused = await sut.undo(auth, first.ids[0]);
      expect(refused.results[0]).toMatchObject({
        status: ActivityUndoStatus.Refused,
        message: 'The book “Sicily 2009” was changed again after this: undo the later changes first',
      });

      // undoing the turn undoes the second edit, then the first
      const response = await sut.undoAll(auth, { groupId });
      expect(response.results.map(({ id }) => id)).toEqual([second.ids[0], first.ids[0]]);
      expect(response).toMatchObject({ undone: 2, refused: 0 });

      await expect(pagesOf(ctx, book.id)).resolves.toEqual(original);
      await expect(repository.get(book.id)).resolves.toMatchObject({ title: 'Sicily' });
      const revisions = await ctx.database
        .selectFrom('book_revision')
        .select('id')
        .where('bookId', '=', book.id)
        .execute();
      expect(revisions).toHaveLength(2);
    });
  });
  describe('retention', () => {
    it('should keep the newest revisions of a book, and drop old changes', async () => {
      const { ctx } = setup();
      const { user } = await newOwner(ctx);
      const repository = ctx.get(ActivityLogRepository);
      const book = await ctx.get(BookRepository).create({
        ownerId: user.id,
        title: 'Sicily',
        pageWidthMm: 210,
        pageHeightMm: 210,
        style: defaultBookStyle,
      });
      const snapshot = (await snapshotBook(ctx.get(BookRepository), book.id))!;
      const revisions = [];
      for (let i = 0; i < 4; i++) {
        revisions.push(await repository.createRevision(book.id, { ...snapshot, title: `Version ${i}` }));
      }

      await repository.pruneRevisions(book.id, 2);

      await expect(repository.getRevision(revisions[0].id)).resolves.toBeUndefined();
      await expect(repository.getRevision(revisions[1].id)).resolves.toBeUndefined();
      await expect(repository.getRevision(revisions[3].id)).resolves.toMatchObject({
        snapshot: { title: 'Version 3' },
      });

      const old = await repository.create({
        userId: user.id,
        source: ActivityLogSource.Web,
        action: ActivityLogAction.SharedLinkCreate,
        summary: 'Old',
        groupId: factory.uuid(),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      const recent = await repository.create({
        userId: user.id,
        source: ActivityLogSource.Web,
        action: ActivityLogAction.SharedLinkCreate,
        summary: 'Recent',
        groupId: factory.uuid(),
      });

      await expect(repository.deleteOlderThan(new Date('2021-01-01T00:00:00.000Z'))).resolves.toBe(1);
      await expect(repository.getByIds(user.id, [old.id, recent.id])).resolves.toEqual([
        expect.objectContaining({ id: recent.id }),
      ]);
    });
  });
});

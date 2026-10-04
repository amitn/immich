import { Kysely } from 'kysely';
import {
  ActivityLogAction,
  ActivityUndoStatus,
  AssetStatus,
  AssetVisibility,
  BurstGroupSource,
  BurstKeepReason,
} from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { BurstAgentTools } from 'src/services/agent-tools/burst.tools.js';
import { BaseService } from 'src/services/base.service.js';
import { BurstService } from 'src/services/burst.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// #9: burst cleanup keeps the best photo of each group of near-identical photos and archives the others, undoably

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(BurstService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      ActivityLogRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetJobRepository,
      AssetRepository,
      ConfigRepository,
      MediaRepository,
      PartnerRepository,
      SearchRepository,
      SharedSpaceRepository,
      StackRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, StorageRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  return { sut, ctx };
};

type Context = ReturnType<typeof setup>['ctx'];

const START = new Date('2026-06-01T10:00:00.000Z').getTime();
const at = (seconds: number) => new Date(START + seconds * 1000);

/** a unit vector along one of the 512 dimensions: the same axis is the same scene, another axis another one */
const axis = (index: number) => `[${Array.from({ length: 512 }, (_, i) => (i === index ? 1 : 0)).join(',')}]`;

const newOwner = async (ctx: Context) => {
  const { user } = await ctx.newUser();
  return { user, auth: factory.auth({ user }) };
};

const newPhoto = async (
  ctx: Context,
  ownerId: string,
  options: {
    seconds: number;
    name?: string;
    width?: number;
    height?: number;
    duplicateId?: string;
    isEdited?: boolean;
    visibility?: AssetVisibility;
    embedding?: number;
  },
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    originalFileName: options.name ?? 'IMG.jpg',
    fileCreatedAt: at(options.seconds),
    localDateTime: at(options.seconds),
    width: options.width ?? 4000,
    height: options.height ?? 3000,
    duplicateId: options.duplicateId ?? null,
    isEdited: options.isEdited ?? false,
    visibility: options.visibility ?? AssetVisibility.Timeline,
  });
  await ctx.newExif({ assetId: asset.id, fileSizeInByte: 3_000_000 });
  if (options.embedding !== undefined) {
    await ctx.database
      .insertInto('smart_search')
      .values({ assetId: asset.id, embedding: axis(options.embedding) })
      .execute();
  }
  return asset;
};

const visibilityOf = async (ctx: Context, ids: string[]) => {
  const rows = await ctx.database.selectFrom('asset').select(['id', 'visibility']).where('id', 'in', ids).execute();
  return Object.fromEntries(ids.map((id) => [id, rows.find((row) => row.id === id)?.visibility]));
};

const primaryOf = async (ctx: Context, stackId: string) => {
  const row = await ctx.database
    .selectFrom('stack')
    .select('primaryAssetId')
    .where('id', '=', stackId)
    .executeTakeFirst();
  return row?.primaryAssetId;
};

const activityLog = (sut: BurstService) => BaseService.create(ActivityLogService, sut);

/** a library with a duplicate group, a stack, a stack of a copy, a burst and a photo of its own */
const newLibrary = async (ctx: Context, ownerId: string) => {
  const duplicateId = factory.uuid();
  // the duplicate detection found these: a large JPEG and a smaller RAW of the same moment
  const jpeg = await newPhoto(ctx, ownerId, { seconds: 0, name: 'IMG_1.jpg', width: 8000, height: 6000, duplicateId });
  const raw = await newPhoto(ctx, ownerId, { seconds: 60, name: 'IMG_1.dng', duplicateId });
  // archived before: not a candidate any more
  const archived = await newPhoto(ctx, ownerId, { seconds: 61, duplicateId, visibility: AssetVisibility.Archive });

  // a stack the user made, of which one photo was edited in the app
  const stackFirst = await newPhoto(ctx, ownerId, { seconds: 600, width: 6000 });
  const stackEdited = await newPhoto(ctx, ownerId, { seconds: 601, isEdited: true });
  const { stack } = await ctx.newStack({ ownerId }, [stackFirst.id, stackEdited.id]);

  // a crop made by the assistant, stacked with its original: versions kept on purpose
  const original = await newPhoto(ctx, ownerId, { seconds: 1200, embedding: 9 });
  const crop = await newPhoto(ctx, ownerId, { seconds: 1200, name: 'IMG-crop.jpg', embedding: 9 });
  await ctx.newStack({ ownerId }, [original.id, crop.id]);
  const { tag } = await ctx.newTag({ userId: ownerId, value: 'Edits/Cropped' });
  await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [crop.id] });

  // a burst: two photos of the same scene within a second, then another scene a second later
  const burstA = await newPhoto(ctx, ownerId, { seconds: 1800, embedding: 1 });
  const burstB = await newPhoto(ctx, ownerId, { seconds: 1800.5, width: 4000, height: 2000, embedding: 1 });
  const other = await newPhoto(ctx, ownerId, { seconds: 1801, embedding: 2 });

  return { duplicateId, jpeg, raw, archived, stack, stackFirst, stackEdited, original, crop, burstA, burstB, other };
};

/** an album of a friend shared with the user: a burst of a photo of each, and a burst of the friend's photos only */
const newSharedAlbumBurst = async (ctx: Context) => {
  const { user, auth } = await newOwner(ctx);
  const { user: friend } = await ctx.newUser();
  const mine = await newPhoto(ctx, user.id, { seconds: 0, embedding: 1 });
  const theirs = await newPhoto(ctx, friend.id, { seconds: 1, embedding: 1, width: 8000, height: 6000 });
  const theirsA = await newPhoto(ctx, friend.id, { seconds: 100, embedding: 2 });
  const theirsB = await newPhoto(ctx, friend.id, { seconds: 100, embedding: 2 });
  const { album } = await ctx.newAlbum({ ownerId: friend.id }, [mine.id, theirs.id, theirsA.id, theirsB.id]);
  await ctx.newAlbumUser({ albumId: album.id, userId: user.id });
  return { auth, album, mine, theirs, theirsA, theirsB };
};

describe(BurstService.name, () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
  });

  describe('search', () => {
    it('should find the duplicate groups, the stacks and the bursts, newest first', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const library = await newLibrary(ctx, user.id);
      const { user: stranger } = await ctx.newUser();
      await newPhoto(ctx, stranger.id, { seconds: 1800, embedding: 1 });
      await newPhoto(ctx, stranger.id, { seconds: 1800, embedding: 1 });

      const result = await sut.search(auth, {});

      expect(result).toMatchObject({ total: 3, totalToArchive: 3, hasNextPage: false, truncated: false });
      expect(result.scanned).toBe(9);
      expect(
        result.groups.map(({ source, assets }) => ({ source, ids: assets.map(({ assetId }) => assetId).toSorted() })),
      ).toEqual([
        { source: BurstGroupSource.Burst, ids: [library.burstA.id, library.burstB.id].toSorted() },
        { source: BurstGroupSource.Stack, ids: [library.stackFirst.id, library.stackEdited.id].toSorted() },
        { source: BurstGroupSource.Duplicate, ids: [library.jpeg.id, library.raw.id].toSorted() },
      ]);
      const [burst, stack, duplicate] = result.groups;
      expect(burst).toMatchObject({ key: `burst:${library.burstA.id}`, readOnly: false });
      expect(stack).toMatchObject({ stackId: library.stack.id, duplicateId: null });
      expect(duplicate).toMatchObject({ duplicateId: library.duplicateId, stackId: null });
    });

    it('should rank with the rules first, and say why', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const library = await newLibrary(ctx, user.id);

      const byDefault = await sut.search(auth, {});
      const [burst, stack, duplicate] = byDefault.groups;
      // edited photos are preferred by default
      expect(stack).toMatchObject({
        keepAssetId: library.stackEdited.id,
        reasons: [BurstKeepReason.Edited],
        archiveAssetIds: [library.stackFirst.id],
      });
      // the photos look alike (no previews here), so the larger one wins
      expect(burst).toMatchObject({ keepAssetId: library.burstA.id, reasons: [BurstKeepReason.Largest] });
      expect(duplicate).toMatchObject({ keepAssetId: library.jpeg.id, archiveAssetIds: [library.raw.id] });
      expect(duplicate.assets.map(({ assetId, isRaw }) => ({ assetId, isRaw }))).toEqual([
        { assetId: library.jpeg.id, isRaw: false },
        { assetId: library.raw.id, isRaw: true },
      ]);

      const preferRaw = await sut.search(auth, { rules: { preferRaw: true, preferEdited: false } });
      expect(preferRaw.groups[2]).toMatchObject({ keepAssetId: library.raw.id, reasons: [BurstKeepReason.Raw] });
      expect(preferRaw.groups[1].keepAssetId).toBe(library.stackFirst.id);

      const preferLargest = await sut.search(auth, { rules: { preferRaw: true, preferLargest: true } });
      // RAW comes before largest
      expect(preferLargest.groups[2].keepAssetId).toBe(library.raw.id);
    });

    it('should page through the groups', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const library = await newLibrary(ctx, user.id);

      const first = await sut.search(auth, { size: 2 });
      const second = await sut.search(auth, { size: 2, page: 2 });

      expect(first).toMatchObject({ total: 3, hasNextPage: true });
      expect(first.groups).toHaveLength(2);
      expect(second).toMatchObject({ total: 3, hasNextPage: false });
      expect(second.groups.map(({ duplicateId }) => duplicateId)).toEqual([library.duplicateId]);
    });

    it('should keep to a date range', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const library = await newLibrary(ctx, user.id);

      const result = await sut.search(auth, { takenAfter: at(1700), takenBefore: at(1900) });

      expect(result.groups.map(({ keepAssetId }) => keepAssetId)).toEqual([library.burstA.id]);
      expect(result.scanned).toBe(3);
    });
  });

  describe('clean', () => {
    it('should keep the photo of each group, archive the others, and undo it', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const library = await newLibrary(ctx, user.id);
      const { groups } = await sut.search(auth, { rules: { preferRaw: true } });
      const toClean = groups.map(({ assets, keepAssetId }) => ({
        assetIds: assets.map(({ assetId }) => assetId),
        keepAssetId,
      }));

      const dryRun = await sut.clean(auth, { groups: toClean, dryRun: true }, ActivityRecorder.web());
      expect(dryRun).toMatchObject({ dryRun: true, archived: 3, activityId: null });
      expect(await ctx.get(ActivityLogRepository).search(user.id, { limit: 10 })).toEqual([]);

      const result = await sut.clean(auth, { groups: toClean }, ActivityRecorder.web());

      expect(result).toMatchObject({ dryRun: false, archived: 3 });
      const archivedIds = [library.burstB.id, library.stackFirst.id, library.jpeg.id];
      const keptIds = [library.burstA.id, library.stackEdited.id, library.raw.id];
      expect(await visibilityOf(ctx, [...archivedIds, ...keptIds])).toEqual({
        ...Object.fromEntries(archivedIds.map((id) => [id, AssetVisibility.Archive])),
        ...Object.fromEntries(keptIds.map((id) => [id, AssetVisibility.Timeline])),
      });
      // the kept photo heads its stack, which would otherwise be hidden with its archived head
      expect(await primaryOf(ctx, library.stack.id)).toBe(library.stackEdited.id);
      // nothing was trashed, and the duplicate group is left as it is
      const raw = await ctx.database
        .selectFrom('asset')
        .selectAll()
        .where('id', '=', library.jpeg.id)
        .executeTakeFirstOrThrow();
      expect(raw).toMatchObject({ deletedAt: null, status: AssetStatus.Active, duplicateId: library.duplicateId });

      const [change] = await ctx.get(ActivityLogRepository).search(user.id, { limit: 10 });
      expect(change).toMatchObject({
        id: result.activityId,
        action: ActivityLogAction.BurstCleanup,
        summary: 'Kept the best photo of 3 bursts and archived 3 photos',
      });
      expect(change.assetIds.toSorted()).toEqual(archivedIds.toSorted());

      // the groups are gone from the review, until the cleanup is undone
      const afterCleanup = await sut.search(auth, {});
      expect(afterCleanup.total).toBe(0);

      const undo = await activityLog(sut).undo(auth, change.id);
      expect(undo.results[0]).toMatchObject({ status: ActivityUndoStatus.Undone, warnings: [] });
      expect(Object.values(await visibilityOf(ctx, [...archivedIds, ...keptIds]))).toEqual(
        Array.from({ length: 6 }, () => AssetVisibility.Timeline),
      );
      expect(await primaryOf(ctx, library.stack.id)).toBe(library.stackFirst.id);
      // the photo archived before the cleanup stays archived
      expect(await visibilityOf(ctx, [library.archived.id])).toEqual({
        [library.archived.id]: AssetVisibility.Archive,
      });
      const afterUndo = await sut.search(auth, {});
      expect(afterUndo.total).toBe(3);

      // and redone
      await activityLog(sut).redo(auth, change.id);
      expect(Object.values(await visibilityOf(ctx, archivedIds))).toEqual(
        Array.from({ length: 3 }, () => AssetVisibility.Archive),
      );
      expect(await primaryOf(ctx, library.stack.id)).toBe(library.stackEdited.id);
    });

    it('should undo only what is still archived', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const a = await newPhoto(ctx, user.id, { seconds: 0, embedding: 1 });
      const b = await newPhoto(ctx, user.id, { seconds: 1, embedding: 1 });
      const c = await newPhoto(ctx, user.id, { seconds: 2, embedding: 1 });
      const d = await newPhoto(ctx, user.id, { seconds: 2.5, embedding: 1 });
      const result = await sut.clean(
        auth,
        { groups: [{ assetIds: [a.id, b.id, c.id, d.id], keepAssetId: a.id }] },
        ActivityRecorder.web(),
      );
      expect(result.archived).toBe(3);

      // since then, one was trashed and one put back on the timeline by hand
      await ctx.database
        .updateTable('asset')
        .set({ deletedAt: new Date(), status: AssetStatus.Trashed })
        .where('id', '=', b.id)
        .execute();
      await ctx.database
        .updateTable('asset')
        .set({ visibility: AssetVisibility.Timeline })
        .where('id', '=', c.id)
        .execute();

      const undo = await activityLog(sut).undo(auth, result.activityId!);

      expect(undo.results[0].status).toBe(ActivityUndoStatus.Undone);
      expect(undo.results[0].warnings).toEqual([
        '1 photo was deleted since',
        '1 photo was no longer in the archive, so it was left as it is',
      ]);
      expect(await visibilityOf(ctx, [b.id, c.id, d.id])).toEqual({
        [b.id]: AssetVisibility.Archive,
        [c.id]: AssetVisibility.Timeline,
        [d.id]: AssetVisibility.Timeline,
      });
    });

    it('should never archive the head of a stack the kept photo is not in', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const keep = await newPhoto(ctx, user.id, { seconds: 0 });
      const head = await newPhoto(ctx, user.id, { seconds: 1 });
      const member = await newPhoto(ctx, user.id, { seconds: 2 });
      const plain = await newPhoto(ctx, user.id, { seconds: 3 });
      await ctx.newStack({ ownerId: user.id }, [head.id, member.id]);

      const result = await sut.clean(auth, {
        groups: [{ assetIds: [keep.id, head.id, plain.id], keepAssetId: keep.id }],
      });

      expect(result.groups).toEqual([{ keepAssetId: keep.id, archivedAssetIds: [plain.id] }]);
      expect(await visibilityOf(ctx, [head.id, plain.id])).toEqual({
        [head.id]: AssetVisibility.Timeline,
        [plain.id]: AssetVisibility.Archive,
      });
    });
  });

  describe('photos of others (#21)', () => {
    it('should show a group with photos of others read-only, and leave groups of others out', async () => {
      const { sut, ctx } = setup();
      const { auth, album, mine, theirs } = await newSharedAlbumBurst(ctx);

      const result = await sut.search(auth, { albumId: album.id });

      expect(result).toMatchObject({ total: 1, totalToArchive: 0 });
      expect(result.groups[0]).toMatchObject({ readOnly: true, archiveAssetIds: [], keepAssetId: theirs.id });
      expect(result.groups[0].assets.map(({ assetId, isOwned }) => ({ assetId, isOwned }))).toEqual([
        { assetId: theirs.id, isOwned: false },
        { assetId: mine.id, isOwned: true },
      ]);
    });

    it('should never archive the photos of others', async () => {
      const { sut, ctx } = setup();
      const { auth, mine, theirs, theirsA, theirsB } = await newSharedAlbumBurst(ctx);

      const result = await sut.clean(
        auth,
        {
          groups: [
            { assetIds: [mine.id, theirs.id], keepAssetId: mine.id },
            { assetIds: [theirsA.id, theirsB.id], keepAssetId: theirsA.id },
          ],
        },
        ActivityRecorder.web(),
      );

      expect(result).toMatchObject({ archived: 0, activityId: null });
      expect(result.groups.map(({ error }) => error)).toEqual([
        'Some of the photos belong to someone else, so the group is left as it is',
        'Some of the photos belong to someone else, so the group is left as it is',
      ]);
      expect(Object.values(await visibilityOf(ctx, [mine.id, theirs.id, theirsA.id, theirsB.id]))).toEqual(
        Array.from({ length: 4 }, () => AssetVisibility.Timeline),
      );
    });

    it('should not show the bursts of an album the user can not see', async () => {
      const { sut, ctx } = setup();
      const { album } = await newSharedAlbumBurst(ctx);
      const { auth: stranger } = await newOwner(ctx);

      await expect(sut.search(stranger, { albumId: album.id })).rejects.toThrow();
    });
  });

  describe('assistant tools', () => {
    it('should find the bursts of a trip and clean them up, recorded for undo', async () => {
      const { sut, ctx } = setup();
      const { user, auth } = await newOwner(ctx);
      const library = await newLibrary(ctx, user.id);
      const tools = new Map(
        BaseService.create(BurstAgentTools, sut)
          .getTools()
          .map((tool) => [tool.name, tool]),
      );
      const scope = { takenAfter: at(1700).toISOString(), takenBefore: at(1900).toISOString() };

      const found = await tools
        .get('find_bursts')!
        .handler({ auth, sessionId: null }, tools.get('find_bursts')!.input.parse(scope));
      expect(JSON.parse((found.content[0] as { text: string }).text)).toMatchObject({
        total: 1,
        wouldArchive: 1,
        groups: [{ keepAssetId: library.burstA.id, archiveAssetIds: [library.burstB.id], source: 'burst' }],
      });

      const activity = ActivityRecorder.assistant({
        sessionId: null,
        toolName: 'clean_up_bursts',
        groupId: factory.uuid(),
      });
      const cleaned = await tools
        .get('clean_up_bursts')!
        .handler({ auth, sessionId: null, activity }, tools.get('clean_up_bursts')!.input.parse(scope));
      expect(JSON.parse((cleaned.content[0] as { text: string }).text)).toEqual({
        archived: 1,
        groups: 1,
        keptAssetIds: [library.burstA.id],
      });
      expect(activity.ids).toHaveLength(1);
      expect(await visibilityOf(ctx, [library.burstB.id, library.jpeg.id])).toEqual({
        [library.burstB.id]: AssetVisibility.Archive,
        [library.jpeg.id]: AssetVisibility.Timeline,
      });

      await activityLog(sut).undoAll(auth, { groupId: activity.origin.groupId });
      expect(await visibilityOf(ctx, [library.burstB.id])).toEqual({ [library.burstB.id]: AssetVisibility.Timeline });
    });
  });
});

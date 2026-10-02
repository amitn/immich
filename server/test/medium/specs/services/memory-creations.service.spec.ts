import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { defaults } from 'src/dtos/config.dto.js';
import { AssetFileType, AssetType, AssetVisibility, MemoryType } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { BookDraftRepository } from 'src/repositories/book-draft.repository.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { HighlightJobRepository } from 'src/repositories/highlight-job.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { NotificationRepository } from 'src/repositories/notification.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { BookDraftService } from 'src/services/book-draft.service.js';
import { BookService } from 'src/services/book.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { ASSET_CAP, RecentTripMemoryRule } from 'src/services/memory-rules/recent-trip.rule.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) =>
  newMediumService(HighlightService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetJobRepository,
      AssetRepository,
      BookDraftRepository,
      BookRepository,
      ConfigRepository,
      HighlightJobRepository,
      MemoryRepository,
      SearchRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [
      ActivityLogRepository,
      JobRepository,
      LoggingRepository,
      NotificationRepository,
      StorageRepository,
      WebsocketRepository,
    ],
  });

type Context = ReturnType<typeof setup>['ctx'];

const HOME = { city: 'Tel Aviv', country: 'Israel' };
const ATHENS = { city: 'Athens', country: 'Greece' };
/** the day the memory is made: the trip ended a week before */
const TARGET = DateTime.fromISO('2026-09-28T00:00:00.000Z', { zone: 'utc' });

const authOf = (user: { id: string; name: string; email: string }): AuthDto => ({
  user: {
    id: user.id,
    isAdmin: false,
    name: user.name,
    email: user.email,
    quotaUsageInBytes: 0,
    quotaSizeInBytes: null,
  },
});

const seedAsset = async (
  ctx: Context,
  ownerId: string,
  localDateTime: string,
  place: { city: string; country: string } | null,
  type = AssetType.Image,
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    localDateTime,
    fileCreatedAt: localDateTime,
    type,
    visibility: AssetVisibility.Timeline,
    ...(type === AssetType.Video && { duration: 4000 }),
  });
  await ctx.newExif({
    assetId: asset.id,
    city: place?.city ?? null,
    country: place?.country ?? null,
    exifImageWidth: 4000,
    exifImageHeight: 3000,
  });
  await ctx.get(AssetRepository).upsertFiles([
    { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
    { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
  ]);
  return asset;
};

/**
 * A user who lives in Tel Aviv (photos there through the summer) and spent 12–19 September 2026 in Athens: 6 photos
 * a day for 8 days, a video, and an evening photo without a location, far more than the 10 a memory shows
 */
const seedTrip = async (ctx: Context) => {
  const { user } = await ctx.newUser();
  for (let day = 0; day < 40; day++) {
    const date = DateTime.fromISO('2026-06-01T12:00:00.000Z', { zone: 'utc' }).plus({ days: day * 2 });
    await seedAsset(ctx, user.id, date.toISO()!, HOME);
  }

  const trip: string[] = [];
  for (let day = 0; day < 8; day++) {
    for (let hour = 0; hour < 6; hour++) {
      const date = DateTime.fromISO('2026-09-12T08:00:00.000Z', { zone: 'utc' }).plus({ days: day, hours: hour * 2 });
      const asset = await seedAsset(ctx, user.id, date.toISO()!, ATHENS);
      trip.push(asset.id);
    }
  }
  const video = await seedAsset(ctx, user.id, '2026-09-14T19:00:00.000Z', ATHENS, AssetType.Video);
  const unlocated = await seedAsset(ctx, user.id, '2026-09-19T22:30:00.000Z', null);
  // after the trip, at home
  const after = await seedAsset(ctx, user.id, '2026-09-22T12:00:00.000Z', HOME);

  // the memory the rule engine makes of it, persisted the way MemoryService does
  const rule = new RecentTripMemoryRule(ctx.get(AssetRepository), ctx.get(MemoryRepository));
  const [candidate] = await rule.evaluate({ ownerId: user.id, target: TARGET });
  expect(candidate).toBeDefined();
  const memory = await ctx.get(MemoryRepository).create(
    {
      ownerId: user.id,
      type: MemoryType.Rule,
      data: { ruleId: candidate.ruleId, dedupeKey: candidate.dedupeKey, context: candidate.context },
      memoryAt: candidate.memoryAt.toISO()!,
      showAt: TARGET.startOf('day').toISO()!,
      hideAt: TARGET.plus({ days: 6 }).endOf('day').toISO()!,
    },
    new Set(candidate.assetIds),
  );

  return { user, auth: authOf(user), memory, trip, video: video.id, unlocated: unlocated.id, after: after.id };
};

describe('memory creations (#5)', () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
  });

  it('should make a highlight video of every photo and video of a recent trip, not only the memory’s', async () => {
    const { sut, ctx } = setup();
    const { auth, memory, trip, video, unlocated, after } = await seedTrip(ctx);
    expect(memory.assets).toHaveLength(ASSET_CAP);
    ctx.getMock(JobRepository).queue.mockResolvedValue();

    const job = await sut.create(auth, { memoryId: memory.id, format: 'vertical' });

    expect(job).toMatchObject({ title: 'Recent trip to Athens, Greece', memoryId: memory.id, format: 'vertical' });
    const row = await ctx.get(HighlightJobRepository).get(job.id);
    const assetIds = new Set(row!.options.assetIds);
    expect(trip.every((id) => assetIds.has(id))).toBe(true);
    expect(assetIds.has(video)).toBe(true);
    expect(assetIds.has(unlocated)).toBe(true);
    expect(assetIds.has(after)).toBe(false);
    expect(assetIds.size).toBe(trip.length + 2);
  });

  it('should lay out a book of the whole trip window, titled like the memory, with a map', async () => {
    const { ctx } = setup();
    const books = ctx.getService(BookService);
    const { auth, memory, trip, unlocated, after } = await seedTrip(ctx);

    const book = await books.createFromMemory(auth, { memoryId: memory.id, considerImprovements: false });

    expect(book).toMatchObject({ title: 'Recent trip to Athens, Greece', subtitle: '12–19 September 2026' });
    const pages = await ctx.get(BookRepository).getPages(book.id);
    const placed = new Set(pages.flatMap((page) => page.assets.map(({ assetId }) => assetId)));
    // far beyond the 10 photos of the memory: the first and the last day of the trip are in the book
    expect(placed.size).toBeGreaterThan(ASSET_CAP);
    const placedTrip = trip.filter((id) => placed.has(id));
    expect(placedTrip).toContain(trip[0]);
    expect(placed.has(trip.at(-1)!) || placed.has(unlocated)).toBe(true);
    expect(placed.has(after)).toBe(false);
  });

  it('should base the trip draft on the memory, and record which memory it is', async () => {
    const { ctx } = setup();
    const drafts = ctx.getService(BookDraftService);
    const { auth, memory, trip } = await seedTrip(ctx);

    const keys = await drafts.draftBooks(auth, { ...defaults.books.drafts, yearly: false }, TARGET.toJSDate());

    // the timeline finds the same trip, so its key is kept and the trip is suggested once
    expect(keys).toEqual(['trip:2026-09-12']);
    const [draft] = await ctx.get(BookDraftRepository).getPending(auth.user.id);
    expect(draft).toMatchObject({ key: 'trip:2026-09-12', memoryId: memory.id, title: 'Our trip to Athens' });
    const pages = await ctx.get(BookRepository).getPages(draft.bookId!);
    const placed = pages.flatMap((page) => page.assets.map(({ assetId }) => assetId));
    expect(placed).toContain(trip[0]);

    // deleting the memory keeps the suggestion
    await ctx.get(MemoryRepository).delete(memory.id);
    const [kept] = await ctx.get(BookDraftRepository).getPending(auth.user.id);
    expect(kept).toMatchObject({ id: draft.id, memoryId: null });
  });

  it('should only let the owner of a memory make something of it', async () => {
    const { sut, ctx } = setup();
    const books = ctx.getService(BookService);
    const { memory } = await seedTrip(ctx);
    const { user: other } = await ctx.newUser();

    await expect(sut.create(authOf(other), { memoryId: memory.id })).rejects.toBeInstanceOf(BadRequestException);
    await expect(books.createFromMemory(authOf(other), { memoryId: memory.id })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await ctx.get(HighlightJobRepository).getAll(other.id)).toEqual([]);
  });
});

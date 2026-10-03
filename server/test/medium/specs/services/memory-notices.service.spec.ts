import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { defaults } from 'src/dtos/config.dto.js';
import {
  AssetFileType,
  AssetVisibility,
  BookDraftKind,
  BookStatus,
  JobName,
  MemoryExclusionType,
  MemoryType,
  NotificationType,
  UserMetadataKey,
} from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { BookDraftRepository } from 'src/repositories/book-draft.repository.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { CollectionNoticeRepository } from 'src/repositories/collection-notice.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EmailRepository } from 'src/repositories/email.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MemoryExclusionRepository } from 'src/repositories/memory-exclusion.repository.js';
import { MemoryNoticeRepository } from 'src/repositories/memory-notice.repository.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { NotificationRepository } from 'src/repositories/notification.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { MemoryNoticeService } from 'src/services/memory-notice.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const result = newMediumService(MemoryNoticeService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetRepository,
      BookDraftRepository,
      BookRepository,
      CollectionNoticeRepository,
      ConfigRepository,
      DatabaseRepository,
      MemoryExclusionRepository,
      MemoryNoticeRepository,
      MemoryRepository,
      NotificationRepository,
      PartnerRepository,
      PersonRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [EmailRepository, EventRepository, JobRepository, LoggingRepository, WebsocketRepository],
  });
  result.ctx.getMock(EventRepository).emit.mockResolvedValue();
  result.ctx.getMock(JobRepository).queue.mockResolvedValue();
  result.ctx.getMock(EmailRepository).renderEmail.mockResolvedValue({ html: '<html>', text: 'text' });
  return result;
};

type Context = ReturnType<typeof setup>['ctx'];

const byId = (a: string, b: string) => a.localeCompare(b);

// Saturday 3 October 2026, 10:00 in London
const NOW = new Date('2026-10-03T09:00:00Z');
const TODAY = DateTime.fromISO('2026-10-03T00:00:00Z', { zone: 'utc' });
const smtpOn = { ...defaults.notifications, smtp: { ...defaults.notifications.smtp, enabled: true } };

const seedPhoto = async (ctx: Context, ownerId: string, localDateTime: string) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    localDateTime,
    fileCreatedAt: localDateTime,
    visibility: AssetVisibility.Timeline,
  });
  await Promise.all([
    ctx.newExif({ assetId: asset.id, city: 'Lisbon', country: 'Portugal' }),
    ctx.newJobStatus({ assetId: asset.id }),
    ctx.get(AssetRepository).upsertFiles([
      { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
      { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
    ]),
  ]);
  return asset;
};

/** a memory shown today, with photos of `year` */
const seedMemory = async (
  ctx: Context,
  ownerId: string,
  {
    year = 2023,
    photos = 3,
    ...memory
  }: { year?: number; photos?: number; type?: MemoryType; data?: Record<string, unknown> },
) => {
  const assets = [];
  for (let index = 0; index < photos; index++) {
    assets.push(await seedPhoto(ctx, ownerId, `${year}-10-03T1${index}:00:00Z`));
  }
  const { memory: created } = await ctx.newMemory({
    ownerId,
    type: MemoryType.OnThisDay,
    data: { year },
    memoryAt: new Date(`${year}-10-03T00:00:00Z`),
    showAt: TODAY.startOf('day').toJSDate(),
    hideAt: TODAY.endOf('day').toJSDate(),
    ...memory,
  });
  for (const asset of assets) {
    await ctx.newMemoryAsset({ memoryId: created.id!, assetId: asset.id });
  }
  return { memory: created, assets };
};

const newUser = async (ctx: Context, memoryNotifications: Record<string, unknown> = {}) => {
  const { user } = await ctx.newUser();
  await ctx.get(UserRepository).upsertMetadata(user.id, {
    key: UserMetadataKey.Preferences,
    value: { memoryNotifications: { timeZone: 'Europe/London', ...memoryNotifications } },
  });
  return (await ctx.get(UserRepository).get(user.id, {}))!;
};

const notificationsOf = (ctx: Context, userId: string) =>
  ctx.database.selectFrom('notification').selectAll().where('userId', '=', userId).execute();

describe('memory notifications (#6)', () => {
  beforeEach(async () => {
    defaultDatabase = await getKyselyDB();
  });

  afterEach(async () => {
    await defaultDatabase.destroy();
  });

  it("notifies the day's best memory once, and at most one notification a day", async () => {
    const { sut, ctx } = setup();
    const user = await newUser(ctx);
    await seedMemory(ctx, user.id, { year: 2020, photos: 4 });
    const { memory: anniversary } = await seedMemory(ctx, user.id, {
      type: MemoryType.Rule,
      data: { ruleId: 'trip_anniversary', dedupeKey: 'k', score: 150, context: { placeLabel: 'Lisbon', yearsAgo: 3 } },
    });

    const { notice } = await sut.sendNotices(user, defaults, NOW);
    expect(notice).toMatchObject({ kind: 'memory', data: { memoryId: anniversary.id } });

    const [notification] = await notificationsOf(ctx, user.id);
    expect(notification).toMatchObject({ type: NotificationType.Custom, title: 'A trip anniversary' });
    // stored as JSON text, like the other notifications of the fork
    expect(JSON.parse(notification.data as string)).toMatchObject({
      memoryId: anniversary.id,
      memoryNotice: { type: MemoryType.Rule, data: { ruleId: 'trip_anniversary', context: { placeLabel: 'Lisbon' } } },
    });

    // the same day, another run sends nothing more
    await expect(sut.sendNotices(user, defaults, new Date('2026-10-03T15:00:00Z'))).resolves.toEqual({});
    expect(await notificationsOf(ctx, user.id)).toHaveLength(1);

    // the database holds one notification of the day per user and day, whatever the jobs do
    await expect(
      ctx.get(MemoryNoticeRepository).claim({ userId: user.id, kind: 'draft', refId: 'other', day: '2026-10-03' }),
    ).resolves.toBeUndefined();
    // and each memory once
    await expect(
      ctx
        .get(MemoryNoticeRepository)
        .claim({ userId: user.id, kind: 'memory', refId: anniversary.id!, day: '2026-10-04' }),
    ).resolves.toBeUndefined();
  });

  it('notifies the next memory on the next day, never the same one twice', async () => {
    const { sut, ctx } = setup();
    const user = await newUser(ctx);
    const { memory: first } = await seedMemory(ctx, user.id, { year: 2020, photos: 4 });
    const { memory: second } = await seedMemory(ctx, user.id, { year: 2021, photos: 2 });
    // both stay until tomorrow
    await ctx.database
      .updateTable('memory')
      .set({ hideAt: TODAY.plus({ days: 1 }).endOf('day').toJSDate() })
      .where('id', 'in', [first.id!, second.id!])
      .execute();

    await sut.sendNotices(user, defaults, NOW);
    await sut.sendNotices(user, defaults, new Date('2026-10-04T09:00:00Z'));

    const notifications = await notificationsOf(ctx, user.id);
    expect(notifications.map(({ data }) => JSON.parse(data as string).memoryId as string).toSorted(byId)).toEqual(
      [first.id!, second.id!].toSorted(byId),
    );
  });

  it('waits for the time of day in the time zone of the user', async () => {
    const { sut, ctx } = setup();
    const user = await newUser(ctx, { timeZone: 'America/New_York' });
    await seedMemory(ctx, user.id, {});

    // 05:00 in New York
    await expect(sut.sendNotices(user, defaults, NOW)).resolves.toEqual({});
    await expect(sut.sendNotices(user, defaults, new Date('2026-10-03T13:30:00Z'))).resolves.toMatchObject({
      notice: { kind: 'memory' },
    });
  });

  describe('the exclusions', () => {
    it('never notifies a memory whose photos are all kept out', async () => {
      const { sut, ctx } = setup();
      const user = await newUser(ctx);
      await seedMemory(ctx, user.id, { year: 2023 });
      await ctx.get(MemoryExclusionRepository).create({
        ownerId: user.id,
        type: MemoryExclusionType.DateRange,
        startDate: '2023-10-01',
        endDate: '2023-10-05',
      });

      await expect(sut.sendNotices(user, defaults, NOW)).resolves.toEqual({});
      expect(await notificationsOf(ctx, user.id)).toHaveLength(0);
    });

    it('never notifies a memory about an excluded person, and notifies the next one instead', async () => {
      const { sut, ctx } = setup();
      const user = await newUser(ctx);
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Dana' });
      await seedMemory(ctx, user.id, {
        type: MemoryType.Rule,
        data: {
          ruleId: 'birthday',
          dedupeKey: 'birthday',
          score: 330,
          context: { personId: person.personGroupId, personName: 'Dana', variant: 'recent' },
        },
      });
      const { memory: yearsAgo } = await seedMemory(ctx, user.id, { year: 2019 });
      await ctx.get(MemoryExclusionRepository).create({
        ownerId: user.id,
        type: MemoryExclusionType.Person,
        personGroupId: person.personGroupId,
      });

      await expect(sut.sendNotices(user, defaults, NOW)).resolves.toMatchObject({
        notice: { kind: 'memory', data: { memoryId: yearsAgo.id } },
      });
    });
  });

  it('tells of a suggested book waiting for the user on a day without a memory', async () => {
    const { sut, ctx } = setup();
    const user = await newUser(ctx);
    const book = await ctx.database
      .insertInto('book')
      .values({
        ownerId: user.id,
        title: 'Crete 2026',
        status: BookStatus.Draft,
        pageWidthMm: 210,
        pageHeightMm: 297,
        style: {} as never,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const draft = await ctx.get(BookDraftRepository).claim({
      ownerId: user.id,
      key: 'trip:crete',
      kind: BookDraftKind.Trip,
      title: 'Crete 2026',
      reason: 'Your trip to Crete',
    });
    await ctx.get(BookDraftRepository).update(draft!.id, { bookId: book.id });

    await expect(sut.sendNotices(user, defaults, NOW)).resolves.toMatchObject({
      notice: { kind: 'draft', data: { bookId: book.id, draftNotice: { draftId: draft!.id, kind: 'trip' } } },
    });
    const [notification] = await notificationsOf(ctx, user.id);
    expect(notification).toMatchObject({ title: 'Your trip book is ready', description: 'Crete 2026' });
  });

  describe('the weekly digest', () => {
    it("emails the week's memories and the journal visits not opened yet, once a week", async () => {
      const { sut, ctx } = setup();
      const user = await newUser(ctx, { memories: false, drafts: false, digest: true, digestDay: 6 });
      const { memory } = await seedMemory(ctx, user.id, { year: 2020 });
      const unread = await ctx.get(NotificationRepository).create({
        userId: user.id,
        title: 'Name the dishes from last night at Taormina?',
        description: '12 dishes · Taormina',
      });
      const read = await ctx.get(NotificationRepository).create({ userId: user.id, title: 'Name the wines?' });
      await ctx.get(NotificationRepository).update(read.id, { readAt: new Date() });
      for (const [key, notification] of [
        ['dinner', unread],
        ['wines', read],
      ] as const) {
        const notice = await ctx
          .get(CollectionNoticeRepository)
          .claim({ userId: user.id, pack: 'food', key, assetIds: [memory.id!] });
        await ctx.get(CollectionNoticeRepository).setNotification(notice!.id, notification.id);
      }
      const config = { ...defaults, notifications: smtpOn };

      const { digest } = await sut.sendNotices(user, config, NOW);

      expect(digest?.memories).toEqual([expect.objectContaining({ url: expect.stringContaining(memory.id!) })]);
      expect(digest?.visits).toEqual([
        expect.objectContaining({ title: 'Name the dishes from last night at Taormina?' }),
      ]);
      expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.SendMail, data: expect.objectContaining({ to: user.email }) }),
      );

      // once a week
      ctx.getMock(JobRepository).queue.mockClear();
      await expect(sut.sendNotices(user, config, new Date('2026-10-03T18:00:00Z'))).resolves.toEqual({});
      expect(ctx.getMock(JobRepository).queue).not.toHaveBeenCalled();
    });

    it('is skipped when email is not set up', async () => {
      const { sut, ctx } = setup();
      const user = await newUser(ctx, { memories: false, drafts: false, digest: true, digestDay: 6 });
      await seedMemory(ctx, user.id, {});

      await expect(sut.sendNotices(user, defaults, NOW)).resolves.toEqual({});
      expect(ctx.getMock(JobRepository).queue).not.toHaveBeenCalled();
    });
  });
});

import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  AssetFileType,
  AssetType,
  AssetVisibility,
  MemoryExclusionType,
  MemoryType,
  UserMetadataKey,
} from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { BookDraftRepository } from 'src/repositories/book-draft.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MemoryExclusionRepository } from 'src/repositories/memory-exclusion.repository.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { YearRecapRepository } from 'src/repositories/year-recap.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { MemorySourceService } from 'src/services/memory-source.service.js';
import { MemoryService } from 'src/services/memory.service.js';
import { MemoryExclusions, NO_MEMORY_EXCLUSIONS } from 'src/utils/memory-exclusions.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) =>
  newMediumService(MemoryService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetRepository,
      BookDraftRepository,
      ConfigRepository,
      DatabaseRepository,
      MemoryExclusionRepository,
      MemoryRepository,
      PartnerRepository,
      PersonRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
      YearRecapRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });

type Context = ReturnType<typeof setup>['ctx'];

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

const seedPhoto = async (
  ctx: Context,
  ownerId: string,
  localDateTime: string,
  { city = null, type = AssetType.Image }: { city?: string | null; type?: AssetType } = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    localDateTime,
    fileCreatedAt: localDateTime,
    type,
    visibility: AssetVisibility.Timeline,
  });
  await Promise.all([
    ctx.newExif({ assetId: asset.id, city, country: city ? 'Portugal' : null }),
    ctx.newJobStatus({ assetId: asset.id }),
    ctx.get(AssetRepository).upsertFiles([
      { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
      { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
    ]),
  ]);
  return asset;
};

const tag = async (ctx: Context, userId: string, value: string, assetIds: string[]) => {
  const { result } = await ctx.newTag({ userId, value });
  await ctx.newTagAsset({ tagIds: [result.id], assetIds });
};

/** a person of the user whose face identity is also on a photo of someone else, e.g. in a shared space */
const seedPersonWithIdentity = async (ctx: Context, ownerId: string, name: string) => {
  const { person } = await ctx.newPerson({ ownerId, name });
  const identity = await ctx.database
    .insertInto('face_identity')
    .values({ type: 'person' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.database
    .updateTable('person')
    .set({ identityId: identity.id })
    .where('personGroupId', '=', person.personGroupId)
    .execute();

  const { user: friend } = await ctx.newUser();
  const friendsPhoto = await seedPhoto(ctx, friend.id, '2023-07-20T12:00:00Z');
  const { assetFace } = await ctx.newAssetFace({ assetId: friendsPhoto.id, personGroupId: null });
  await ctx.database
    .insertInto('face_identity_face')
    .values({ assetFaceId: assetFace.id!, identityId: identity.id, source: 'ml' })
    .execute();
  return { person, friendsPhoto };
};

const exclusionsOf = (overrides: Partial<MemoryExclusions>) => ({ ...NO_MEMORY_EXCLUSIONS, ...overrides });

describe('memory exclusions (#12)', () => {
  beforeEach(async () => {
    defaultDatabase = await getKyselyDB();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await defaultDatabase.destroy();
  });

  describe('the photos they leave out', () => {
    it('leaves out a person, in their photos and through their face identity in the photos of others', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { person, friendsPhoto } = await seedPersonWithIdentity(ctx, user.id, 'Dana');
      const withDana = await seedPhoto(ctx, user.id, '2023-07-05T12:00:00Z');
      await ctx.newAssetFace({ assetId: withDana.id, personGroupId: person.personGroupId });
      const without = await seedPhoto(ctx, user.id, '2023-07-06T12:00:00Z');

      const kept = await ctx
        .get(MemoryExclusionRepository)
        .getKeptAssetIds(
          [withDana.id, friendsPhoto.id, without.id],
          exclusionsOf({ personIds: [person.personGroupId] }),
        );

      expect([...kept]).toEqual([without.id]);
    });

    it('leaves out a pet', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { person: rex } = await ctx.newPerson({ ownerId: user.id, name: 'Rex', type: 'pet', species: 'dog' });
      const withRex = await seedPhoto(ctx, user.id, '2023-07-05T12:00:00Z');
      await ctx.newAssetFace({ assetId: withRex.id, personGroupId: rex.personGroupId });
      const without = await seedPhoto(ctx, user.id, '2023-07-06T12:00:00Z');

      const kept = await ctx
        .get(MemoryExclusionRepository)
        .getKeptAssetIds([withRex.id, without.id], exclusionsOf({ personIds: [rex.personGroupId] }));

      expect([...kept]).toEqual([without.id]);
    });

    it('leaves out the days of a range, the first and the last included', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const before = await seedPhoto(ctx, user.id, '2023-07-09T23:59:00Z');
      const first = await seedPhoto(ctx, user.id, '2023-07-10T00:00:00Z');
      const last = await seedPhoto(ctx, user.id, '2023-07-12T23:59:00Z');
      const after = await seedPhoto(ctx, user.id, '2023-07-13T00:00:00Z');

      const kept = await ctx
        .get(MemoryExclusionRepository)
        .getKeptAssetIds(
          [before.id, first.id, last.id, after.id],
          exclusionsOf({ dateRanges: [{ from: '2023-07-10', to: '2023-07-12' }] }),
        );

      expect([...kept].toSorted()).toEqual([before.id, after.id].toSorted());
    });

    it('leaves out the photos of an album', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const work = await seedPhoto(ctx, user.id, '2023-07-05T12:00:00Z');
      const holiday = await seedPhoto(ctx, user.id, '2023-07-06T12:00:00Z');
      const { album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Work' }, [work.id]);

      const kept = await ctx
        .get(MemoryExclusionRepository)
        .getKeptAssetIds([work.id, holiday.id], exclusionsOf({ albumIds: [album.id!] }));

      expect([...kept]).toEqual([holiday.id]);
    });

    it('leaves out screenshots, receipts and documents', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const [screenshot, receipt, menu, ticket, dish, sunset] = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((day) => seedPhoto(ctx, user.id, `2023-07-0${day}T12:00:00Z`)),
      );
      await tag(ctx, user.id, 'Auto/Screenshots', [screenshot.id]);
      await tag(ctx, user.id, 'Auto/Receipts', [receipt.id]);
      await tag(ctx, user.id, 'Food/Da Enzo/Menu', [menu.id]);
      await tag(ctx, user.id, 'Travel/Crete/Tickets', [ticket.id]);
      await tag(ctx, user.id, 'Food/Da Enzo/Cacio e pepe', [dish.id]);
      await tag(ctx, user.id, 'Auto/Sunsets', [sunset.id]);
      const ids = [screenshot, receipt, menu, ticket, dish, sunset].map(({ id }) => id);

      const repository = ctx.get(MemoryExclusionRepository);
      expect([...(await repository.getKeptAssetIds(ids, exclusionsOf({ documents: true })))].toSorted()).toEqual(
        [dish.id, sunset.id].toSorted(),
      );
      expect(await repository.getKeptAssetIds(ids, NO_MEMORY_EXCLUSIONS)).toEqual(new Set(ids));
    });
  });

  describe('the memory rules', () => {
    /** 12 July 2023 photos, and four more that each kind of exclusion leaves out */
    const seedJuly = async (ctx: Context, userId: string) => {
      const kept: string[] = [];
      for (let day = 5; day <= 16; day++) {
        kept.push((await seedPhoto(ctx, userId, `2023-07-${day}T12:00:00Z`)).id);
      }
      const { person } = await ctx.newPerson({ ownerId: userId, name: 'Dana' });
      const { person: pet } = await ctx.newPerson({ ownerId: userId, name: 'Rex', type: 'pet' });
      const excluded = {
        person: await seedPhoto(ctx, userId, '2023-07-17T12:00:00Z'),
        pet: await seedPhoto(ctx, userId, '2023-07-18T12:00:00Z'),
        days: await seedPhoto(ctx, userId, '2023-07-20T12:00:00Z'),
        album: await seedPhoto(ctx, userId, '2023-07-21T12:00:00Z'),
        documents: await seedPhoto(ctx, userId, '2023-07-22T12:00:00Z'),
      };
      await ctx.newAssetFace({ assetId: excluded.person.id, personGroupId: person.personGroupId });
      await ctx.newAssetFace({ assetId: excluded.pet.id, personGroupId: pet.personGroupId });
      const { album } = await ctx.newAlbum({ ownerId: userId, albumName: 'Work' }, [excluded.album.id]);
      await tag(ctx, userId, 'Auto/Screenshots', [excluded.documents.id]);
      return { kept, excluded, person, pet, album };
    };

    const generateOn = async (sut: MemoryService, day: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(day));
      await sut.onMemoriesCreate();
    };

    it.each(['person', 'pet', 'days', 'album', 'documents'] as const)(
      'leaves the photos of an excluded %s out of a new month recap',
      async (kind) => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();
        const { kept, excluded, person, pet, album } = await seedJuly(ctx, user.id);
        const repository = ctx.get(MemoryExclusionRepository);
        switch (kind) {
          case 'person': {
            await repository.create({
              ownerId: user.id,
              type: MemoryExclusionType.Person,
              personGroupId: person.personGroupId,
            });
            break;
          }
          case 'pet': {
            await repository.create({
              ownerId: user.id,
              type: MemoryExclusionType.Person,
              personGroupId: pet.personGroupId,
            });
            break;
          }
          case 'days': {
            await repository.create({
              ownerId: user.id,
              type: MemoryExclusionType.DateRange,
              startDate: '2023-07-20',
              endDate: '2023-07-20',
            });
            break;
          }
          case 'album': {
            await repository.create({ ownerId: user.id, type: MemoryExclusionType.Album, albumId: album.id! });
            break;
          }
          case 'documents': {
            await ctx.get(UserRepository).upsertMetadata(user.id, {
              key: UserMetadataKey.Preferences,
              value: { memoryExclusions: { documents: true } },
            });
            break;
          }
        }

        await generateOn(sut, '2026-07-01T00:00:00Z');

        const [recap] = await ctx
          .get(MemoryRepository)
          .search(user.id, { type: MemoryType.Rule, for: new Date('2026-07-01T00:00:00Z') });
        expect(recap?.data).toMatchObject({ ruleId: 'month_recap' });
        const ids = recap.assets.map(({ id }) => id);
        expect(ids).not.toContain(excluded[kind].id);
        // the other kinds are not left out
        expect(ids).toEqual(expect.arrayContaining(kept));
        expect(ids).toHaveLength(kept.length + 4);
      },
    );

    it('does not make a birthday memory of an excluded person', async () => {
      const { sut, ctx } = setup();
      const seedBirthday = async () => {
        const { user } = await ctx.newUser();
        const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Dana', birthDate: '2000-07-01' });
        for (const year of [2021, 2022, 2023, 2024]) {
          const photo = await seedPhoto(ctx, user.id, `${year}-07-01T12:00:00Z`);
          await ctx.newAssetFace({ assetId: photo.id, personGroupId: person.personGroupId });
        }
        return { user, person };
      };
      const excluding = await seedBirthday();
      const control = await seedBirthday();
      await ctx.get(MemoryExclusionRepository).create({
        ownerId: excluding.user.id,
        type: MemoryExclusionType.Person,
        personGroupId: excluding.person.personGroupId,
      });

      await generateOn(sut, '2026-07-01T00:00:00Z');

      const birthdays = async (userId: string) =>
        (
          await ctx
            .get(MemoryRepository)
            .search(userId, { type: MemoryType.Rule, for: new Date('2026-07-01T00:00:00Z') })
        ).filter((memory) => (memory.data as { ruleId: string }).ruleId === 'birthday');
      expect(await birthdays(excluding.user.id)).toEqual([]);
      expect(await birthdays(control.user.id)).toHaveLength(1);
    });

    it('makes the year recap early in January, its stats without the excluded people and documents', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person: dana } = await ctx.newPerson({ ownerId: user.id, name: 'Dana' });
      const { person: eli } = await ctx.newPerson({ ownerId: user.id, name: 'Eli' });
      const photos: string[] = [];
      for (let month = 1; month <= 12; month++) {
        for (let day = 3; day <= 7; day++) {
          const photo = await seedPhoto(ctx, user.id, `2025-${String(month).padStart(2, '0')}-0${day}T12:00:00Z`, {
            city: month <= 6 ? 'Lisbon' : 'Porto',
          });
          photos.push(photo.id);
        }
      }
      await ctx.newAssetFace({ assetId: photos[0], personGroupId: eli.personGroupId });
      await ctx.newAssetFace({ assetId: photos[1], personGroupId: dana.personGroupId });
      await tag(ctx, user.id, 'Food/Da Enzo/Cacio e pepe', [photos[10]]);
      await tag(ctx, user.id, 'Food/Da Enzo/Menu', [photos[11]]);
      await tag(ctx, user.id, 'Auto/Screenshots', [photos[12]]);
      await ctx
        .get(MemoryExclusionRepository)
        .create({ ownerId: user.id, type: MemoryExclusionType.Person, personGroupId: dana.personGroupId });
      await ctx.get(UserRepository).upsertMetadata(user.id, {
        key: UserMetadataKey.Preferences,
        value: { memoryExclusions: { documents: true } },
      });

      await generateOn(sut, '2026-01-02T06:00:00Z');

      const recaps = (
        await ctx
          .get(MemoryRepository)
          .search(user.id, { type: MemoryType.Rule, for: new Date('2026-01-10T00:00:00Z') })
      ).filter((memory) => (memory.data as { ruleId: string }).ruleId === 'year_recap');
      expect(recaps).toHaveLength(1);
      expect(recaps[0].data).toMatchObject({
        dedupeKey: 'year_recap:2025',
        context: {
          year: 2025,
          // 60 photos, without Dana's, the menu and the screenshot
          count: 57,
          places: 2,
          people: 1,
          topPeople: [{ id: eli.personGroupId, name: 'Eli' }],
          journals: { food: { places: 1, entries: 1 } },
        },
      });
      expect(recaps[0].hideAt).toEqual(DateTime.fromISO('2026-01-15T23:59:59.999Z').toJSDate());
      expect(recaps[0].assets.map(({ id }) => id)).not.toContain(photos[1]);
      expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledWith({
        name: 'YearRecapPrepare',
        data: { id: recaps[0].id },
      });
    });
  });

  describe('the memories already made', () => {
    it('are served without the excluded photos, and get them back when the exclusion goes', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const photos = await Promise.all([1, 2, 3].map((day) => seedPhoto(ctx, user.id, `2023-07-0${day}T12:00:00Z`)));
      const { album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Work' }, [photos[0].id]);
      const { memory } = await ctx.newMemory({ ownerId: user.id });
      for (const photo of photos) {
        await ctx.newMemoryAsset({ memoryId: memory.id!, assetId: photo.id });
      }
      const auth = authOf(user);
      const exclusions = BaseService.create(MemoryExclusionService, sut);

      const excluded = await exclusions.create(auth, { type: MemoryExclusionType.Album, albumId: album.id! });
      const [served] = await sut.search(auth, {});
      expect(served.assets.map(({ id }) => id).toSorted()).toEqual([photos[1].id, photos[2].id].toSorted());
      const one = await sut.get(auth, memory.id!);
      expect(one.assets).toHaveLength(2);

      await exclusions.remove(auth, excluded.id);
      const [back] = await sut.search(auth, {});
      expect(back.assets).toHaveLength(3);
    });

    it('are reconciled without them: a card left under its floor is removed', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const day = DateTime.fromISO('2026-07-10T00:00:00Z', { zone: 'utc' });
      const photos = await Promise.all(
        [1, 2, 3, 4].map((index) => seedPhoto(ctx, user.id, `2023-07-0${index}T12:00:00Z`)),
      );
      const { memory } = await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        data: { ruleId: 'people_together', dedupeKey: 'k', score: 100 },
        showAt: day.startOf('day').toJSDate(),
        hideAt: day.endOf('day').toJSDate(),
      });
      for (const photo of photos) {
        await ctx.newMemoryAsset({ memoryId: memory.id!, assetId: photo.id });
      }
      // people_together keeps at least 4 photos: one left out is one too many
      await ctx.get(MemoryExclusionRepository).create({
        ownerId: user.id,
        type: MemoryExclusionType.DateRange,
        startDate: '2023-07-01',
        endDate: '2023-07-01',
      });

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(day.plus({ hours: 6 }).toJSDate());
      await sut.onMemoriesCreate();

      expect(await ctx.get(MemoryRepository).get(memory.id!)).toBeUndefined();
    });
  });

  describe('the creations of a memory', () => {
    it('make a video, a book or a collage of the year without the excluded album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const work = await seedPhoto(ctx, user.id, '2025-03-01T12:00:00Z');
      const holiday = await seedPhoto(ctx, user.id, '2025-08-01T12:00:00Z');
      const video = await seedPhoto(ctx, user.id, '2025-08-02T12:00:00Z', { type: AssetType.Video });
      const { album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Work' }, [work.id]);
      const { memory } = await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        memoryAt: new Date('2025-07-01T00:00:00Z'),
        data: { ruleId: 'year_recap', dedupeKey: 'year_recap:2025', context: { year: 2025 } },
      });
      await ctx.newMemoryAsset({ memoryId: memory.id!, assetId: work.id });
      await ctx
        .get(MemoryExclusionRepository)
        .create({ ownerId: user.id, type: MemoryExclusionType.Album, albumId: album.id! });

      const { source, assets } = await BaseService.create(MemorySourceService, sut).resolve(authOf(user), memory.id!);

      expect(source).toMatchObject({ kind: 'period', title: '2025 in review' });
      expect(assets.map(({ id }) => id)).toEqual([holiday.id, video.id]);
    });
  });
});

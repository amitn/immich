import { Kysely } from 'kysely';
import { AssetFileType, AssetVisibility } from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { parseEmbedding } from 'src/utils/agent/clustering.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, assetJob: ctx.get(AssetJobRepository), search: ctx.get(SearchRepository) };
};

const vector = (index: number) => `[${Array.from({ length: 512 }, (_, i) => (i === index ? 1 : 0)).join(',')}]`;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('assistant library queries', () => {
  describe(SearchRepository.prototype.getEmbeddings.name, () => {
    it('should return the embeddings of the given assets', async () => {
      const { ctx, search } = setup();
      const { user } = await ctx.newUser();
      const { asset: a } = await ctx.newAsset({ ownerId: user.id });
      const { asset: b } = await ctx.newAsset({ ownerId: user.id });
      const { asset: c } = await ctx.newAsset({ ownerId: user.id });
      await search.upsert(a.id, vector(0));
      await search.upsert(b.id, vector(1));

      const result = await search.getEmbeddings([a.id, b.id, c.id]);

      expect(result).toHaveLength(2);
      const byId = new Map(result.map(({ assetId, embedding }) => [assetId, parseEmbedding(embedding)]));
      expect(byId.get(a.id)).toHaveLength(512);
      expect(byId.get(a.id)![0]).toBeCloseTo(1);
      expect(byId.get(b.id)![1]).toBeCloseTo(1);
    });

    it('should handle no ids', async () => {
      const { search } = setup();
      await expect(search.getEmbeddings([])).resolves.toEqual([]);
    });
  });

  describe(AssetJobRepository.prototype.getForAgentEvents.name, () => {
    it('should return candidates in local time order with place and named people', async () => {
      const { ctx, assetJob } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ann' });
      const { person: unnamed } = await ctx.newPerson({ ownerId: user.id, name: '' });

      const day = (hour: number) => new Date(Date.UTC(2024, 5, 1, hour));
      const { asset: late } = await ctx.newAsset({ ownerId: user.id, fileCreatedAt: day(12), localDateTime: day(14) });
      const { asset: early } = await ctx.newAsset({ ownerId: user.id, fileCreatedAt: day(8), localDateTime: day(10) });
      const { asset: archived } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: day(9),
        localDateTime: day(11),
        visibility: AssetVisibility.Archive,
      });
      const { asset: deleted } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: day(9),
        localDateTime: day(11),
      });
      await ctx.softDeleteAsset(deleted.id);
      await ctx.newAsset({ ownerId: other.id, fileCreatedAt: day(9), localDateTime: day(11) });
      await ctx.newAsset({ ownerId: user.id, fileCreatedAt: new Date(Date.UTC(2023, 0, 1)) });

      await ctx.newExif({ assetId: early.id, city: 'Rome', country: 'Italy', latitude: 41.9, longitude: 12.5 });
      await ctx.newAssetFace({ assetId: early.id, personGroupId: person.personGroupId });
      await ctx.newAssetFace({ assetId: early.id, personGroupId: unnamed.personGroupId });

      const result = await assetJob.getForAgentEvents({
        userIds: [user.id],
        viewingUserId: user.id,
        takenAfter: new Date(Date.UTC(2024, 0, 1)),
        limit: 100,
      });

      expect(result).toEqual([
        {
          id: early.id,
          localDateTime: day(10),
          latitude: 41.9,
          longitude: 12.5,
          city: 'Rome',
          country: 'Italy',
          people: [{ name: 'Ann' }],
        },
        expect.objectContaining({ id: late.id, city: null, people: [] }),
      ]);
      expect(result.map(({ id }) => id)).not.toContain(archived.id);
    });

    it('should filter by album and person', async () => {
      const { ctx, assetJob } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
      const { asset: a } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      const { asset: b } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [a.id, b.id]);
      await ctx.newAssetFace({ assetId: b.id, personGroupId: person.personGroupId });

      const inAlbum = await assetJob.getForAgentEvents({ viewingUserId: user.id, albumId: album.id, limit: 10 });
      expect(inAlbum.map(({ id }) => id).toSorted()).toEqual([a.id, b.id].toSorted());

      const withPerson = await assetJob.getForAgentEvents({
        userIds: [user.id],
        viewingUserId: user.id,
        personIds: [person.personGroupId],
        limit: 10,
      });
      expect(withPerson.map(({ id }) => id)).toEqual([b.id]);
    });
  });

  describe(AssetJobRepository.prototype.getForAgent.name, () => {
    it('should return metadata, faces and the preferred preview', async () => {
      const { ctx, assetJob } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ann' });
      const { asset } = await ctx.newAsset({ ownerId: user.id, width: 4000, height: 3000 });
      const { asset: plain } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, make: 'Canon', city: 'Rome' });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/preview.jpeg',
        isEdited: false,
      });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: '/edited.jpeg', isEdited: true });
      await ctx.newAssetFace({
        assetId: asset.id,
        personGroupId: person.personGroupId,
        boundingBoxX1: 1,
        boundingBoxY1: 2,
        boundingBoxX2: 3,
        boundingBoxY2: 4,
      });
      await ctx.newAssetFace({ assetId: asset.id, isVisible: false });

      const result = await assetJob.getForAgent([asset.id, plain.id], user.id);
      const byId = new Map(result.map((row) => [row.id, row]));

      expect(byId.get(asset.id)).toMatchObject({
        width: 4000,
        height: 3000,
        make: 'Canon',
        city: 'Rome',
        previewPath: '/edited.jpeg',
        faces: [
          {
            personId: person.personGroupId,
            name: 'Ann',
            boundingBoxX1: 1,
            boundingBoxY1: 2,
            boundingBoxX2: 3,
            boundingBoxY2: 4,
            imageWidth: 10,
            imageHeight: 10,
          },
        ],
      });
      expect(byId.get(plain.id)).toMatchObject({ previewPath: null, faces: [], make: null });
    });
  });

  describe(AssetJobRepository.prototype.getAlbumsForAgent.name, () => {
    it('should only return albums the user belongs to', async () => {
      const { ctx, assetJob } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Mine' }, [asset.id]);
      await ctx.newAlbum({ ownerId: other.id, albumName: 'Theirs' }, [asset.id]);

      await expect(assetJob.getAlbumsForAgent([asset.id], user.id)).resolves.toEqual([
        { assetId: asset.id, id: album.id, albumName: 'Mine' },
      ]);
    });
  });

  describe(AssetJobRepository.prototype.getPeopleForAgent.name, () => {
    it('should count photos per named person', async () => {
      const { ctx, assetJob } = setup();
      const { user } = await ctx.newUser();
      const { person: ann } = await ctx.newPerson({ ownerId: user.id, name: 'Ann' });
      const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
      const { person: unnamed } = await ctx.newPerson({ ownerId: user.id, name: '' });
      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newAssetFace({ assetId: asset.id, personGroupId: ann.personGroupId });
        await ctx.newAssetFace({ assetId: asset.id, personGroupId: unnamed.personGroupId });
        if (i === 0) {
          await ctx.newAssetFace({ assetId: asset.id, personGroupId: bob.personGroupId });
        }
      }

      await expect(assetJob.getPeopleForAgent([user.id], user.id, { limit: 10 })).resolves.toEqual([
        { id: ann.personGroupId, name: 'Ann', count: 3 },
        { id: bob.personGroupId, name: 'Bob', count: 1 },
      ]);

      await expect(
        assetJob.getPeopleForAgent([user.id], user.id, { personIds: [unnamed.personGroupId], limit: 10 }),
      ).resolves.toEqual([{ id: unnamed.personGroupId, name: '', count: 3 }]);
    });
  });
});

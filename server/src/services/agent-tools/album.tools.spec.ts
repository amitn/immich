import { AuthDto } from 'src/dtos/auth.dto.js';
import { AlbumAgentTools } from 'src/services/agent-tools/album.tools.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AlbumFactory } from 'test/factories/album.factory.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { AlbumLike } from 'test/factories/types.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { getForAlbum } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.content[0].type).toBe('text');
  return JSON.parse((result.content[0] as { text: string }).text);
};

const newAlbum = (dto: AlbumLike = {}) => {
  const album = AlbumFactory.from(dto).build();
  return { album, owner: album.albumUsers[0].user };
};

describe(AlbumAgentTools.name, () => {
  let sut: AlbumAgentTools;
  let mocks: ServiceMocks;

  const call = (auth: AuthDto, name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AlbumAgentTools));
    mocks.user.getMetadata.mockResolvedValue([]);
  });

  it('should expose the album tools', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'list_albums', mutating: false },
      { name: 'get_album', mutating: false },
      { name: 'create_album', mutating: true },
      { name: 'add_to_album', mutating: true },
      { name: 'remove_from_album', mutating: true },
    ]);
  });

  describe('list_albums', () => {
    it('should list compact albums filtered by name', async () => {
      const { album: italy, owner } = newAlbum({ albumName: 'Italy 2024' });
      const beach = AlbumFactory.from({ albumName: 'Beach' }).albumUser().build();
      mocks.album.getAll.mockResolvedValue([getForAlbum(italy), getForAlbum(beach)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: italy.id,
          assetCount: 150,
          startDate: new Date('2024-05-01T10:00:00.000Z'),
          endDate: new Date('2024-05-14T18:00:00.000Z'),
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = parse(await call(AuthFactory.create(owner), 'list_albums', { query: 'ITALY' }));

      expect(result).toEqual({
        total: 1,
        albums: [
          { id: italy.id, name: 'Italy 2024', count: 150, start: '2024-05-01', end: '2024-05-14', shared: false },
        ],
      });
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isShared: undefined });
    });

    it('should apply the limit', async () => {
      const owner = UserFactory.create();
      const albums = [1, 2, 3].map(() => AlbumFactory.from().albumUser().build());
      mocks.album.getAll.mockResolvedValue(albums.map((album) => getForAlbum(album)));
      mocks.album.getMetadataForIds.mockResolvedValue([]);

      const result = parse(await call(AuthFactory.create(owner), 'list_albums', { limit: 2, shared: true }));

      expect(result.total).toBe(3);
      expect(result.albums).toHaveLength(2);
      expect(result.albums[1]).toMatchObject({ count: 0, start: null, end: null, shared: true });
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isShared: true });
    });
  });

  describe('get_album', () => {
    it('should require access', async () => {
      const result = await call(AuthFactory.create(), 'get_album', { albumId: newUuid() });
      expect(result.isError).toBe(true);
      expect(mocks.album.getById).not.toHaveBeenCalled();
    });

    it('should return the album with asset ids', async () => {
      const { album, owner } = newAlbum({ description: 'Summer' });
      const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 2, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);
      mocks.asset.getIdsByAlbumId.mockResolvedValue([{ id: asset1.id }, { id: asset2.id }]);

      const result = parse(
        await call(AuthFactory.create(owner), 'get_album', { albumId: album.id, includeAssetIds: true, limit: 10 }),
      );

      expect(result).toMatchObject({
        id: album.id,
        name: album.albumName,
        description: 'Summer',
        count: 2,
        owner: owner.name,
        isOwner: true,
        assetIds: [asset1.id, asset2.id],
      });
      expect(mocks.asset.getIdsByAlbumId).toHaveBeenCalledWith(album.id, 10);
    });

    it('should not load asset ids by default', async () => {
      const { album, owner } = newAlbum();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getMetadataForIds.mockResolvedValue([]);

      const result = parse(await call(AuthFactory.create(owner), 'get_album', { albumId: album.id }));

      expect(result.assetIds).toBeUndefined();
      expect(mocks.asset.getIdsByAlbumId).not.toHaveBeenCalled();
    });
  });

  describe('create_album', () => {
    it('should create an album and add the assets it may share', async () => {
      const { album, owner } = newAlbum({ albumName: 'Italy' });
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getAssetIds.mockResolvedValue(new Set());
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));

      const result = parse(
        await call(AuthFactory.create(owner), 'create_album', {
          name: 'Italy',
          description: 'Our trip',
          assetIds: [asset1.id, asset2.id, asset3.id, asset1.id],
        }),
      );

      expect(result).toEqual({
        id: album.id,
        name: 'Italy',
        added: 2,
        duplicate: 1,
        failed: 1,
        failures: [{ id: asset3.id, reason: 'no_permission' }],
      });
      expect(mocks.album.create).toHaveBeenCalledWith(
        expect.objectContaining({ albumName: 'Italy', description: 'Our trip', albumThumbnailAssetId: null }),
        [],
        expect.any(Array),
        owner.id,
      );
      expect(mocks.album.addAssetIds).toHaveBeenCalledWith(album.id, [asset1.id, asset2.id]);
    });

    it('should create an empty album', async () => {
      const { album, owner } = newAlbum({ albumName: 'Empty' });
      mocks.album.create.mockResolvedValue(getForAlbum(album));

      const result = parse(await call(AuthFactory.create(owner), 'create_album', { name: 'Empty' }));

      expect(result).toEqual({ id: album.id, name: 'Empty', added: 0, duplicate: 0, failed: 0 });
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
    });

    it('should reject an empty name', () => {
      const tool = sut.getTools().find(({ name }) => name === 'create_album')!;
      expect(tool.input.safeParse({ name: '  ' }).success).toBe(false);
    });
  });

  describe('add_to_album', () => {
    it('should report added, duplicate and failed assets', async () => {
      const { album, owner } = newAlbum();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset1.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id]));

      const result = parse(
        await call(AuthFactory.create(owner), 'add_to_album', {
          albumId: album.id,
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      );

      expect(result).toEqual({
        albumId: album.id,
        added: 1,
        duplicate: 1,
        failed: 1,
        failures: [{ id: asset3.id, reason: 'no_permission' }],
      });
      expect(mocks.album.addAssetIds).toHaveBeenCalledWith(album.id, [asset2.id]);
    });

    it('should return an error without album access', async () => {
      const album = AlbumFactory.create();
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      const result = await call(AuthFactory.create(), 'add_to_album', {
        albumId: album.id,
        assetIds: [newUuid()],
      });

      expect(result.isError).toBe(true);
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
    });
  });

  describe('remove_from_album', () => {
    it('should report removed assets and assets not in the album', async () => {
      const { album, owner } = newAlbum();
      const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset1.id]));

      const result = parse(
        await call(AuthFactory.create(owner), 'remove_from_album', {
          albumId: album.id,
          assetIds: [asset1.id, asset2.id],
        }),
      );

      expect(result).toEqual({ albumId: album.id, removed: 1, notInAlbum: 1, failed: 0 });
      expect(mocks.album.removeAssetIds).toHaveBeenCalledWith(album.id, [asset1.id]);
    });

    it('should return an error without album access', async () => {
      const result = await call(AuthFactory.create(), 'remove_from_album', {
        albumId: newUuid(),
        assetIds: [newUuid()],
      });

      expect(result.isError).toBe(true);
      expect(mocks.album.removeAssetIds).not.toHaveBeenCalled();
    });
  });
});

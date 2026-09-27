import { BadRequestException } from '@nestjs/common';
import { Stats } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AssetFileType, AssetType } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { AlbumService } from 'src/services/album.service.js';
import { CollageService } from 'src/services/collage.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { getForAsset } from 'test/mappers.js';
import { newDate, newUuid, newUuidV7 } from 'test/small.factory.js';
import { ServiceMocks, automock, newTestService } from 'test/utils.js';

describe(CollageService.name, () => {
  let sut: CollageService;
  let mocks: ServiceMocks;
  let dir: string;
  const auth = authStub.admin;
  const ids = [newUuid(), newUuid(), newUuid()];
  const colors = ['#c02828', '#28a048', '#2848c0'];

  const renderAsset = (id: string, index: number, overrides: Record<string, unknown> = {}) => {
    const portrait = index === 1;
    const path = join(dir, `${index}.jpg`);
    return {
      id,
      type: AssetType.Image,
      originalPath: path,
      originalFileName: `IMG_${index}.jpg`,
      isEdited: false,
      localDateTime: new Date(`2025-05-0${index + 3}T10:00:00.000Z`),
      width: portrait ? 90 : 120,
      height: portrait ? 120 : 90,
      exifImageWidth: portrait ? 90 : 120,
      exifImageHeight: portrait ? 120 : 90,
      orientation: null,
      files: [{ type: AssetFileType.Preview, path, isEdited: false }],
      ...overrides,
    };
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'immich-collage-'));
    for (const [index, color] of colors.entries()) {
      const [width, height] = index === 1 ? [90, 120] : [120, 90];
      await sharp({ create: { width, height, channels: 3, background: color } })
        .jpeg()
        .toFile(join(dir, `${index}.jpg`));
    }
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const media = new MediaRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
    );
    ({ sut, mocks } = newTestService(CollageService, { media }));
    mocks.access.asset.checkOwnerAccess.mockImplementation((_, requested) => Promise.resolve(new Set(requested)));
    mocks.book.getAssetsForRender.mockResolvedValue(ids.map((id, index) => renderAsset(id, index)));
    mocks.book.getFaces.mockResolvedValue([]);
  });

  describe('getLayouts', () => {
    it('should rank the layouts for the photos, best first', async () => {
      const { layouts } = await sut.getLayouts(auth, { assetIds: ids, aspectRatio: '16:9' });
      expect(layouts[0]).toEqual({ id: 'hero-left-two', name: 'Hero left + two', description: expect.any(String) });
      expect(layouts.map(({ id }) => id)).toEqual(
        expect.arrayContaining(['hero-top-two', 'collage-3-columns', 'collage-3-rows']),
      );
    });

    it('should require access to the photos', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([ids[0]]));
      mocks.access.asset.checkAlbumAccess.mockResolvedValue(new Set());
      mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set());
      await expect(sut.getLayouts(auth, { assetIds: ids })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.getAssetsForRender).not.toHaveBeenCalled();
    });

    it('should refuse the same photo twice', async () => {
      await expect(sut.getLayouts(auth, { assetIds: [ids[0], ids[0]] })).rejects.toThrow('must be different');
    });

    it('should refuse a video', async () => {
      mocks.book.getAssetsForRender.mockResolvedValue([
        renderAsset(ids[0], 0),
        renderAsset(ids[1], 1, { type: AssetType.Video }),
        renderAsset(ids[2], 2),
      ]);
      await expect(sut.getLayouts(auth, { assetIds: ids })).rejects.toThrow('is not a photo');
    });

    it('should refuse a layout for another number of photos', async () => {
      await expect(sut.render(auth, { assetIds: ids, layout: 'four-grid' })).rejects.toThrow(
        'Valid layouts: hero-left-two',
      );
    });
  });

  describe('render', () => {
    it('should draw a preview of the photos with real sharp', async () => {
      const data = await sut.render(auth, { assetIds: ids, aspectRatio: '16:9', title: 'Palermo' });
      const { width, height, format } = await sharp(data).metadata();
      expect({ width, height, format }).toEqual({ width: 1000, height: 563, format: 'jpeg' });

      // every photo is drawn, and the title band is left for the title
      const { data: raw, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
      const shares = colors.map((color) => {
        const rgb = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
        let count = 0;
        for (let offset = 0; offset < raw.length; offset += info.channels) {
          if (rgb.every((value, c) => Math.abs(raw[offset + c] - value) < 30)) {
            count++;
          }
        }
        return count / (info.width * info.height);
      });
      for (const share of shares) {
        expect(share).toBeGreaterThan(0.1);
      }
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeLessThan(0.85);
    });

    it('should draw at full size from the originals', async () => {
      const data = await sut.render(auth, { assetIds: ids, aspectRatio: '4:5', full: true });
      const { width, height } = await sharp(data).metadata();
      expect({ width, height }).toEqual({ width: 2400, height: 3000 });
    });

    it('should draw with one of the user’s own styles', async () => {
      const styleId = newUuid();
      mocks.access.bookStyle.checkOwnerAccess.mockResolvedValue(new Set([styleId]));
      mocks.book.getStyle.mockResolvedValue({
        id: styleId,
        ownerId: auth.user.id,
        name: 'Night',
        description: '',
        style: { marginMm: 20, gutterMm: 4, background: '#101010', textColor: '#f0f0f0', fontFamily: 'serif' },
        createdAt: newDate(),
        updatedAt: newDate(),
        updateId: newUuidV7(),
      });

      const data = await sut.render(auth, { assetIds: ids, styleId });
      const { data: raw } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
      // the corner is the dark page of the style
      expect(Math.max(raw[0], raw[1], raw[2])).toBeLessThan(40);
      expect(mocks.book.getStyle).toHaveBeenCalledWith(styleId);
    });

    it('should require access to a style of the user', async () => {
      await expect(sut.render(auth, { assetIds: ids, styleId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mocks.crypto.randomUUID.mockReturnValue('collage-id');
      mocks.crypto.hashFile.mockResolvedValue(Buffer.from('checksum'));
      mocks.storage.stat.mockResolvedValue({ size: 1234 } as Stats);
      mocks.asset.create.mockImplementation((asset) => Promise.resolve({ ...AssetFactory.create(), ...asset }) as any);
      const last = AssetFactory.from({ id: ids[2], localDateTime: new Date('2025-05-05T10:00:00.000Z') }).build();
      mocks.asset.getById.mockResolvedValue(getForAsset(last));
    });

    it('should save the collage as a new photo tagged with its title', async () => {
      const result = await sut.create(auth, { assetIds: ids, title: 'Palermo', stylePreset: 'soft' });

      expect(result).toEqual({
        assetId: 'collage-id',
        duplicate: false,
        layout: 'hero-left-two',
        tag: 'Collages/Palermo',
      });
      expect(mocks.asset.getById).toHaveBeenCalledWith(ids[2], { exifInfo: true });
      const [path, data] = mocks.storage.createFile.mock.calls[0];
      expect(path).toMatch(/collage-id\.jpg$/);
      const metadata = await sharp(data as Buffer).metadata();
      expect(metadata.width).toBe(3000);
      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(
        path,
        expect.objectContaining({ TagsList: ['Collages/Palermo'], Description: 'Palermo' }),
      );
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AssetType.Image,
          originalFileName: 'Collage Palermo.jpg',
          ownerId: auth.user.id,
        }),
      );
      expect(mocks.stack.create).not.toHaveBeenCalled();
    });

    it('should tag a collage without a title with the dates of its photos', async () => {
      const result = await sut.create(auth, { assetIds: ids });
      expect(result.tag).toBe('Collages/3–5 May 2025');
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalFileName: 'Collage 3–5 May 2025.jpg' }),
      );
    });

    it('should add the collage to the album', async () => {
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      const addAssets = vi.spyOn(AlbumService.prototype, 'addAssets').mockResolvedValue([]);

      await sut.create(auth, { assetIds: ids, albumId });

      expect(addAssets).toHaveBeenCalledWith(auth, albumId, { ids: ['collage-id'] });
      addAssets.mockRestore();
    });

    it('should require access to the album', async () => {
      await expect(sut.create(auth, { assetIds: ids, albumId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.storage.createFile).not.toHaveBeenCalled();
    });
  });
});

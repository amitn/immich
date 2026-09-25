import { BadRequestException } from '@nestjs/common';
import { Stats } from 'node:fs';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetFileType, AssetType, Colorspace } from 'src/enum.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { computeImageStats } from 'src/utils/enhance.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { AssetExifLike, AssetLike } from 'test/factories/types.js';
import { getForAsset } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const PREVIEW_PATH = '/data/thumbs/preview.jpeg';

/** statistics of a dark, textured gradient: it needs levels and brighter midtones */
const darkStats = () => {
  const size = 64;
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const value = Math.round((((i % size) + Math.floor(i / size)) / (2 * size)) * 90 + ((i * 7) % 5));
    data.set([value, value * 0.9, value * 0.8], i * 3);
  }
  return computeImageStats(data, size, size, 3);
};

/** statistics of a photo that needs nothing */
const goodStats = () => {
  const size = 64;
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const t = ((i % size) + Math.floor(i / size)) / (2 * size - 2);
    const value = Math.round(255 * Math.min(1, Math.max(0, 1.2 * t ** 0.7 - 0.12)));
    data.set([value, value, value], i * 3);
  }
  return { ...computeImageStats(data, size, size, 3), sharpness: 1000 };
};

describe(EnhanceService.name, () => {
  let sut: EnhanceService;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const setupAsset = (dto: AssetLike = {}, exif: AssetExifLike = {}) => {
    const asset = AssetFactory.from({ ownerId: auth.user.id, originalFileName: 'IMG_0001.jpg', ...dto })
      .exif({ exifImageWidth: 4000, exifImageHeight: 3000, orientation: null, projectionType: null, iso: 100, ...exif })
      .file({ type: AssetFileType.Preview, path: PREVIEW_PATH, isEdited: false })
      .build();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    return asset;
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(EnhanceService));
    auth = AuthFactory.create();
    mocks.media.decodeImage.mockResolvedValue({
      data: Buffer.from('pixels'),
      info: { width: 4000, height: 3000, channels: 3 },
    } as any);
    mocks.media.getEnhanceStats.mockResolvedValue(darkStats());
    mocks.media.enhanceImage.mockResolvedValue({ data: Buffer.from('enhanced'), width: 4000, height: 3000 });
    mocks.media.renderEnhanceComparison.mockResolvedValue(Buffer.from('comparison'));
    mocks.storage.stat.mockResolvedValue({ size: 1000 } as Stats);
    mocks.crypto.randomUUID.mockReturnValue('new-asset-id');
    mocks.asset.create.mockImplementation((asset) => Promise.resolve({ ...AssetFactory.create(), ...asset }) as any);
    mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('analyze', () => {
    it('should require access', async () => {
      await expect(sut.analyze(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.asset.getById).not.toHaveBeenCalled();
    });

    it('should analyze the preview', async () => {
      const asset = setupAsset();

      const result = await sut.analyze(auth, asset.id, { strength: 'normal' });

      expect(result).toMatchObject({ assetId: asset.id, strength: 'normal', needed: true });
      expect(result.corrections.map(({ type }) => type)).toEqual(expect.arrayContaining(['levels', 'exposure']));
      expect(result.adjustments).toHaveLength(result.corrections.length);
      // the sharpening radius is scaled to the original
      expect(result.plan.sharpen?.sigma).toBe(1);
      expect(mocks.media.decodeImage).toHaveBeenCalledWith(PREVIEW_PATH, {
        colorspace: Colorspace.Srgb,
        processInvalidImages: false,
      });
    });

    it('should report a photo that needs nothing', async () => {
      const asset = setupAsset();
      mocks.media.getEnhanceStats.mockResolvedValue(goodStats());

      const result = await sut.analyze(auth, asset.id);

      expect(result).toMatchObject({ needed: false, adjustments: [], corrections: [], plan: {} });
      expect(result.notes.length).toBeGreaterThan(0);
    });

    it('should pass the ISO to the analysis', async () => {
      const asset = setupAsset({}, { iso: 12_800 });
      const result = await sut.analyze(auth, asset.id);
      expect(result.plan.denoise).toEqual({ size: 3 });
    });

    it('should restrict the corrections', async () => {
      const asset = setupAsset();
      const result = await sut.analyze(auth, asset.id, { only: ['exposure'] });
      expect(Object.keys(result.plan)).toEqual(['exposure']);
    });

    it('should require a preview', async () => {
      const asset = AssetFactory.from({ ownerId: auth.user.id }).exif().build();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getById.mockResolvedValue(getForAsset(asset));

      await expect(sut.analyze(auth, asset.id)).rejects.toThrow('preview');
    });
  });

  describe('renderEnhancePreview', () => {
    it('should render a before/after comparison of the preview', async () => {
      const asset = setupAsset();

      await expect(sut.renderEnhancePreview(auth, asset.id, { strength: 'subtle' })).resolves.toEqual(
        Buffer.from('comparison'),
      );
      expect(mocks.media.renderEnhanceComparison).toHaveBeenCalledWith(
        expect.objectContaining({ data: Buffer.from('pixels') }),
        expect.objectContaining({ exposure: expect.any(Object), sharpen: expect.objectContaining({ sigma: 0.56 }) }),
        { width: 1024 },
      );
    });
  });

  describe('createEnhancedCopy', () => {
    it('should require owner access', async () => {
      await expect(sut.createEnhancedCopy(auth, newUuid())).rejects.toThrow('asset.update');
      expect(mocks.media.decodeImage).not.toHaveBeenCalled();
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it.each([
      { name: 'videos', dto: { type: AssetType.Video }, error: 'Only photos' },
      { name: 'GIF images', dto: { originalFileName: 'IMG_0001.gif' }, error: 'GIF' },
      { name: 'SVG images', dto: { originalPath: '/data/library/drawing.svg' }, error: 'SVG' },
      { name: 'panoramas', exif: { projectionType: 'EQUIRECTANGULAR' }, error: 'panorama' },
      { name: 'Insta360 panoramas', dto: { originalFileName: 'VID_0001.insp' }, error: 'panorama' },
    ])('should refuse $name', async ({ dto, exif, error }) => {
      const asset = setupAsset(dto, exif);
      await expect(sut.createEnhancedCopy(auth, asset.id)).rejects.toThrow(error);
      expect(mocks.media.decodeImage).not.toHaveBeenCalled();
    });

    it('should refuse deleted assets', async () => {
      const asset = setupAsset({ deletedAt: new Date() });
      await expect(sut.createEnhancedCopy(auth, asset.id)).rejects.toThrow('Asset not found');
    });

    it('should create an enhanced copy stacked with the original', async () => {
      const asset = setupAsset();
      const createDerivedAsset = vi.spyOn(DerivedAssetService.prototype, 'createDerivedAsset');

      const result = await sut.createEnhancedCopy(auth, asset.id, { strength: 'normal' });

      expect(result).toEqual({
        id: 'new-asset-id',
        sourceId: asset.id,
        adjustments: expect.arrayContaining([expect.stringMatching(/^Brighter midtones/)]),
        duplicate: false,
      });
      // the full-resolution original is decoded, and the plan is computed from it
      expect(mocks.media.decodeImage).toHaveBeenCalledWith(
        asset.originalPath,
        expect.objectContaining({ size: undefined }),
      );
      expect(mocks.media.getEnhanceStats).toHaveBeenCalledWith(
        expect.objectContaining({ data: Buffer.from('pixels') }),
      );
      expect(mocks.media.enhanceImage).toHaveBeenCalledWith(
        expect.objectContaining({ data: Buffer.from('pixels') }),
        expect.objectContaining({ levels: expect.any(Object), exposure: expect.any(Object) }),
        { colorspace: Colorspace.Srgb, quality: 93 },
      );
      expect(createDerivedAsset).toHaveBeenCalledWith(
        auth,
        asset.id,
        { buffer: Buffer.from('enhanced'), extension: 'jpg' },
        { description: `Auto-enhanced: ${result.adjustments.join(', ')}`, suffix: 'enhanced', stack: true },
      );
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: auth.user.id, originalFileName: 'IMG_0001-enhanced.jpg' }),
      );
      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: auth.user.id }, [asset.id, 'new-asset-id']);
      // the original is never written to
      expect(mocks.storage.createFile).toHaveBeenCalledTimes(1);
      expect(mocks.storage.createFile).not.toHaveBeenCalledWith(asset.originalPath, expect.anything());
    });

    it('should apply only the requested corrections', async () => {
      const asset = setupAsset();

      const result = await sut.createEnhancedCopy(auth, asset.id, { only: ['levels'] });

      expect(result.adjustments).toEqual([expect.stringMatching(/^Auto levels/)]);
      expect(mocks.media.enhanceImage).toHaveBeenCalledWith(
        expect.anything(),
        { levels: expect.any(Object) },
        expect.anything(),
      );
    });

    it('should refuse a photo that does not need enhancing', async () => {
      const asset = setupAsset();
      mocks.media.getEnhanceStats.mockResolvedValue(goodStats());

      await expect(sut.createEnhancedCopy(auth, asset.id)).rejects.toThrow('does not need to be enhanced');
      expect(mocks.media.enhanceImage).not.toHaveBeenCalled();
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should return an existing identical copy', async () => {
      const asset = setupAsset();
      vi.spyOn(DerivedAssetService.prototype, 'createDerivedAsset').mockResolvedValue({
        id: 'existing-id',
        duplicate: true,
      });

      await expect(sut.createEnhancedCopy(auth, asset.id)).resolves.toMatchObject({
        id: 'existing-id',
        duplicate: true,
      });
    });
  });
});

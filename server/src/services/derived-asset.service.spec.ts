import { BadRequestException } from '@nestjs/common';
import { Stats } from 'node:fs';
import { AssetType, AssetVisibility, ChecksumAlgorithm, JobName } from 'src/enum.js';
import {
  DerivedAssetService,
  getArtworkTag,
  getBackfillTag,
  getDerivedExifTags,
} from 'src/services/derived-asset.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { getForAsset } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(DerivedAssetService.name, () => {
  let sut: DerivedAssetService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(DerivedAssetService));
    mocks.storage.stat.mockResolvedValue({ size: 1234 } as Stats);
    mocks.crypto.randomUUID.mockReturnValue('new-asset-id');
    mocks.asset.create.mockImplementation((asset) => Promise.resolve({ ...AssetFactory.create(), ...asset }) as any);
    mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);
  });

  const setup = (dto: { stackId?: string } = {}) => {
    const auth = AuthFactory.create();
    const source = AssetFactory.from({
      ownerId: auth.user.id,
      originalFileName: 'IMG_0001.HEIC',
      fileCreatedAt: new Date('2024-06-01T10:00:00.000Z'),
      localDateTime: new Date('2024-06-01T12:00:00.000Z'),
      stackId: dto.stackId ?? null,
    })
      .exif({
        dateTimeOriginal: new Date('2024-06-01T10:00:00.000Z'),
        timeZone: 'UTC+2',
        latitude: -33.8568,
        longitude: 151.2153,
        make: 'Apple',
        model: 'iPhone 15',
        lensModel: 'main camera',
        orientation: '6',
      })
      .build();

    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([source.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(source));
    return { auth, source };
  };

  describe('createDerivedAsset', () => {
    it('should require owner access to the source', async () => {
      const auth = AuthFactory.create();
      await expect(
        sut.createDerivedAsset(auth, newUuid(), { buffer: Buffer.from('image'), extension: 'jpg' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.asset.getById).not.toHaveBeenCalled();
      expect(mocks.storage.createFile).not.toHaveBeenCalled();
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should fail when the source does not exist', async () => {
      const auth = AuthFactory.create();
      const id = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([id]));
      mocks.asset.getById.mockResolvedValue(void 0);

      await expect(
        sut.createDerivedAsset(auth, id, { buffer: Buffer.from('image'), extension: 'jpg' }),
      ).rejects.toThrow('Asset not found');
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should reject unsupported file types', async () => {
      const { auth, source } = setup();
      await expect(
        sut.createDerivedAsset(auth, source.id, { buffer: Buffer.from('image'), extension: 'txt' }),
      ).rejects.toThrow('Unsupported image type');
      expect(mocks.storage.createFile).not.toHaveBeenCalled();
    });

    it('should create a copy and stack it with the source', async () => {
      const { auth, source } = setup();
      const buffer = Buffer.from('image');

      await expect(
        sut.createDerivedAsset(
          auth,
          source.id,
          { buffer, extension: 'jpg' },
          { description: 'Cropped from IMG_0001.HEIC', suffix: 'crop' },
        ),
      ).resolves.toEqual({ id: 'new-asset-id', duplicate: false });

      const path = expect.stringMatching(new RegExp(String.raw`upload/${auth.user.id}/.+/new-asset-id\.jpg$`));
      expect(mocks.storage.mkdirSync).toHaveBeenCalled();
      expect(mocks.storage.createFile).toHaveBeenCalledWith(path, buffer);
      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(path, {
        DateTimeOriginal: '2024:06:01 12:00:00',
        CreateDate: '2024:06:01 12:00:00',
        OffsetTimeOriginal: '+02:00',
        OffsetTime: '+02:00',
        Orientation: 'Horizontal (normal)',
        GPSLatitude: 33.8568,
        GPSLatitudeRef: 'S',
        GPSLongitude: 151.2153,
        GPSLongitudeRef: 'E',
        Make: 'Apple',
        Model: 'iPhone 15',
        LensModel: 'main camera',
        ImageDescription: 'Cropped from IMG_0001.HEIC',
        Description: 'Cropped from IMG_0001.HEIC',
        TagsList: ['Edits/Cropped'],
        HierarchicalSubject: ['Edits|Cropped'],
      });
      expect(mocks.crypto.hashFile).toHaveBeenCalledWith(path);
      expect(mocks.asset.create).toHaveBeenCalledWith({
        id: 'new-asset-id',
        ownerId: source.ownerId,
        libraryId: null,
        type: AssetType.Image,
        checksum: expect.anything(),
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
        originalPath: path,
        originalFileName: 'IMG_0001-crop.jpg',
        fileCreatedAt: source.fileCreatedAt,
        fileModifiedAt: expect.any(Date),
        localDateTime: source.localDateTime,
        visibility: AssetVisibility.Timeline,
      });
      expect(mocks.asset.upsertExif).toHaveBeenCalledWith({
        exif: { assetId: 'new-asset-id', fileSizeInByte: 1234, description: 'Cropped from IMG_0001.HEIC' },
        lockedPropertiesBehavior: 'override',
      });
      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: source.ownerId }, [source.id, 'new-asset-id']);
      expect(mocks.event.emit).toHaveBeenCalledWith('StackCreate', { stackId: 'stack-id', userId: source.ownerId });
      expect(mocks.event.emit).toHaveBeenCalledWith('AssetCreate', {
        asset: expect.objectContaining({ id: 'new-asset-id' }),
        file: expect.objectContaining({ size: 1234, originalPath: path }),
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetExtractMetadata,
        data: { id: 'new-asset-id', source: 'upload' },
      });
    });

    it('should add the copy to the existing stack of the source', async () => {
      const { auth, source } = setup({ stackId: 'existing-stack' });

      await sut.createDerivedAsset(auth, source.id, { path: '/tmp/output.png', extension: 'png' });

      expect(mocks.storage.copyFile).toHaveBeenCalledWith(
        '/tmp/output.png',
        expect.stringMatching(/new-asset-id\.png$/),
      );
      expect(mocks.stack.create).not.toHaveBeenCalled();
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: 'new-asset-id', stackId: 'existing-stack' });
      expect(mocks.event.emit).toHaveBeenCalledWith('StackUpdate', {
        stackId: 'existing-stack',
        userId: source.ownerId,
      });
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalFileName: 'IMG_0001-edit.png' }),
      );
    });

    it('should not stack when disabled', async () => {
      const { auth, source } = setup();

      await sut.createDerivedAsset(
        auth,
        source.id,
        { buffer: Buffer.from('image'), extension: 'jpg' },
        { stack: false },
      );

      expect(mocks.stack.create).not.toHaveBeenCalled();
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    it('should return the existing asset for a duplicate', async () => {
      const { auth, source } = setup();
      mocks.asset.create.mockRejectedValue({ constraint_name: 'UQ_assets_owner_checksum' });
      mocks.asset.getUploadAssetIdByChecksum.mockResolvedValue('existing-id');

      await expect(
        sut.createDerivedAsset(auth, source.id, { buffer: Buffer.from('image'), extension: 'jpg' }),
      ).resolves.toEqual({ id: 'existing-id', duplicate: true });

      expect(mocks.storage.unlink).toHaveBeenCalledWith(expect.stringMatching(/new-asset-id\.jpg$/));
      expect(mocks.stack.create).not.toHaveBeenCalled();
      expect(mocks.event.emit).not.toHaveBeenCalledWith('AssetCreate', expect.anything());
    });

    it('should enforce the storage quota', async () => {
      const { source } = setup();
      const auth = AuthFactory.create({ id: source.ownerId, quotaSizeInBytes: 1000, quotaUsageInBytes: 500 });

      await expect(
        sut.createDerivedAsset(auth, source.id, { buffer: Buffer.from('image'), extension: 'jpg' }),
      ).rejects.toThrow('Quota has been exceeded');

      expect(mocks.asset.create).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [expect.stringMatching(/new-asset-id\.jpg$/)] },
      });
    });

    it('should remove the asset when stacking fails', async () => {
      const { auth, source } = setup();
      mocks.stack.create.mockRejectedValue(new Error('boom'));

      await expect(
        sut.createDerivedAsset(auth, source.id, { buffer: Buffer.from('image'), extension: 'jpg' }),
      ).rejects.toThrow('boom');

      expect(mocks.asset.remove).toHaveBeenCalledWith({ id: 'new-asset-id' });
      expect(mocks.job.queue).toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FileDelete }));
    });
  });

  describe('tags', () => {
    it('should write explicit tags into the file', async () => {
      const { auth, source } = setup();
      await sut.createDerivedAsset(
        auth,
        source.id,
        { buffer: Buffer.from('art'), extension: 'png' },
        { suffix: 'watercolor', tags: [getArtworkTag('Watercolor')] },
      );
      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          TagsList: ['AI Artwork/Watercolor'],
          HierarchicalSubject: ['AI Artwork|Watercolor'],
        }),
      );
    });

    it('should not tag unknown kinds of copies', async () => {
      const { auth, source } = setup();
      await sut.createDerivedAsset(auth, source.id, { buffer: Buffer.from('x'), extension: 'jpg' }, { suffix: 'edit' });
      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({ TagsList: expect.anything() }),
      );
    });

    it('should name artwork tags after the style', () => {
      expect(getArtworkTag('Gouache travel poster')).toBe('AI Artwork/Gouache travel poster');
      expect(getArtworkTag(null)).toBe('AI Artwork/Custom style');
      expect(getArtworkTag('Pen/ink')).toBe('AI Artwork/Pen-ink');
    });

    it.each([
      [
        { artJobId: 'job', style: 'watercolor-editorial-split', originalFileName: 'a-watercolor.png' },
        'AI Artwork/Editorial watercolor split',
      ],
      [{ artJobId: 'job', style: null, originalFileName: 'a-art.png' }, 'AI Artwork/Custom style'],
      [{ artJobId: null, style: null, originalFileName: 'IMG_1-crop.jpg' }, 'Edits/Cropped'],
      [{ artJobId: null, style: null, originalFileName: 'IMG_1-straight.jpg' }, 'Edits/Straightened'],
      [{ artJobId: null, style: null, originalFileName: 'IMG_1-map.png' }, 'Photo books/Maps'],
      [{ artJobId: null, style: null, originalFileName: 'IMG_1.jpg' }, undefined],
    ])('should pick the backfill tag for %o', (asset, expected) => {
      expect(getBackfillTag(asset)).toBe(expected);
    });

    it('should tag earlier copies on startup through the tag service', async () => {
      const user = AuthFactory.create().user;
      mocks.artJob.getDerivedAssetsForTagging.mockResolvedValue([
        {
          assetId: 'art-1',
          ownerId: user.id,
          artJobId: 'job-1',
          style: 'watercolor',
          originalFileName: 'a-watercolor.png',
        },
        { assetId: 'crop-1', ownerId: user.id, artJobId: null, style: null, originalFileName: 'b-crop.jpg' },
      ]);
      mocks.agent.getAuthUser.mockResolvedValue(user as never);
      mocks.tag.upsertValue.mockImplementation(({ value }) => Promise.resolve({ id: `tag:${value}`, value } as never));
      mocks.access.tag.checkOwnerAccess.mockImplementation((_, ids) => Promise.resolve(ids));
      mocks.access.asset.checkOwnerAccess.mockImplementation((_, ids) => Promise.resolve(ids));
      mocks.tag.getAssetIds.mockResolvedValue(new Set());
      mocks.asset.getForUpdateTags.mockResolvedValue({ tags: [] } as never);

      await sut.onBootstrap();

      expect(mocks.tag.addAssetIds).toHaveBeenCalledWith('tag:AI Artwork/Watercolor', ['art-1']);
      expect(mocks.tag.addAssetIds).toHaveBeenCalledWith('tag:Edits/Cropped', ['crop-1']);
      expect(mocks.event.emit).toHaveBeenCalledWith('AssetTag', { assetId: 'art-1', userId: user.id });
    });
  });

  describe('getDerivedExifTags', () => {
    it('should fall back to the local date time without a time zone', () => {
      expect(
        getDerivedExifTags(
          {
            dateTimeOriginal: '2024-06-01T10:00:00.000Z',
            timeZone: null,
            latitude: null,
            longitude: null,
            make: null,
            model: null,
            lensModel: null,
          },
          '2024-06-01T12:00:00.000Z',
        ),
      ).toEqual({
        DateTimeOriginal: '2024:06:01 12:00:00',
        CreateDate: '2024:06:01 12:00:00',
        Orientation: 'Horizontal (normal)',
      });
    });

    it('should handle a source without exif', () => {
      expect(getDerivedExifTags(null, new Date('2024-06-01T12:00:00.000Z'), 'desc')).toEqual({
        DateTimeOriginal: '2024:06:01 12:00:00',
        CreateDate: '2024:06:01 12:00:00',
        Orientation: 'Horizontal (normal)',
        ImageDescription: 'desc',
        Description: 'desc',
      });
    });

    it('should write western longitudes and northern latitudes', () => {
      expect(
        getDerivedExifTags(
          {
            dateTimeOriginal: null,
            timeZone: null,
            latitude: 40.7,
            longitude: -74,
            make: null,
            model: null,
            lensModel: null,
          },
          '2024-06-01T12:00:00.000Z',
        ),
      ).toMatchObject({ GPSLatitude: 40.7, GPSLatitudeRef: 'N', GPSLongitude: 74, GPSLongitudeRef: 'W' });
    });
  });
});

import { Kysely } from 'kysely';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { StorageCore } from 'src/cores/storage.core.js';
import { AssetFileType, AssetType } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { CropAgentTools } from 'src/services/agent-tools/crop.tools.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;
let mediaLocation: string;

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(CropAgentTools, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      CryptoRepository,
      MediaRepository,
      MetadataRepository,
      PersonRepository,
      StackRepository,
      StorageRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  return { sut, ctx };
};

/** a grey 400x300 photo with a red square at (300, 100) */
const createImage = async (path: string, width = 400, height = 300) => {
  const square = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#ff2020' } })
    .png()
    .toBuffer();
  await sharp({ create: { width, height, channels: 3, background: '#808080' } })
    .composite([{ input: square, left: 300, top: 100 }])
    .jpeg({ quality: 90 })
    .toFile(path);
};

const createSource = async (ctx: ReturnType<typeof setup>['ctx'], ownerId: string) => {
  const originalPath = join(mediaLocation, `${factory.uuid()}.jpg`);
  const previewPath = join(mediaLocation, `${factory.uuid()}-preview.jpg`);
  await createImage(originalPath);
  await createImage(previewPath);

  const { asset } = await ctx.newAsset({
    ownerId,
    type: AssetType.Image,
    originalPath,
    originalFileName: 'IMG_0001.jpg',
    fileCreatedAt: new Date('2024-06-01T10:00:00.000Z'),
    localDateTime: new Date('2024-06-01T12:00:00.000Z'),
  });
  await ctx.newExif({
    assetId: asset.id,
    exifImageWidth: 400,
    exifImageHeight: 300,
    orientation: '1',
    dateTimeOriginal: new Date('2024-06-01T10:00:00.000Z'),
    timeZone: 'UTC+2',
    latitude: 41.9,
    longitude: 12.5,
    make: 'Canon',
    model: 'EOS R5',
  });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: previewPath });
  return asset;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  mediaLocation = await mkdtemp(join(tmpdir(), 'immich-crop-'));
  StorageCore.setMediaLocation(mediaLocation);
});

afterAll(async () => {
  await rm(mediaLocation, { recursive: true, force: true });
});

describe('cropped copies', () => {
  it('should create a cropped copy stacked with the original', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    const source = await createSource(ctx, user.id);
    await ctx.newAssetFace({
      assetId: source.id,
      imageWidth: 400,
      imageHeight: 300,
      boundingBoxX1: 180,
      boundingBoxY1: 60,
      boundingBoxX2: 240,
      boundingBoxY2: 130,
    });

    const result = await sut.createCroppedCopy(auth, source.id, { aspectRatio: '1:1' });
    expect(result).toEqual({ id: expect.any(String), sourceId: source.id, width: 300, height: 300, duplicate: false });

    const copy = await ctx.get(AssetRepository).getById(result.id, { exifInfo: true });
    expect(copy).toMatchObject({
      ownerId: user.id,
      type: AssetType.Image,
      originalFileName: 'IMG_0001-crop.jpg',
      fileCreatedAt: source.fileCreatedAt,
      localDateTime: source.localDateTime,
      libraryId: null,
    });
    expect(copy!.originalPath.startsWith(join(mediaLocation, 'upload', user.id))).toBe(true);
    expect(copy!.exifInfo).toMatchObject({ description: 'Cropped from IMG_0001.jpg' });

    const { width, height } = await sharp(copy!.originalPath).metadata();
    expect({ width, height }).toEqual({ width: 300, height: 300 });

    const tags = await ctx.get(MetadataRepository).readTags(copy!.originalPath);
    expect(tags).toMatchObject({
      Make: 'Canon',
      Model: 'EOS R5',
      Orientation: 1,
      OffsetTimeOriginal: '+02:00',
      GPSLatitude: 41.9,
      GPSLongitude: 12.5,
      ImageDescription: 'Cropped from IMG_0001.jpg',
      TagsList: ['Edits/Cropped'],
      HierarchicalSubject: ['Edits|Cropped'],
    });
    expect(String(tags.DateTimeOriginal)).toContain('2024-06-01T12:00:00');

    const [updatedSource] = await ctx.get(AssetRepository).getByIds([source.id]);
    expect(updatedSource.stackId).not.toBeNull();
    expect(copy!.stackId).toBe(updatedSource.stackId);
    const stack = await ctx.get(StackRepository).getById(updatedSource.stackId!);
    expect(stack?.primaryAssetId).toBe(source.id);

    expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith(
      'AssetCreate',
      expect.objectContaining({ asset: expect.objectContaining({ id: result.id }) }),
    );
  });

  it('should add the copy to an existing stack and return duplicates', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    const source = await createSource(ctx, user.id);
    const { asset: sibling } = await ctx.newAsset({ ownerId: user.id });
    const stack = await ctx.get(StackRepository).create({ ownerId: user.id }, [source.id, sibling.id]);

    const rect = { x: 100, y: 50, width: 200, height: 150 };
    const first = await sut.createCroppedCopy(auth, source.id, { rect });
    expect(first).toMatchObject({ width: 200, height: 150, duplicate: false });

    const [copy] = await ctx.get(AssetRepository).getByIds([first.id]);
    expect(copy.stackId).toBe(stack.id);
    await expect(ctx.get(StackRepository).getById(stack.id)).resolves.toMatchObject({ primaryAssetId: source.id });

    const second = await sut.createCroppedCopy(auth, source.id, { rect });
    expect(second).toMatchObject({ id: first.id, duplicate: true });
  });

  it('should not crop a photo of another user', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { user: other } = await ctx.newUser();
    const source = await createSource(ctx, other.id);

    await expect(sut.createCroppedCopy(factory.auth({ user }), source.id, { aspectRatio: '1:1' })).rejects.toThrow(
      'Not found or no asset.update access',
    );
  });

  it('should suggest a crop around the salient region without faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const source = await createSource(ctx, user.id);

    const suggestion = await sut.getCropSuggestion(factory.auth({ user }), source.id, '1:2');
    expect(suggestion).toMatchObject({ basis: 'saliency', feasible: true, rect: { width: 150, height: 300 } });
    // the red square spans 300..360
    expect(suggestion.rect.x).toBeLessThanOrEqual(300);
    expect(suggestion.rect.x + suggestion.rect.width).toBeGreaterThanOrEqual(360);

    const preview = await sut.renderCropPreview(factory.auth({ user }), source.id, suggestion.rectNormalized);
    const metadata = await sharp(preview!).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 150, height: 300 });
  });
});

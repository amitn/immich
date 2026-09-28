import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Kysely } from 'kysely';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { S3StorageBackend } from 'src/backends/s3-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import {
  AssetFileType,
  AssetType,
  BookExportStatus,
  JobName,
  JobStatus,
  StorageFolder,
  SystemMetadataKey,
} from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AcpRepository } from 'src/repositories/acp.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AgentRepository } from 'src/repositories/agent.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { ArtJobRepository } from 'src/repositories/art-job.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { BookDraftRepository } from 'src/repositories/book-draft.repository.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { HighlightJobRepository } from 'src/repositories/highlight-job.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { MapRepository } from 'src/repositories/map.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { NotificationRepository } from 'src/repositories/notification.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { TelemetryRepository } from 'src/repositories/telemetry.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { CropAgentTools } from 'src/services/agent-tools/crop.tools.js';
import { ArtService } from 'src/services/art.service.js';
import { BookService } from 'src/services/book.service.js';
import { CollageService } from 'src/services/collage.service.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { FoodService } from 'src/services/food.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { OrientationService } from 'src/services/orientation.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { ImmichRedirectResponse } from 'src/utils/file.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

/**
 * The assistant's features against a real S3 backend: MinIO, as noodle's storage CI runs it. Start one with e.g.
 *   docker run -d --name immich_acp_minio -p 127.0.0.1:59000:9000 -e MINIO_ROOT_USER=minioadmin \
 *     -e MINIO_ROOT_PASSWORD=minioadmin cgr.dev/chainguard/minio server /data
 * and run with IMMICH_TEST_S3_ENDPOINT=http://127.0.0.1:59000 (and ffmpeg on the PATH, for the highlight video).
 */
const endpoint = process.env.IMMICH_TEST_S3_ENDPOINT;
const credentials = { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' };
const exec = promisify(execFile);

let database: Kysely<DB>;
let mediaLocation: string;
let temporary: string;
let previousTmpdir: string | undefined;
let s3: S3StorageBackend;
let bucket: string;
/** the contexts of the tests, whose exiftool processes are ended after them */
const contexts: MediumTestContext[] = [];

/** every file under a folder */
const listFiles = async (folder: string) => {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
};

/** nothing was left behind: no temporary copies, and no media on the server's disk but the map tile cache */
const expectNothingLeft = async () => {
  expect(await listFiles(temporary)).toEqual([]);
  const local = await listFiles(mediaLocation);
  expect(local.filter((path) => !path.includes('/.cache/map-tiles/'))).toEqual([]);
};

const read = async (key: string) => {
  const { stream } = await s3.get(key);
  return buffer(stream);
};

const metadataOf = (data: Buffer) => sharp(data).metadata();

/** an OCR box of the machine learning service, normalized to the image */
const box = (text: string, left: number, top: number, height = 0.022) => {
  const right = left + text.length * height * 0.45;
  return { text, box: [left, top, right, top, right, top + height, left, top + height] };
};

const setup = () => {
  const { sut, ctx } = newMediumService(BookService, {
    database,
    real: [
      AccessRepository,
      AcpRepository,
      ActivityLogRepository,
      AgentRepository,
      AlbumRepository,
      ArtJobRepository,
      AssetJobRepository,
      AssetRepository,
      BookDraftRepository,
      BookRepository,
      ConfigRepository,
      CryptoRepository,
      HighlightJobRepository,
      MediaRepository,
      MetadataRepository,
      NotificationRepository,
      OcrRepository,
      PartnerRepository,
      PersonRepository,
      SearchRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      StackRepository,
      StorageRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [
      EventRepository,
      JobRepository,
      LoggingRepository,
      MachineLearningRepository,
      MapRepository,
      TelemetryRepository,
      WebsocketRepository,
    ],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  contexts.push(ctx);
  return { sut, ctx };
};

/** a JPEG with a dark, slightly blue gradient and some texture: it needs levels and brighter midtones */
const createJpeg = async (width: number, height: number, tint = [0, 0, 0]) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = 12 + Math.round(((x + y) / (width + height)) * 80) + ((x * 7 + y * 13) % 9);
      data.set([value + tint[0], value + 4 + tint[1], value + 14 + tint[2]], (y * width + x) * 3);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
};

/** a photo whose original and previews are only in S3, with the keys uploads get */
const newS3Photo = async (
  ctx: MediumTestContext,
  ownerId: string,
  {
    width = 1200,
    height = 900,
    tint,
    localDateTime,
  }: { width?: number; height?: number; tint?: number[]; localDateTime?: Date } = {},
) => {
  const id = factory.uuid();
  const originalPath = StorageCore.getRelativeNestedPath(StorageFolder.Upload, ownerId, `${id}.jpg`);
  const previewPath = StorageCore.getRelativeNestedPath(StorageFolder.Thumbnails, ownerId, `${id}_preview.jpeg`);
  const thumbnailPath = StorageCore.getRelativeNestedPath(StorageFolder.Thumbnails, ownerId, `${id}_thumbnail.webp`);
  const original = await createJpeg(width, height, tint);
  await s3.put(originalPath, original, { contentType: 'image/jpeg' });
  await s3.put(previewPath, await sharp(original).resize(720).jpeg().toBuffer(), { contentType: 'image/jpeg' });
  await s3.put(thumbnailPath, await sharp(original).resize(250).webp().toBuffer(), { contentType: 'image/webp' });

  const date = localDateTime ?? new Date('2024-06-12T12:00:00.000Z');
  const { asset } = await ctx.newAsset({
    id,
    ownerId,
    type: AssetType.Image,
    originalPath,
    originalFileName: `IMG_${id.slice(0, 4)}.jpg`,
    fileCreatedAt: date,
    localDateTime: date,
    width,
    height,
  });
  await ctx.newExif({
    assetId: id,
    exifImageWidth: width,
    exifImageHeight: height,
    orientation: '1',
    colorspace: 'sRGB',
    bitsPerSample: 8,
    dateTimeOriginal: date,
    timeZone: 'UTC',
  });
  await ctx.newAssetFile({ assetId: id, type: AssetFileType.Preview, path: previewPath });
  await ctx.newAssetFile({ assetId: id, type: AssetFileType.Thumbnail, path: thumbnailPath });
  return asset;
};

const newOwner = async (ctx: MediumTestContext) => {
  const { user } = await ctx.newUser();
  return { user, auth: factory.auth({ user }) };
};

/** the stored asset of a new copy: in S3, and a JPEG */
const expectStoredImage = async (ctx: MediumTestContext, id: string) => {
  const asset = await ctx.get(AssetRepository).getById(id);
  expect(asset!.originalPath).toMatch(/^upload\//);
  const data = await read(asset!.originalPath);
  const { format, width } = await sharp(data).metadata();
  expect(format).toBe('jpeg');
  expect(width).toBeGreaterThan(0);
  return { asset: asset!, data };
};

describe.skipIf(!endpoint)('assistant features with S3 storage (MinIO)', () => {
  beforeAll(async () => {
    database = await getKyselyDB();
    mediaLocation = await mkdtemp(join(tmpdir(), 'immich-s3-media-'));
    StorageCore.setMediaLocation(mediaLocation);
    temporary = await mkdtemp(join(tmpdir(), 'immich-s3-tmp-'));

    // the temporary copies of downloadToTemp, and the work folders of art jobs, go here
    previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = temporary;

    bucket = `immich-assistant-${Date.now()}`;
    const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    client.destroy();

    s3 = new S3StorageBackend({
      bucket,
      region: 'us-east-1',
      endpoint,
      ...credentials,
      presignedUrlExpiry: 3600,
      serveMode: 'redirect',
    });
    (StorageService as any).diskBackend = new DiskStorageBackend(mediaLocation);
    (StorageService as any).s3Backend = s3;
    (StorageService as any).writeBackendType = 's3';
  });

  afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.get(MetadataRepository).teardown();
    }
    process.env.TMPDIR = previousTmpdir;
    (StorageService as any).s3Backend = undefined;
    (StorageService as any).writeBackendType = 'disk';
    await s3.deletePrefix('');
    const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials });
    await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
    client.destroy();
    await rm(mediaLocation, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should make an enhanced copy', async () => {
    const { ctx } = setup();
    const { auth } = await newOwner(ctx);
    const photo = await newS3Photo(ctx, auth.user.id, { tint: [0, 0, 20] });

    const result = await ctx.getService(EnhanceService).createEnhancedCopy(auth, photo.id);

    expect(result.adjustments.length).toBeGreaterThan(0);
    const { asset, data } = await expectStoredImage(ctx, result.id);
    expect(asset.originalFileName).toMatch(/-enhanced\.jpg$/);
    // the metadata was written into the copy before it was stored
    const local = join(mediaLocation, 'check.jpg');
    await ctx.get(StorageRepository).createFile(local, data);
    const tags = await ctx.get(MetadataRepository).readTags(local);
    await rm(local);
    expect(tags).toMatchObject({ TagsList: ['Edits/Enhanced'], Description: expect.stringMatching(/^Auto-enhanced/) });
    await expectNothingLeft();
  });

  it('should make a straightened and cropped copy, and check the crop on the preview', async () => {
    const { ctx } = setup();
    const { auth } = await newOwner(ctx);
    const photo = await newS3Photo(ctx, auth.user.id);
    const tools = ctx.getService(CropAgentTools);

    const preview = await tools.renderCropPreview(auth, photo.id, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 3);
    const { format } = await metadataOf(preview!);
    expect(format).toBe('jpeg');
    const result = await tools.createCroppedCopy(auth, photo.id, {
      rectNormalized: { x: 0.1, y: 0.1, width: 0.6, height: 0.6 },
      rotate: 3,
    });

    const { asset } = await expectStoredImage(ctx, result.id);
    expect(asset.originalFileName).toMatch(/-straight\.jpg$/);
    await expectNothingLeft();
  });

  it('should make an artwork with a fake art agent', async () => {
    const { ctx } = setup();
    const { auth } = await newOwner(ctx);
    const photo = await newS3Photo(ctx, auth.user.id);
    await ctx.get(SystemMetadataRepository).set(SystemMetadataKey.SystemConfig, {
      agent: {
        enabled: true,
        artProfile: 'fake',
        profiles: [{ name: 'fake', command: 'fake-art-agent', args: [], env: [], passEnv: [] }],
      },
    });
    clearConfigCache();
    const artwork = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#d08040' } })
      .png()
      .toBuffer();
    let sourceSent: string | undefined;
    vi.spyOn(ctx.get(AcpRepository), 'start').mockImplementation(({ handlers, cwd }) =>
      Promise.resolve({
        pid: 1,
        cwd,
        initialize: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true } } },
        newSession: () => Promise.resolve({ sessionId: 'fake' }),
        loadSession: () => Promise.resolve(),
        prompt: async (_, prompt) => {
          sourceSent = (prompt.find((block) => block.type === 'image') as { data: string } | undefined)?.data;
          await handlers.onUpdate({
            sessionId: 'fake',
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'image',
              status: 'completed',
              content: [
                {
                  type: 'content',
                  content: { type: 'image', data: artwork.toString('base64'), mimeType: 'image/png' },
                },
              ],
            },
          } as never);
          return { stopReason: 'end_turn' };
        },
        cancel: () => Promise.resolve(),
        kill: () => Promise.resolve(),
        isAlive: () => true,
      }),
    );
    const art = ctx.getService(ArtService);

    // a split style: the original is decoded and stacked above the artwork
    const job = await art.createJob(auth, { assetId: photo.id, style: 'watercolor-editorial-split' });
    const done = await art.waitForJob(auth, job.id, 60_000);

    expect(done).toMatchObject({ status: 'completed', error: null });
    // the preview sent to the agent was read from S3
    const previewFile = await ctx.get(AssetRepository).getForThumbnail(photo.id, AssetFileType.Preview, true);
    const preview = await read(previewFile.path!);
    expect(sourceSent).toBe(preview.toString('base64'));
    const { asset } = await expectStoredImage(ctx, done.resultAssetId!);
    expect(asset.originalFileName).toMatch(/-watercolor-editorial-split\.jpg$/);
    clearConfigCache();
    await ctx.get(SystemMetadataRepository).set(SystemMetadataKey.SystemConfig, {});
    await expectNothingLeft();
  });

  it('should make a collage', async () => {
    const { ctx } = setup();
    const { auth } = await newOwner(ctx);
    const photos = [
      await newS3Photo(ctx, auth.user.id, { tint: [60, 0, 0] }),
      await newS3Photo(ctx, auth.user.id, { width: 900, height: 1200, tint: [0, 60, 0] }),
      await newS3Photo(ctx, auth.user.id, { tint: [0, 0, 60] }),
    ];

    const preview = await ctx.getService(CollageService).render(auth, { assetIds: photos.map(({ id }) => id) });
    const { width: previewWidth } = await metadataOf(preview);
    expect(previewWidth).toBe(1000);
    const result = await ctx
      .getService(CollageService)
      .create(auth, { assetIds: photos.map(({ id }) => id), title: 'Sicily' });

    const { data } = await expectStoredImage(ctx, result.assetId);
    const { width } = await metadataOf(data);
    expect(width).toBe(3000);
    await expectNothingLeft();
  });

  it('should make a book, and export, serve and make again its PDF and HTML', async () => {
    const { sut, ctx } = setup();
    const { auth } = await newOwner(ctx);
    const photos = [await newS3Photo(ctx, auth.user.id), await newS3Photo(ctx, auth.user.id, { tint: [40, 20, 0] })];
    const book = await sut.create(auth, { title: 'Sicily' });
    for (const photo of photos) {
      const page = await sut.addPage(auth, book.id, { layout: 'single' });
      await sut.setSlot(auth, book.id, page.id, 0, { assetId: photo.id });
    }

    const [first] = await ctx.get(BookRepository).getPages(book.id);
    const page = await sut.renderPage(auth, book.id, first.id);
    // every photo was drawn
    expect(page.warnings.filter(({ type }) => type === 'missing-asset' || type === 'render-error')).toEqual([]);

    await expect(sut.handleBookExport({ id: book.id })).resolves.toBe(JobStatus.Success);
    await expect(sut.handleBookExportHtml({ id: book.id })).resolves.toBe(JobStatus.Success);

    const stored = await ctx.get(BookRepository).get(book.id);
    expect(stored).toMatchObject({
      exportPath: `thumbs/${auth.user.id}/books/${book.id}.pdf`,
      htmlExportPath: `thumbs/${auth.user.id}/books/${book.id}.html`,
      exportStatus: BookExportStatus.Completed,
    });
    const pdfData = await read(stored!.exportPath!);
    expect(pdfData.subarray(0, 5).toString()).toBe('%PDF-');
    const htmlData = await read(stored!.htmlExportPath!);
    const html = htmlData.toString();
    expect(html).toContain('<!doctype html>');
    expect(html.match(/data:image\/jpeg;base64,/g)?.length).toBe(2);

    // served by a presigned URL of MinIO
    const pdf = await sut.downloadPdf(auth, book.id);
    expect(pdf).toBeInstanceOf(ImmichRedirectResponse);
    const response = await fetch((pdf as ImmichRedirectResponse).url);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');

    // a lost export is made again
    await s3.delete(stored!.exportPath!);
    await expect(sut.downloadPdf(auth, book.id)).rejects.toThrow('being made again');
    expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledWith({ name: JobName.BookExport, data: { id: book.id } });
    await expect(sut.handleBookExport({ id: book.id })).resolves.toBe(JobStatus.Success);
    await expect(sut.downloadPdf(auth, book.id)).resolves.toBeInstanceOf(ImmichRedirectResponse);
    await expectNothingLeft();
  });

  it('should make a highlight video with music', async () => {
    const { ctx } = setup();
    const { auth } = await newOwner(ctx);
    const photos = [];
    for (let index = 0; index < 4; index++) {
      photos.push(
        await newS3Photo(ctx, auth.user.id, {
          tint: [index * 20, 0, 0],
          localDateTime: new Date(Date.UTC(2024, 5, 12, 10, index * 10)),
        }),
      );
    }

    // a clip in S3, and music uploaded through the service
    const work = await mkdtemp(join(tmpdir(), 'immich-s3-ffmpeg-'));
    try {
      const clipFile = join(work, 'clip.mp4');
      const testSource = [
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440',
      ];
      const encode = ['-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipFile];
      await exec('ffmpeg', [...testSource, ...encode]);
      const musicFile = join(work, 'song.mp3');
      await exec('ffmpeg', ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=20', '-c:a', 'libmp3lame', musicFile]);

      const clipId = factory.uuid();
      const clipKey = StorageCore.getRelativeNestedPath(StorageFolder.Upload, auth.user.id, `${clipId}.mp4`);
      await s3.put(clipKey, await readFile(clipFile), { contentType: 'video/mp4' });
      await ctx.newAsset({
        id: clipId,
        ownerId: auth.user.id,
        type: AssetType.Video,
        originalPath: clipKey,
        originalFileName: 'clip.mp4',
        duration: 6000,
        width: 640,
        height: 360,
        isFavorite: true,
        fileCreatedAt: new Date(Date.UTC(2024, 5, 12, 10, 15)),
        localDateTime: new Date(Date.UTC(2024, 5, 12, 10, 15)),
      } as never);
      await ctx.newExif({ assetId: clipId, exifImageWidth: 640, exifImageHeight: 360, rating: 5 });

      const highlights = ctx.getService(HighlightService);
      const song = await readFile(musicFile);
      const music = await highlights.uploadMusic(auth, {
        originalname: 'song.mp3',
        buffer: song,
        size: song.length,
      } as Express.Multer.File);
      const musicAsset = await ctx.get(AssetRepository).getById(music.id);
      expect(musicAsset!.originalPath).toMatch(/^upload\/.+\.mp3$/);
      expect(await s3.exists(musicAsset!.originalPath)).toBe(true);

      const ffmpeg = vi.spyOn(ctx.get(MediaRepository), 'runFfmpeg');
      const job = await highlights.create(auth, {
        assetIds: [...photos.map(({ id }) => id), clipId],
        title: 'Sicily',
        durationSeconds: 15,
        includeMaps: false,
        music: music.id,
      });
      await expect(highlights.handleRender({ id: job.id })).resolves.toBe(JobStatus.Success);

      const done = await ctx.get(HighlightJobRepository).get(job.id);
      expect(done).toMatchObject({ status: 'completed' });
      // the clip was read from a presigned URL of MinIO, the music from a local copy
      const commands = ffmpeg.mock.calls.map(([args]) => args.join(' '));
      expect(commands.some((command) => command.includes(`${endpoint}/${bucket}/${clipKey}?`))).toBe(true);
      expect(commands.at(-1)).toContain('-stream_loop -1 -i ' + temporary);
      const video = await ctx.get(AssetRepository).getById(done!.resultAssetId!);
      expect(video).toMatchObject({ type: AssetType.Video, originalFileName: 'Sicily.mp4' });
      expect(video!.originalPath).toMatch(/^upload\/.+\.mp4$/);
      const film = join(work, 'film.mp4');
      await ctx.get(StorageRepository).createFile(film, await read(video!.originalPath));
      const info = await ctx.get(MediaRepository).probe(film);
      expect(info.format.duration).toBeGreaterThan(10);
      expect(info.audioStreams).toHaveLength(1);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    await expectNothingLeft();
  }, 240_000);

  it('should name the dishes of a meal from a menu read at full resolution', async () => {
    const { ctx } = setup();
    const { auth } = await newOwner(ctx);
    const menu = await newS3Photo(ctx, auth.user.id, { width: 2000, height: 1400 });
    const carbonara = await newS3Photo(ctx, auth.user.id, { localDateTime: new Date('2024-06-12T20:30:00.000Z') });
    const tiramisu = await newS3Photo(ctx, auth.user.id, { localDateTime: new Date('2024-06-12T21:30:00.000Z') });

    const lines = [
      box('PRIMI', 0.1, 0.12, 0.03),
      box('Spaghetti alla carbonara', 0.1, 0.18),
      box('12,00', 0.8, 0.18),
      box('Pasta alla Norma', 0.1, 0.24),
      box('11,00', 0.8, 0.24),
      box('DOLCI', 0.1, 0.32, 0.03),
      box('Tiramisù', 0.1, 0.38),
      box('6,00', 0.8, 0.38),
      box('Cannolo', 0.1, 0.44),
      box('5,00', 0.8, 0.44),
    ];
    const ml = ctx.getMock(MachineLearningRepository);
    ml.ocr.mockResolvedValue({
      text: lines.map(({ text }) => text),
      box: lines.flatMap(({ box }) => box),
      boxScore: lines.map(() => 0.9),
      textScore: lines.map(() => 0.95),
    });
    const vectors: Record<string, number[]> = {
      carbonara: [1, 0, 0, 0],
      norma: [0, 0, 1, 0],
      tiramisù: [0, 1, 0, 0],
      cannolo: [0, 0, 0, 1],
    };
    ml.encodeText.mockImplementation((text: string) => {
      const [, vector] = Object.entries(vectors).find(([name]) => text.toLowerCase().includes(name)) ?? [];
      return Promise.resolve(JSON.stringify(vector ?? [0.3, 0.3, 0.3, 0.3]));
    });
    vi.spyOn(ctx.get(SearchRepository), 'getEmbeddings').mockResolvedValue([
      { assetId: carbonara.id, embedding: '[0.9,0.1,0.1,0.1]' },
      { assetId: tiramisu.id, embedding: '[0.1,0.9,0.1,0.1]' },
    ] as never);
    const getJpegCrops = vi.spyOn(ctx.get(MediaRepository), 'getJpegCrops');

    const result = await ctx
      .getService(FoodService)
      .matchMeal(auth, { dishIds: [carbonara.id, tiramisu.id], menuIds: [menu.id] });

    // the original of the menu was decoded from S3, at full resolution, for the OCR tiles
    expect(getJpegCrops.mock.calls[0][0].info).toMatchObject({ width: 2000, height: 1400 });
    expect(result.items.map(({ name }) => name)).toEqual([
      'Spaghetti alla carbonara',
      'Pasta alla Norma',
      'Tiramisù',
      'Cannolo',
    ]);
    const names = new Map(result.dishes.map(({ assetIds, name }) => [assetIds[0], name]));
    expect(names.get(carbonara.id)).toBe('Spaghetti alla carbonara');
    expect(names.get(tiramisu.id)).toBe('Tiramisù');

    const images = await ctx.getService(FoodService).getMenuImages(auth, menu.id, { zoom: true });
    expect(images.length).toBeGreaterThan(1);
    await expectNothingLeft();
  });

  it('should check the orientation of photos on their previews', async () => {
    const { ctx } = setup();
    const { auth } = await newOwner(ctx);
    const photo = await newS3Photo(ctx, auth.user.id);
    const embedding = JSON.stringify(Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)));
    await database.insertInto('smart_search').values({ assetId: photo.id, embedding }).execute();
    const ml = ctx.getMock(MachineLearningRepository);
    ml.encodeText.mockImplementation((text: string) =>
      Promise.resolve(JSON.stringify(Array.from({ length: 512 }, (_, index) => (index === text.length % 512 ? 1 : 0)))),
    );
    ml.encodeImage.mockResolvedValue(embedding);
    ml.detectFaces.mockResolvedValue({ imageWidth: 100, imageHeight: 100, faces: [] });
    ml.ocr.mockResolvedValue({ text: [], box: [], boxScore: [], textScore: [] });
    const turnToJpeg = vi.spyOn(ctx.get(MediaRepository), 'turnToJpeg');

    await expect(ctx.getService(OrientationService).find(auth, { assetIds: [photo.id] })).resolves.toEqual([]);

    // every turned view was drawn from one local copy of the preview in S3, since removed
    expect(turnToJpeg).toHaveBeenCalled();
    const inputs = new Set(turnToJpeg.mock.calls.map(([input]) => input));
    expect(inputs.size).toBe(1);
    expect([...inputs][0]).toMatch(new RegExp(String.raw`^${temporary}/immich-.+\.tmp$`));
    await expectNothingLeft();
  });
});

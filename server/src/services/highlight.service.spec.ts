import { BadRequestException } from '@nestjs/common';
import { Stats } from 'node:fs';
import { Readable } from 'node:stream';
import { vitest } from 'vitest';
import { bookStylePresets } from 'src/dtos/book.dto.js';
import {
  ActivityLogAction,
  AssetType,
  AssetVisibility,
  HighlightJobStatus,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
} from 'src/enum.js';
import { AlbumService } from 'src/services/album.service.js';
import { BookService } from 'src/services/book.service.js';
import {
  HighlightService,
  getHighlightFileName,
  getHighlightTag,
  resolveHighlightStyle,
} from 'src/services/highlight.service.js';
import { MemorySourceService } from 'src/services/memory-source.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { AutoLayoutPhoto } from 'src/utils/book/auto-layout.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { useS3Backend } from 'test/storage-backend.mock.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const HOUR = 60 * 60 * 1000;
const start = Date.UTC(2024, 5, 12, 9);

const photos = (count: number): AutoLayoutPhoto[] =>
  Array.from({ length: count }, (_, i) => ({
    id: newUuid(),
    width: 4000,
    height: 3000,
    takenAt: start + i * 10 * 60_000 + (i >= count / 2 ? 24 * HOUR : 0),
    score: 0.4 + (i % 4) * 0.1,
    faces: i % 3 === 0 ? [{ x: 0.4, y: 0.2, width: 0.1, height: 0.12 }] : [],
    isFavorite: false,
    city: i >= count / 2 ? 'Catania' : 'Taormina',
  }));

const file = (name: string) => ({ originalname: name, buffer: Buffer.from('audio'), size: 5 }) as Express.Multer.File;

const renderAsset = (id: string) => ({
  id,
  type: AssetType.Image,
  originalPath: `/data/library/${id}.jpg`,
  originalFileName: `${id}.jpg`,
  isEdited: false,
  localDateTime: new Date(start),
  width: 4000,
  height: 3000,
  exifImageWidth: 4000,
  exifImageHeight: 3000,
  orientation: null,
  files: [{ type: 'preview', path: `/data/thumbs/${id}-preview.jpeg`, isEdited: false }],
});

describe(getHighlightFileName.name, () => {
  it('should name the file after the title, and mark a vertical video', () => {
    expect(getHighlightFileName('Sicily 2009')).toBe('Sicily 2009.mp4');
    expect(getHighlightFileName('Sicily 2009', 'vertical')).toBe('Sicily 2009-vertical.mp4');
    expect(getHighlightFileName('Rome/Florence: 3 days', 'vertical')).toBe('Rome_Florence_ 3 days-vertical.mp4');
    expect(getHighlightFileName('  ')).toBe('Highlights.mp4');
  });
});

describe(HighlightService.name, () => {
  let sut: HighlightService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();
  const albumId = newUuid();

  const jobRow = (overrides: Record<string, unknown> = {}) => ({
    id: newUuid(),
    ownerId: auth.user.id,
    albumId,
    bookId: null,
    musicAssetId: null,
    title: 'Sicily',
    options: { durationSeconds: 30, style: 'auto', includeMaps: false, captions: true, addToAlbum: true },
    status: HighlightJobStatus.Pending,
    progress: 0,
    error: null,
    warnings: null,
    resultAssetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updateId: newUuid(),
    ...overrides,
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(HighlightService));
    vitest.restoreAllMocks();
  });

  const setupRender = (overrides: Record<string, unknown> = {}) => {
    const job = jobRow(overrides);
    const shown = photos(24);
    mocks.highlightJob.get.mockResolvedValue(job as any);
    mocks.highlightJob.update.mockImplementation((_, update) => Promise.resolve({ ...job, ...update }) as any);
    mocks.highlightJob.getStatus.mockResolvedValue(HighlightJobStatus.Running);
    mocks.highlightJob.getVideos.mockResolvedValue([]);
    mocks.agent.getAuthUser.mockResolvedValue(auth.user);
    mocks.assetJob.getForAgentEvents.mockResolvedValue(shown.map(({ id }) => ({ id })) as any);
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(shown.map(({ id }) => id)));
    mocks.book.getAssetsForRender.mockImplementation((ids) => Promise.resolve(ids.map((id) => renderAsset(id))) as any);
    mocks.storage.readdir.mockResolvedValue([]);
    mocks.storage.stat.mockResolvedValue({ size: 1234 } as Stats);
    mocks.crypto.randomUUID.mockReturnValue('video-id');
    mocks.crypto.hashFile.mockResolvedValue(Buffer.from('checksum'));
    mocks.asset.create.mockImplementation((asset) => Promise.resolve(asset) as any);
    mocks.asset.getById.mockResolvedValue({
      id: shown.at(-1)!.id,
      fileCreatedAt: new Date(start),
      localDateTime: new Date(start),
      exifInfo: { dateTimeOriginal: new Date(start), timeZone: 'Europe/Rome' },
    } as any);
    mocks.notification.create.mockImplementation(
      (item) => Promise.resolve({ id: newUuid(), createdAt: new Date(), ...item }) as any,
    );
    vitest.spyOn(BookService.prototype, 'getLayoutPhotos').mockResolvedValue(shown);
    const addAssets = vitest
      .spyOn(AlbumService.prototype, 'addAssets')
      .mockResolvedValue([{ id: 'video-id', success: true }]);
    return { job, shown, addAssets };
  };

  describe('create', () => {
    it('should start a video of an album, titled after it', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.album.getById.mockResolvedValue({ albumName: 'Sicily 2009' } as any);
      mocks.highlightJob.create.mockImplementation((job) => Promise.resolve(jobRow(job as any)) as any);

      const result = await sut.create(auth, { albumId, durationSeconds: 90 });

      expect(mocks.highlightJob.create).toHaveBeenCalledWith({
        ownerId: auth.user.id,
        albumId,
        bookId: null,
        musicAssetId: null,
        title: 'Sicily 2009',
        options: {
          durationSeconds: 90,
          style: 'auto',
          includeMaps: true,
          captions: true,
          addToAlbum: true,
          format: 'landscape',
        },
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.HighlightRender, data: { id: result.id } });
      expect(result).toMatchObject({
        title: 'Sicily 2009',
        status: HighlightJobStatus.Pending,
        durationSeconds: 90,
        format: 'landscape',
      });
    });

    it('should start a video of the whole window of a memory, titled like it', async () => {
      const memoryId = newUuid();
      const resolve = vitest.spyOn(MemorySourceService.prototype, 'resolve').mockResolvedValue({
        source: { title: 'Recent trip to Athens, Greece' } as any,
        memory: { memoryAt: new Date(), isSaved: false },
        assets: [
          { id: 'first-day', type: AssetType.Image, time: 1 },
          { id: 'clip', type: AssetType.Video, time: 2 },
          { id: 'last-day', type: AssetType.Image, time: 3 },
        ],
      });
      mocks.highlightJob.create.mockImplementation((job) => Promise.resolve(jobRow(job as any)) as any);

      const result = await sut.create(auth, { memoryId, format: 'vertical' });

      expect(resolve).toHaveBeenCalledWith(auth, memoryId);
      expect(mocks.highlightJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          albumId: null,
          bookId: null,
          title: 'Recent trip to Athens, Greece',
          options: expect.objectContaining({
            assetIds: ['first-day', 'clip', 'last-day'],
            memoryId,
            format: 'vertical',
          }),
        }),
      );
      expect(result).toMatchObject({ memoryId, format: 'vertical' });
    });

    it('should not start a video of a memory without photos', async () => {
      vitest.spyOn(MemorySourceService.prototype, 'resolve').mockResolvedValue({
        source: { title: 'Memories' } as any,
        memory: { memoryAt: new Date(), isSaved: false },
        assets: [],
      });

      await expect(sut.create(auth, { memoryId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.highlightJob.create).not.toHaveBeenCalled();
    });

    it('should start a vertical video', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.album.getById.mockResolvedValue({ albumName: 'Sicily 2009' } as any);
      mocks.highlightJob.create.mockImplementation((job) => Promise.resolve(jobRow(job as any)) as any);

      const result = await sut.create(auth, { albumId, format: 'vertical' });

      expect(mocks.highlightJob.create).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ format: 'vertical' }) }),
      );
      expect(result.format).toBe('vertical');
    });

    it('should record the video, to cancel or trash it on undo', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.album.getById.mockResolvedValue({ albumName: 'Sicily 2009' } as any);
      mocks.highlightJob.create.mockImplementation((job) => Promise.resolve(jobRow(job as any)) as any);
      mocks.activityLog.create.mockResolvedValue({ id: 'change' } as never);

      const result = await sut.create(auth, { albumId }, ActivityRecorder.web());

      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ActivityLogAction.HighlightCreate,
          summary: 'Made the highlight video “Sicily 2009”',
          targetId: result.id,
          undo: { highlightId: result.id },
        }),
      );
    });

    it('should record a vertical video as such', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.album.getById.mockResolvedValue({ albumName: 'Sicily 2009' } as any);
      mocks.highlightJob.create.mockImplementation((job) => Promise.resolve(jobRow(job as any)) as any);
      mocks.activityLog.create.mockResolvedValue({ id: 'change' } as never);

      await sut.create(auth, { albumId, format: 'vertical' }, ActivityRecorder.web());

      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ summary: 'Made the vertical highlight video “Sicily 2009”' }),
      );
    });

    it('should require access to the album', async () => {
      await expect(sut.create(auth, { albumId })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.highlightJob.create).not.toHaveBeenCalled();
    });

    it('should require access to every photo of a selection', async () => {
      const ids = [newUuid(), newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([ids[0]]));
      await expect(sut.create(auth, { assetIds: ids })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should only play the user’s own audio files', async () => {
      const assetIds = [newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
      mocks.highlightJob.getMusicAsset.mockResolvedValue(undefined);
      await expect(sut.create(auth, { assetIds, music: newUuid() })).rejects.toThrow(
        'The music is not one of your audio files',
      );
    });

    it('should title a video of a book after the book', async () => {
      const bookId = newUuid();
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([bookId]));
      mocks.book.get.mockResolvedValue({ id: bookId, title: 'Our summer' } as any);
      mocks.highlightJob.create.mockImplementation((job) => Promise.resolve(jobRow(job as any)) as any);
      await sut.create(auth, { bookId, style: 'food' });
      expect(mocks.highlightJob.create).toHaveBeenCalledWith(
        expect.objectContaining({ bookId, title: 'Our summer', options: expect.objectContaining({ style: 'food' }) }),
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a render and tell the web', async () => {
      const job = jobRow({ status: HighlightJobStatus.Cancelled });
      mocks.access.highlightJob.checkOwnerAccess.mockResolvedValue(new Set([job.id]));
      mocks.highlightJob.cancel.mockResolvedValue(job as any);
      await expect(sut.cancel(auth, job.id)).resolves.toMatchObject({ status: HighlightJobStatus.Cancelled });
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith(
        'on_highlight_update',
        auth.user.id,
        expect.objectContaining({ id: job.id, status: HighlightJobStatus.Cancelled }),
      );
    });

    it('should not cancel the render of someone else', async () => {
      await expect(sut.cancel(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.highlightJob.cancel).not.toHaveBeenCalled();
    });
  });

  describe('uploadMusic', () => {
    it('should refuse files that are not audio', async () => {
      await expect(sut.uploadMusic(auth, file('song.exe'))).rejects.toThrow('Unsupported audio file');
      expect(mocks.storage.createFile).not.toHaveBeenCalled();
    });

    it('should keep an audio file as a hidden audio asset', async () => {
      mocks.crypto.randomUUID.mockReturnValue('music-id');
      mocks.crypto.hashSha1.mockReturnValue(Buffer.from('checksum'));
      mocks.media.probe.mockResolvedValue({
        format: { duration: 183.5 },
        videoStreams: [],
        audioStreams: [{ index: 0 }],
      } as any);
      mocks.asset.create.mockImplementation((asset) => Promise.resolve(asset) as any);

      const result = await sut.uploadMusic(auth, file('Summer.mp3'));

      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AssetType.Audio,
          visibility: AssetVisibility.Hidden,
          originalFileName: 'Summer.mp3',
          duration: 183_500,
        }),
      );
      expect(result).toEqual({ id: 'music-id', name: 'Summer.mp3', durationSeconds: 183.5 });
    });

    it('should store the music in S3', async () => {
      const s3 = useS3Backend();
      mocks.crypto.randomUUID.mockReturnValue('music-id');
      mocks.crypto.hashSha1.mockReturnValue(Buffer.from('checksum'));
      mocks.media.probe.mockResolvedValue({
        format: { duration: 3 },
        videoStreams: [],
        audioStreams: [{ index: 0 }],
      } as any);
      mocks.asset.create.mockImplementation((asset) => Promise.resolve(asset) as any);
      mocks.storage.createPlainReadStream.mockImplementation(() => Readable.from([Buffer.from('audio')]));
      mocks.storage.unlink.mockResolvedValue();

      await sut.uploadMusic(auth, file('Summer.mp3'));

      const path = mocks.storage.createFile.mock.calls[0][0];
      const key = `upload/${auth.user.id}/mu/si/music-id.mp3`;
      expect(mocks.media.probe).toHaveBeenCalledWith(path);
      expect(s3.stored.get(key)).toEqual({ data: Buffer.from('audio'), contentType: 'audio/mpeg' });
      expect(mocks.storage.unlink).toHaveBeenCalledWith(path);
      expect(mocks.asset.create).toHaveBeenCalledWith(expect.objectContaining({ originalPath: key }));
    });

    it('should refuse a file without sound and delete it', async () => {
      mocks.crypto.randomUUID.mockReturnValue('music-id');
      mocks.media.probe.mockResolvedValue({ format: {}, videoStreams: [], audioStreams: [] } as any);
      await expect(sut.uploadMusic(auth, file('silence.wav'))).rejects.toThrow('The file has no sound');
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FileDelete, data: { files: [expect.any(String)] } });
    });
  });

  describe('handleRender', () => {
    it('should skip a render that was cancelled before it started', async () => {
      mocks.highlightJob.get.mockResolvedValue(jobRow({ status: HighlightJobStatus.Cancelled }) as any);
      await expect(sut.handleRender({ id: newUuid() })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.media.runFfmpeg).not.toHaveBeenCalled();
    });

    it('should render the video, save it as a new asset, add it to the album and notify the owner', async () => {
      const { job, addAssets } = setupRender();

      await expect(sut.handleRender({ id: job.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.highlightJob.update).toHaveBeenNthCalledWith(1, job.id, {
        status: HighlightJobStatus.Running,
        progress: 0,
      });
      // every shot as a segment, then the film
      const calls = mocks.media.runFfmpeg.mock.calls;
      expect(calls.length).toBeGreaterThan(5);
      expect(calls.at(-1)![0]).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-movflags', '+faststart']));
      expect(mocks.media.composeHighlightStill).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.stringMatching(/^\/data\/library\/.*\.jpg$/), width: 2880 }),
      );

      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(
        expect.stringContaining('video-id.mp4'),
        expect.objectContaining({ TagsList: [getHighlightTag('Sicily')] }),
      );
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'video-id',
          type: AssetType.Video,
          ownerId: auth.user.id,
          originalFileName: 'Sicily.mp4',
          visibility: AssetVisibility.Timeline,
        }),
      );
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetExtractMetadata,
        data: { id: 'video-id', source: 'upload' },
      });
      expect(addAssets).toHaveBeenCalledWith(expect.anything(), albumId, { ids: ['video-id'] });
      expect(mocks.highlightJob.update).toHaveBeenLastCalledWith(
        job.id,
        expect.objectContaining({ status: HighlightJobStatus.Completed, progress: 1, resultAssetId: 'video-id' }),
      );
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: auth.user.id,
          type: NotificationType.Custom,
          level: NotificationLevel.Success,
          title: 'Your highlight video is ready',
          data: JSON.stringify({ assetId: 'video-id', highlightId: job.id, format: 'landscape' }),
        }),
      );
      expect(mocks.storage.unlinkDir).toHaveBeenCalledWith(expect.stringContaining(`.highlight-${job.id}`), {
        recursive: true,
        force: true,
      });
    });

    it('should render a vertical video in portrait and name its file for social apps', async () => {
      const { job } = setupRender({
        options: {
          durationSeconds: 30,
          style: 'auto',
          includeMaps: false,
          captions: true,
          addToAlbum: true,
          format: 'vertical',
        },
      });

      await expect(sut.handleRender({ id: job.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.media.composeHighlightStill).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1620, height: 2880 }),
      );
      const segments = mocks.media.runFfmpeg.mock.calls.slice(0, -1).map(([args]) => args.join(' '));
      expect(segments.every((args) => !args.includes('zoompan') || args.includes(':s=1080x1920:'))).toBe(true);
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalFileName: 'Sicily-vertical.mp4' }),
      );
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: JSON.stringify({ assetId: 'video-id', highlightId: job.id, format: 'vertical' }),
        }),
      );
    });

    it('should play the music under the video', async () => {
      const musicAssetId = newUuid();
      const { job } = setupRender({ musicAssetId });
      mocks.highlightJob.getMusicAsset.mockResolvedValue({
        id: musicAssetId,
        originalPath: '/data/upload/song.mp3',
      } as any);
      await sut.handleRender({ id: job.id });
      expect(mocks.media.runFfmpeg.mock.calls.at(-1)![0]).toEqual(
        expect.arrayContaining(['-stream_loop', '-1', '-i', '/data/upload/song.mp3']),
      );
    });

    it('should render from S3: local copies of the photos and music, short-lived URLs of the clips', async () => {
      const s3 = useS3Backend();
      const musicAssetId = newUuid();
      const videoId = newUuid();
      const { job, shown } = setupRender({ musicAssetId });
      mocks.assetJob.getForAgentEvents.mockResolvedValue([...shown, { id: videoId }] as any);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([...shown.map(({ id }) => id), videoId]));
      mocks.book.getAssetsForRender.mockImplementation(
        (ids) =>
          Promise.resolve(
            ids.map((id) => ({
              ...renderAsset(id),
              originalPath: `upload/owner/ab/cd/${id}.jpg`,
              files: [{ type: 'preview', path: `thumbs/owner/ab/cd/${id}-preview.jpeg`, isEdited: false }],
            })),
          ) as any,
      );
      mocks.highlightJob.getVideos.mockResolvedValue([
        {
          id: videoId,
          originalPath: 'upload/owner/ab/cd/clip.mov',
          duration: 20_000,
          localDateTime: new Date(start + 5 * 60_000),
          isFavorite: true,
          width: 1920,
          height: 1080,
          stackId: null,
          latitude: null,
          longitude: null,
          city: 'Taormina',
          country: null,
          rating: 5,
          description: null,
        },
      ] as any);
      mocks.media.probe.mockResolvedValue({
        format: { duration: 20 },
        videoStreams: [{ width: 1920, height: 1080, rotation: 0 }],
        audioStreams: [{ index: 1 }],
      } as any);
      mocks.media.getVideoFrame.mockResolvedValue(Buffer.from('frame'));
      mocks.highlightJob.getMusicAsset.mockResolvedValue({
        id: musicAssetId,
        originalPath: 'upload/owner/ab/cd/song.mp3',
      } as any);
      mocks.storage.createPlainReadStream.mockImplementation(() => Readable.from([Buffer.from('film')]));
      mocks.storage.unlink.mockResolvedValue();

      await expect(sut.handleRender({ id: job.id })).resolves.toBe(JobStatus.Success);

      const url = 'https://s3.test/bucket/upload/owner/ab/cd/clip.mov?signature';
      expect(mocks.media.probe).toHaveBeenCalledWith(url);
      expect(mocks.media.getVideoFrame).toHaveBeenCalledWith(url, expect.any(Number));
      const args = mocks.media.runFfmpeg.mock.calls.map(([args]) => args);
      expect(args.some((segment) => segment.includes(url))).toBe(true);
      const music = s3.temps.find(({ key }) => key.endsWith('song.mp3'))!;
      expect(args.at(-1)).toEqual(expect.arrayContaining(['-stream_loop', '-1', '-i', music.tempPath]));
      const temps = new Set(s3.temps.map(({ tempPath }) => tempPath));
      for (const [{ input }] of mocks.media.composeHighlightStill.mock.calls) {
        expect(temps.has(input)).toBe(true);
      }
      expect(mocks.media.composeHighlightStill).toHaveBeenCalled();
      expect(s3.temps.every(({ removed }) => removed)).toBe(true);
      expect(s3.stored.get(`upload/${auth.user.id}/vi/de/video-id.mp4`)?.contentType).toBe('video/mp4');
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalPath: `upload/${auth.user.id}/vi/de/video-id.mp4` }),
      );
    });

    it('should make a silent video when the music cannot be read from S3', async () => {
      const s3 = useS3Backend();
      s3.downloadToTemp.mockRejectedValue(new Error('NoSuchKey'));
      const musicAssetId = newUuid();
      const { job } = setupRender({ musicAssetId });
      mocks.highlightJob.getMusicAsset.mockResolvedValue({
        id: musicAssetId,
        originalPath: 'upload/o/ab/cd/song.mp3',
      } as any);
      mocks.storage.createPlainReadStream.mockImplementation(() => Readable.from([Buffer.from('film')]));

      await expect(sut.handleRender({ id: job.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.media.runFfmpeg.mock.calls.at(-1)![0]).not.toContain('-stream_loop');
      expect(mocks.highlightJob.update).toHaveBeenLastCalledWith(
        job.id,
        expect.objectContaining({
          warnings: expect.arrayContaining([expect.stringMatching(/music could not be read/)]),
        }),
      );
    });

    it('should stop when the video is cancelled while it renders, and clean up', async () => {
      const { job } = setupRender();
      mocks.highlightJob.getStatus.mockResolvedValue(HighlightJobStatus.Cancelled);
      mocks.media.runFfmpeg.mockImplementation(
        (_, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal!.reason));
          }),
      );

      await expect(sut.handleRender({ id: job.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.asset.create).not.toHaveBeenCalled();
      expect(mocks.notification.create).not.toHaveBeenCalled();
      expect(mocks.highlightJob.update).not.toHaveBeenCalledWith(
        job.id,
        expect.objectContaining({ status: HighlightJobStatus.Failed }),
      );
      expect(mocks.storage.unlinkDir).toHaveBeenCalled();
    });

    it('should fail, notify the owner and clean up when ffmpeg fails', async () => {
      const { job } = setupRender();
      mocks.media.runFfmpeg.mockRejectedValue(new Error('ffmpeg exited with code 1'));

      await expect(sut.handleRender({ id: job.id })).resolves.toBe(JobStatus.Failed);

      expect(mocks.highlightJob.update).toHaveBeenLastCalledWith(
        job.id,
        expect.objectContaining({ status: HighlightJobStatus.Failed, error: 'None of the shots could be rendered' }),
      );
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ level: NotificationLevel.Error, title: 'The highlight video could not be made' }),
      );
      expect(mocks.asset.create).not.toHaveBeenCalled();
      expect(mocks.storage.unlinkDir).toHaveBeenCalled();
    });

    it('should fail when there is nothing to show', async () => {
      const { job } = setupRender();
      vitest.spyOn(BookService.prototype, 'getLayoutPhotos').mockResolvedValue([]);
      await expect(sut.handleRender({ id: job.id })).resolves.toBe(JobStatus.Failed);
      expect(mocks.media.runFfmpeg).not.toHaveBeenCalled();
    });
  });

  describe('resolveHighlightStyle', () => {
    it('should use the preset asked for', () => {
      expect(resolveHighlightStyle('bold', null, [])).toEqual(bookStylePresets.bold.style);
    });

    it('should use the style of the book', () => {
      expect(resolveHighlightStyle('auto', { background: '#000000' }, [])).toEqual(
        expect.objectContaining({ background: '#000000' }),
      );
    });

    it('should use the style of the collection of the photos', () => {
      const tagged = [{ collection: { pack: 'wine', place: 'Noma', kind: 'entry' as const, entry: 'Riesling' } }];
      expect(resolveHighlightStyle('auto', null, tagged)).toEqual(bookStylePresets.wine.style);
      expect(resolveHighlightStyle('auto', null, [{ collection: null }])).toEqual(bookStylePresets.classic.style);
    });
  });
});

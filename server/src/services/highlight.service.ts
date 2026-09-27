import { BadRequestException, Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { extname, join } from 'node:path';
import type { JobOf } from 'src/types.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { BookStyle, bookStylePresets, resolveBookStyle } from 'src/dtos/book.dto.js';
import {
  HighlightCreateDto,
  HighlightJobResponseDto,
  HighlightMusicResponseDto,
  mapHighlightJob,
  mapHighlightMusic,
} from 'src/dtos/highlight.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  ActivityLogAction,
  AssetType,
  AssetVisibility,
  ChecksumAlgorithm,
  ColorTransfer,
  HighlightJobStatus,
  ImmichWorker,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
  Permission,
  QueueName,
  StorageFolder,
} from 'src/enum.js';
import { HighlightJobTable } from 'src/schema/tables/highlight-job.table.js';
import { AlbumService } from 'src/services/album.service.js';
import { BaseService } from 'src/services/base.service.js';
import { BookService, getRenderInput } from 'src/services/book.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { ActivityRecorder, quote, recordActivity } from 'src/utils/activity-log.js';
import { scorePhoto } from 'src/utils/agent/scoring.js';
import { getStyledMapSource } from 'src/utils/book/map-source.js';
import { resolveMapStyle } from 'src/utils/book/map-styles.js';
import { parsePolygon, renderMap } from 'src/utils/book/map.js';
import { getCollectionPack } from 'src/utils/collections/registry.js';
import { isAssetChecksumConstraint } from 'src/utils/database.js';
import { ToneMapper, getHighlightEncoder } from 'src/utils/highlight/ffmpeg.js';
import {
  DEFAULT_HIGHLIGHT_DURATION,
  HighlightFormat,
  HighlightPhoto,
  HighlightPlan,
  HighlightVideo,
  planHighlight,
} from 'src/utils/highlight/plan.js';
import { HighlightClipSource, renderHighlight } from 'src/utils/highlight/render.js';

type HighlightJob = Selectable<HighlightJobTable>;

/** the audio files the music of a highlight video can be */
export const HIGHLIGHT_MUSIC_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus']);
/** the largest music file */
export const MAX_MUSIC_BYTES = 100 * 1024 * 1024;
/** how often a render checks whether it was cancelled */
const CANCEL_POLL_MS = 1500;
/** how often the progress is saved and sent */
const PROGRESS_INTERVAL_MS = 1500;
/** the frames of a video looked at to find its best part */
const CLIP_SAMPLES = 6;

class HighlightCancelledError extends Error {
  constructor() {
    super('The highlight video was cancelled');
  }
}

export const getHighlightTag = (title: string) => `Highlights/${title.replaceAll('/', '-').trim() || 'Highlights'}`;

/** the name of the video file: the title, and `-vertical` for a vertical video, which is shared to social apps */
export const getHighlightFileName = (title: string, format: HighlightFormat = 'landscape') =>
  `${title.replaceAll(/[\\/:*?"<>|]/g, '_').trim() || 'Highlights'}${format === 'vertical' ? '-vertical' : ''}.mp4`;

const formatLength = (seconds: number) => {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};

/** the style of the cards: a preset, or auto: the book's, or the preset of the pack most photos belong to */
export const resolveHighlightStyle = (
  style: string,
  bookStyle: Partial<BookStyle> | null | undefined,
  photos: Array<Pick<HighlightPhoto, 'collection'>>,
): Required<BookStyle> => {
  if (style !== 'auto' && bookStylePresets[style]) {
    return bookStylePresets[style].style;
  }
  if (bookStyle) {
    return resolveBookStyle(bookStyle);
  }
  const counts = new Map<string, number>();
  for (const photo of photos) {
    if (photo.collection) {
      counts.set(photo.collection.pack, (counts.get(photo.collection.pack) ?? 0) + 1);
    }
  }
  const [pack] = [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
  const preset = pack ? getCollectionPack(pack)?.book.preset.id : undefined;
  return (preset && bookStylePresets[preset]?.style) || bookStylePresets.classic.style;
};

/** Makes highlight videos: a short film of an album, a book or a selection, saved as a new video asset */
@Injectable()
export class HighlightService extends BaseService {
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    await this.highlightJobRepository.failRunning();
  }

  /** Starts a highlight video; with a recorder it goes into the activity log (undo cancels it, or trashes the video) */
  async create(auth: AuthDto, dto: HighlightCreateDto, activity?: ActivityRecorder): Promise<HighlightJobResponseDto> {
    let title = dto.title;
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
      const album = await this.albumRepository.getById(dto.albumId, { withAssets: false });
      if (!album) {
        throw new BadRequestException('Album not found');
      }
      title ??= album.albumName.trim();
    } else if (dto.bookId) {
      await this.requireAccess({ auth, permission: Permission.BookRead, ids: [dto.bookId] });
      const book = await this.bookRepository.get(dto.bookId);
      if (!book) {
        throw new BadRequestException('Book not found');
      }
      title ??= book.title;
    } else if (dto.assetIds) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: dto.assetIds });
    } else {
      throw new BadRequestException('Pass an albumId, a bookId or assetIds');
    }

    if (dto.music) {
      const music = await this.highlightJobRepository.getMusicAsset(auth.user.id, dto.music);
      if (!music) {
        throw new BadRequestException('The music is not one of your audio files');
      }
    }

    const job = await this.highlightJobRepository.create({
      ownerId: auth.user.id,
      albumId: dto.albumId ?? null,
      bookId: dto.bookId ?? null,
      musicAssetId: dto.music ?? null,
      title: title || 'Highlights',
      options: {
        ...(dto.assetIds && { assetIds: [...new Set(dto.assetIds)] }),
        durationSeconds: dto.durationSeconds ?? DEFAULT_HIGHLIGHT_DURATION,
        style: dto.style ?? 'auto',
        includeMaps: dto.includeMaps ?? true,
        captions: dto.captions ?? true,
        addToAlbum: dto.addToAlbum ?? true,
        format: dto.format ?? 'landscape',
      },
    });
    await this.jobRepository.queue({ name: JobName.HighlightRender, data: { id: job.id } });
    await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, auth.user.id, activity, {
      action: ActivityLogAction.HighlightCreate,
      summary: `Made the ${job.options.format === 'vertical' ? 'vertical ' : ''}highlight video ${quote(job.title)}`,
      targetId: job.id,
      undo: { highlightId: job.id },
    });
    return mapHighlightJob(job);
  }

  async get(auth: AuthDto, id: string): Promise<HighlightJobResponseDto> {
    await this.requireAccess({ auth, permission: Permission.HighlightRead, ids: [id] });
    const job = await this.highlightJobRepository.get(id);
    if (!job) {
      throw new BadRequestException('Highlight video not found');
    }
    return mapHighlightJob(job);
  }

  async getAll(auth: AuthDto): Promise<HighlightJobResponseDto[]> {
    const jobs = await this.highlightJobRepository.getAll(auth.user.id);
    return jobs.map((job) => mapHighlightJob(job));
  }

  /** stops a render that is waiting or running; a finished video stays */
  async cancel(auth: AuthDto, id: string): Promise<HighlightJobResponseDto> {
    await this.requireAccess({ auth, permission: Permission.HighlightDelete, ids: [id] });
    const cancelled = await this.highlightJobRepository.cancel(id);
    if (cancelled) {
      this.websocketRepository.clientSend('on_highlight_update', cancelled.ownerId, mapHighlightJob(cancelled));
      return mapHighlightJob(cancelled);
    }
    return this.get(auth, id);
  }

  async getMusic(auth: AuthDto): Promise<HighlightMusicResponseDto[]> {
    const music = await this.highlightJobRepository.getMusic(auth.user.id);
    return music.map((asset) => mapHighlightMusic(asset));
  }

  /** saves an audio file of the user as a hidden audio asset, to be the music of highlight videos */
  async uploadMusic(auth: AuthDto, file?: Express.Multer.File): Promise<HighlightMusicResponseDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No audio file was uploaded');
    }
    const extension = extname(file.originalname).toLowerCase();
    if (!HIGHLIGHT_MUSIC_EXTENSIONS.has(extension)) {
      throw new BadRequestException(`Unsupported audio file: use ${[...HIGHLIGHT_MUSIC_EXTENSIONS].join(', ')}`);
    }
    if (file.size > MAX_MUSIC_BYTES) {
      throw new BadRequestException('The audio file is larger than 100 MB');
    }
    if (auth.user.quotaSizeInBytes !== null && auth.user.quotaSizeInBytes < auth.user.quotaUsageInBytes + file.size) {
      throw new BadRequestException('Quota has been exceeded!');
    }

    const id = this.cryptoRepository.randomUUID();
    const path = StorageCore.getNestedPath(StorageFolder.Upload, auth.user.id, `${id}${extension}`);
    this.storageCore.ensureFolders(path);
    await this.storageRepository.createFile(path, file.buffer);

    try {
      const { audioStreams, format } = await this.mediaRepository.probe(path);
      if (audioStreams.length === 0) {
        throw new BadRequestException('The file has no sound');
      }

      const checksum = this.cryptoRepository.hashSha1(file.buffer);
      const now = new Date();
      try {
        const asset = await this.assetRepository.create({
          id,
          ownerId: auth.user.id,
          libraryId: null,
          type: AssetType.Audio,
          checksum,
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          originalPath: path,
          originalFileName: file.originalname,
          fileCreatedAt: now,
          fileModifiedAt: now,
          localDateTime: now,
          duration: format.duration ? Math.round(format.duration * 1000) : null,
          // music is picked for the videos, it is not a memory of the timeline
          visibility: AssetVisibility.Hidden,
        });
        await this.assetRepository.upsertExif({
          exif: { assetId: asset.id, fileSizeInByte: file.size },
          lockedPropertiesBehavior: 'override',
        });
        await this.userRepository.updateUsage(auth.user.id, file.size);
        return mapHighlightMusic(asset);
      } catch (error) {
        if (!isAssetChecksumConstraint(error)) {
          throw error;
        }
        const duplicateId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, checksum);
        const duplicate = duplicateId
          ? await this.highlightJobRepository.getMusicAsset(auth.user.id, duplicateId)
          : undefined;
        if (!duplicate) {
          throw new BadRequestException('This file is already in the library, but it is not an audio file');
        }
        await this.storageRepository.unlink(path);
        return mapHighlightMusic(duplicate);
      }
    } catch (error) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [path] } });
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`The audio file could not be read (${(error as Error)?.message ?? error})`);
    }
  }

  async deleteMusic(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AssetDelete, ids: [id] });
    const music = await this.highlightJobRepository.getMusicAsset(auth.user.id, id);
    if (!music) {
      throw new BadRequestException('Audio file not found');
    }
    await this.assetRepository.updateAll([id], { deletedAt: new Date() });
    await this.jobRepository.queue({ name: JobName.AssetDelete, data: { id, deleteOnDisk: true } });
  }

  @OnJob({ name: JobName.HighlightRender, queue: QueueName.BackgroundTask })
  async handleRender({ id }: JobOf<JobName.HighlightRender>): Promise<JobStatus> {
    const job = await this.highlightJobRepository.get(id);
    if (!job || job.status !== HighlightJobStatus.Pending) {
      return JobStatus.Skipped;
    }

    const user = await this.agentRepository.getAuthUser(job.ownerId);
    if (!user) {
      await this.updateJob(job, { status: HighlightJobStatus.Failed, error: 'The owner of the video was not found' });
      return JobStatus.Failed;
    }
    const auth: AuthDto = { user };

    const workdir = join(StorageCore.getFolderLocation(StorageFolder.Upload, job.ownerId), `.highlight-${job.id}`);
    const controller = new AbortController();
    const poll = setInterval(() => {
      void this.highlightJobRepository
        .getStatus(job.id)
        .then((status) => {
          if (status === HighlightJobStatus.Cancelled) {
            controller.abort(new HighlightCancelledError());
          }
        })
        .catch(() => {});
    }, CANCEL_POLL_MS);

    const warnings: string[] = [];
    try {
      await this.updateJob(job, { status: HighlightJobStatus.Running, progress: 0 });
      this.storageRepository.mkdirSync(workdir);

      const { plan, photos, clips, style } = await this.planJob(auth, job, warnings);
      warnings.push(...plan.warnings);
      if (plan.shots.length === 0) {
        throw new Error('There are no photos or videos to make a video of');
      }
      throwIfCancelled(controller.signal);

      const music = job.musicAssetId
        ? await this.highlightJobRepository.getMusicAsset(job.ownerId, job.musicAssetId)
        : undefined;
      if (job.musicAssetId && !music) {
        warnings.push('The music was deleted, so the video is silent');
      }

      const config = await this.getConfig({ withCache: true });
      const { ffmpeg, books } = config;
      const { dri } = await this.storageCore.getVideoInterfaces();
      const encoder = getHighlightEncoder(ffmpeg, dri);
      const filters = await this.mediaRepository.getFfmpegFilters();
      const toneMap: ToneMapper = filters.has('tonemapx')
        ? 'tonemapx'
        : filters.has('zscale') && filters.has('tonemap')
          ? 'zscale'
          : null;
      const { style: mapStyle } = resolveMapStyle('auto', { ...books.maps, mapEnabled: config.map.enabled });
      const styledMapSource = getStyledMapSource(this.mapRepository, config);

      let lastSave = 0;
      let saved = 0;
      const output = join(workdir, 'film.mp4');
      const result = await renderHighlight(plan, {
        media: this.mediaRepository,
        writeFile: (path, data) => this.storageRepository.createOrOverwriteFile(path, data),
        workdir,
        style,
        photos,
        clips,
        renderMap: async (shot, size) => {
          const { data } = await renderMap(
            {
              points: shot.points,
              stadiaApiKey: books.maps.stadiaApiKey || undefined,
              getStyledMapSource: styledMapSource,
              style,
              getCountries: async (bounds) => {
                const rows = await this.bookRepository.getCountryOutlines(bounds);
                return rows.map((row) => ({ name: row.admin, rings: [parsePolygon(row.coordinates)] }));
              },
              fontFamily: style.fontFamily,
            },
            { map: { style: mapStyle, showRoute: true, labels: true, title: shot.title } },
            { ...size, format: 'jpeg', quality: 92 },
          );
          return data;
        },
        toneMap,
        music: music?.originalPath,
        encoder,
        title: job.title,
        output,
        signal: controller.signal,
        concurrency: 3,
        onProgress: (progress) => {
          if (Date.now() - lastSave < PROGRESS_INTERVAL_MS || progress - saved < 0.01) {
            return;
          }
          lastSave = Date.now();
          saved = progress;
          void this.updateJob(job, { progress: Math.min(0.99, progress) }).catch(() => {});
        },
        onWarning: (message) => {
          warnings.push(message);
        },
      });
      throwIfCancelled(controller.signal);

      // the video is dated like the last photo of the film, so that it sits at the end of the trip on the timeline
      const last = plan.usedIds.at(-1)!;
      const dateOf = await this.assetRepository.getById(last, { exifInfo: true });
      const derivedAssetService = BaseService.create(DerivedAssetService, this);
      const vertical = plan.format === 'vertical';
      const { id: assetId } = await derivedAssetService.createGeneratedVideo(auth, output, {
        fileName: getHighlightFileName(job.title, plan.format),
        description: `${vertical ? 'Vertical highlight' : 'Highlight'} video of “${job.title}” (${formatLength(result.durationSeconds)})`,
        tags: [getHighlightTag(job.title)],
        dateOf: dateOf ?? { fileCreatedAt: new Date(), localDateTime: new Date() },
      });

      if (job.albumId && job.options.addToAlbum) {
        try {
          const [added] = await BaseService.create(AlbumService, this).addAssets(auth, job.albumId, { ids: [assetId] });
          if (added && !added.success && added.error !== 'duplicate') {
            warnings.push(`The video could not be added to the album (${added.error})`);
          }
        } catch (error: any) {
          warnings.push(`The video could not be added to the album (${error?.message ?? error})`);
        }
      }

      await this.updateJob(job, {
        status: HighlightJobStatus.Completed,
        progress: 1,
        resultAssetId: assetId,
        warnings: [...new Set(warnings)],
      });
      this.logger.log(
        `Made highlight video ${job.id} (${plan.format}, ${result.shots} shots, ${result.durationSeconds.toFixed(1)} s, ${encoder.codec})`,
      );
      await this.notifyOwner(job, {
        level: NotificationLevel.Success,
        title: 'Your highlight video is ready',
        description: `“${job.title}” (${formatLength(result.durationSeconds)}) is ready to watch`,
        data: { assetId, highlightId: job.id, format: plan.format },
      });
      return JobStatus.Success;
    } catch (error: any) {
      if (controller.signal.aborted) {
        this.logger.log(`Highlight video ${job.id} was cancelled`);
        return JobStatus.Skipped;
      }
      const message = String(error?.message ?? error);
      this.logger.error(`Unable to make highlight video ${job.id}: ${message}`, error?.stack);
      await this.updateJob(job, { status: HighlightJobStatus.Failed, error: message, warnings }).catch(() => {});
      await this.notifyOwner(job, {
        level: NotificationLevel.Error,
        title: 'The highlight video could not be made',
        description: `“${job.title}”: ${message}`,
        data: { highlightId: job.id },
      });
      return JobStatus.Failed;
    } finally {
      clearInterval(poll);
      await this.storageRepository.unlinkDir(workdir, { recursive: true, force: true }).catch((error) => {
        this.logger.warn(`Unable to remove the work folder of highlight video ${job.id}: ${error}`);
      });
    }
  }

  /**
   * The shots of the video from the photos and videos of its album, book or selection, planned like the chapters of a
   * book (see `planHighlight`), with the images each shot is drawn from
   */
  private async planJob(auth: AuthDto, job: HighlightJob, warnings: string[]) {
    const bookService = BaseService.create(BookService, this);
    let assetIds: string[];
    let bookStyle: BookStyle | undefined;
    let heroIds = new Set<string>();

    if (job.bookId) {
      const book = await this.bookRepository.get(job.bookId);
      if (!book) {
        throw new Error('The book was deleted');
      }
      bookStyle = book.style;
      const pages = await this.bookRepository.getPages(book.id);
      assetIds = pages.flatMap((page) => page.assets.map(({ assetId }) => assetId));
      if (book.coverAssetId) {
        heroIds = new Set([book.coverAssetId]);
        assetIds.push(book.coverAssetId);
      }
      // the videos of the book's album, which a printed book can't show
      if (book.albumId) {
        const albums = await this.checkAccess({ auth, permission: Permission.AlbumRead, ids: new Set([book.albumId]) });
        if (albums.has(book.albumId)) {
          const rows = await this.assetJobRepository.getForAgentEvents({
            albumId: book.albumId,
            viewingUserId: auth.user.id,
            limit: 3000,
          });
          assetIds.push(...rows.map((row) => row.id));
        }
      }
    } else if (job.albumId) {
      const rows = await this.assetJobRepository.getForAgentEvents({
        albumId: job.albumId,
        viewingUserId: auth.user.id,
        limit: 3000,
      });
      assetIds = rows.map((row) => row.id);
    } else {
      assetIds = job.options.assetIds ?? [];
    }

    const allowed =
      assetIds.length > 0
        ? await this.checkAccess({ auth, permission: Permission.AssetRead, ids: new Set(assetIds) })
        : new Set<string>();
    const ids = [...new Set(assetIds).intersection(allowed)];

    const layoutPhotos = await bookService.getLayoutPhotos(auth, ids, heroIds, warnings, undefined, {
      sourcePages: false,
    });
    const videoRows = await this.highlightJobRepository.getVideos(ids);
    const videos: HighlightVideo[] = videoRows
      .filter((row) => row.duration && row.duration > 0)
      .map((row) => ({
        id: row.id,
        width: row.width ?? 0,
        height: row.height ?? 0,
        takenAt: row.localDateTime.getTime(),
        lat: row.latitude,
        lon: row.longitude,
        city: row.city,
        country: row.country,
        isFavorite: row.isFavorite,
        stackId: row.stackId,
        description: row.description,
        duration: row.duration! / 1000,
        score: 0.5 + (row.isFavorite ? 0.2 : 0) + (row.rating ? row.rating * 0.04 : 0),
      }));

    const style = resolveHighlightStyle(job.options.style, bookStyle, layoutPhotos);
    const options = {
      title: job.title,
      style,
      durationSeconds: job.options.durationSeconds,
      format: job.options.format ?? 'landscape',
      includeMaps: job.options.includeMaps,
      captions: job.options.captions,
      heroIds: [...heroIds],
    };

    // a first plan picks the shots; the focus of the photos without faces and the best part of the videos are only
    // measured for them, and the plan is made again with them (the choice of shots doesn't depend on them)
    const first = planHighlight(layoutPhotos, videos, options);
    const firstAssets = await this.bookRepository.getAssetsForRender(first.usedIds);
    const renderAssets = new Map(firstAssets.map((asset) => [asset.id, asset]));
    const focus = new Map<string, { x: number; y: number }>();
    for (const shot of first.shots) {
      const photo = shot.kind === 'photo' ? layoutPhotos.find((item) => item.id === shot.assetId) : undefined;
      const asset = photo ? renderAssets.get(photo.id) : undefined;
      const preview = asset ? getRenderInput(asset, 'review')?.input : undefined;
      if (!photo || photo.faces.length > 0 || typeof preview !== 'string') {
        continue;
      }
      const point = await this.mediaRepository.getAttentionPoint(preview).catch(() => null);
      if (point) {
        focus.set(photo.id, point);
      }
    }

    const clips = new Map<string, HighlightClipSource>();
    const unreadable = new Set<string>();
    const bestStarts = new Map<string, number>();
    for (const shot of first.shots) {
      if (shot.kind !== 'clip') {
        continue;
      }
      const row = videoRows.find((item) => item.id === shot.assetId)!;
      try {
        const info = await this.mediaRepository.probe(row.originalPath);
        const stream = info.videoStreams[0];
        if (!stream) {
          throw new Error('no video stream');
        }
        const rotated = Math.abs(stream.rotation) === 90;
        clips.set(row.id, {
          input: row.originalPath,
          width: rotated ? stream.height : stream.width,
          height: rotated ? stream.width : stream.height,
          hasAudio: info.audioStreams.length > 0,
          hdr: stream.colorTransfer === ColorTransfer.Smpte2084 || stream.colorTransfer === ColorTransfer.AribStdB67,
        });
        const start = await this.findBestClipStart(
          row.originalPath,
          info.format.duration || row.duration! / 1000,
          shot.duration,
        );
        if (start !== undefined) {
          bestStarts.set(row.id, start);
        }
      } catch (error: any) {
        unreadable.add(row.id);
        warnings.push(`The video ${row.id} could not be read (${error?.message ?? error}), so it was left out`);
      }
    }

    const plan: HighlightPlan = planHighlight(
      layoutPhotos.map((photo) => ({ ...photo, focus: focus.get(photo.id) ?? null })),
      videos
        .filter((video) => !unreadable.has(video.id))
        .map((video) => ({ ...video, bestStart: bestStarts.get(video.id) })),
      options,
    );

    const missing = plan.usedIds.filter((assetId) => !renderAssets.has(assetId));
    for (const asset of await this.bookRepository.getAssetsForRender(missing)) {
      renderAssets.set(asset.id, asset);
    }
    const photos = new Map<string, string>();
    for (const assetId of plan.usedIds) {
      const asset = renderAssets.get(assetId);
      const input = asset && asset.type === AssetType.Image ? getRenderInput(asset, 'print') : null;
      if (input && typeof input.input === 'string') {
        photos.set(assetId, input.input);
      }
    }
    return { plan, photos, clips, style };
  }

  /** where the sharpest, best exposed part of a video starts, from a few frames across it */
  private async findBestClipStart(path: string, duration: number, length: number) {
    if (duration <= length + 1) {
      return;
    }
    let best: { start: number; score: number } | undefined;
    for (let index = 0; index < CLIP_SAMPLES; index++) {
      const middle = ((index + 0.5) / CLIP_SAMPLES) * duration;
      try {
        const frame = await this.mediaRepository.getVideoFrame(path, middle);
        const analysis = await this.mediaRepository.analyzeImage(frame);
        const score = scorePhoto(analysis, [], { isFavorite: false, rating: null }).overall;
        // the very start is often shaky: a little less for the first sample
        const adjusted = index === 0 ? score - 0.05 : score;
        if (!best || adjusted > best.score) {
          best = { start: Math.max(0, Math.min(duration - length, middle - length / 2)), score: adjusted };
        }
      } catch {
        // a frame that can't be read is not a candidate
      }
    }
    return best?.start;
  }

  private async updateJob(job: HighlightJob, update: Partial<Selectable<HighlightJobTable>>) {
    const updated = await this.highlightJobRepository.update(job.id, update);
    this.websocketRepository.clientSend('on_highlight_update', updated.ownerId, mapHighlightJob(updated));
    return updated;
  }

  private async notifyOwner(
    job: HighlightJob,
    notification: { level: NotificationLevel; title: string; description: string; data: Record<string, string> },
  ) {
    try {
      const item = await this.notificationRepository.create({
        userId: job.ownerId,
        type: NotificationType.Custom,
        level: notification.level,
        title: notification.title,
        description: notification.description,
        data: JSON.stringify(notification.data),
      });
      this.websocketRepository.clientSend('on_notification', job.ownerId, mapNotification(item));
    } catch (error: any) {
      this.logger.warn(`Unable to notify the owner of highlight video ${job.id}: ${error?.message ?? error}`);
    }
  }
}

const throwIfCancelled = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw signal.reason ?? new HighlightCancelledError();
  }
};

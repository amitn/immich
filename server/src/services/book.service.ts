import { BadRequestException, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { JobOf } from 'src/types.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  BookAutoLayoutDto,
  BookAutoLayoutResponseDto,
  BookCreateDto,
  BookDetailResponseDto,
  BookExportDto,
  BookFromAlbumDto,
  BookLayoutResponseDto,
  BookMap,
  BookPageCreateDto,
  BookPageMoveDto,
  BookPageResponseDto,
  BookPageUpdateDto,
  BookRenderQueryDto,
  BookResponseDto,
  BookReviewResponseDto,
  BookSlotPatchDto,
  BookSlotUpdateDto,
  BookStyle,
  BookStylePreset,
  BookStylePresetResponseDto,
  BookStyleUpdate,
  BookUpdateDto,
  NormalizedRect,
  bookStylePresetIds,
  bookStylePresets,
  mapBook,
  mapBookDetail,
  mapBookLayout,
  mapBookPage,
  mapBookStylePreset,
  resolveBookStyle,
} from 'src/dtos/book.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  ArtJobStatus,
  AssetFileType,
  AssetType,
  BookExportFormat,
  BookExportStatus,
  CacheControl,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
  Permission,
  QueueName,
  StorageFolder,
} from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { BookPageWithPlacements, BookRepository } from 'src/repositories/book.repository.js';
import { ArtService } from 'src/services/art.service.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { ImproveService, ImprovedCopyResult, toImproveSource } from 'src/services/improve.service.js';
import { analysisCache, getAnalysisKey } from 'src/utils/agent/analysis-cache.js';
import { clusterSimilar, getClusterDefaults, parseEmbedding, toClusterIndex } from 'src/utils/agent/clustering.js';
import { isArtEnabled } from 'src/utils/agent/config.js';
import { getAdaptiveEventOptions, splitEvents } from 'src/utils/agent/events.js';
import {
  IMPROVE_MAX_POOL,
  ImproveEstimate,
  ImproveRecipe,
  getPoolScore,
  isEmptyRecipe,
  mapFaces,
} from 'src/utils/agent/improve.js';
import { ImageAnalysis, normalizeFaceBox, scorePhoto } from 'src/utils/agent/scoring.js';
import { MAIN_PEOPLE_DEFAULTS, getMainPeople, selectBest } from 'src/utils/agent/selection.js';
import { getDimensions } from 'src/utils/asset.util.js';
import {
  AutoLayoutCaptions,
  AutoLayoutPage,
  AutoLayoutPerson,
  AutoLayoutPhoto,
  AutoLayoutPlan,
  getPhotoKind,
  planAutoLayout,
} from 'src/utils/book/auto-layout.js';
import {
  getCollectionTag,
  getCollectionTagPrefixes,
  getPhotoPack,
  shareCollectionTagsInStacks,
} from 'src/utils/book/collections.js';
import {
  HTML_EXPORT_QUALITY,
  HTML_LARGE_FILE_BYTES,
  HTML_PREVIEW_QUALITY,
  HtmlImage,
  HtmlImageQuality,
  ImageSize,
  buildBookHtml,
  getHtmlFileName,
  getRegionSize,
  isImagePageLayout,
  planHtmlImages,
} from 'src/utils/book/html.js';
import {
  BookLayout,
  PageSize,
  bookLayouts,
  getLayout,
  getMapRectMm,
  getSlotAspectRatios,
  toPxRect,
  validatePageStyle,
} from 'src/utils/book/layouts.js';
import { BookMapStyleOption, resolveMapStyle } from 'src/utils/book/map-styles.js';
import {
  MapPoint,
  MapRenderContext,
  MapRenderResult,
  MapRenderSize,
  getMapAssetIds,
  parsePolygon,
  renderMap,
} from 'src/utils/book/map.js';
import { createBookPdf } from 'src/utils/book/pdf.js';
import {
  BookRenderMode,
  BookRenderWarning,
  FULL_CROP,
  PRINT_DPI,
  REVIEW_LONG_EDGE_PX,
  RenderSource,
  getContactSheetLayout,
  getDefaultCrop,
  getDpiForLongEdge,
  getPageWarnings,
  normalizeFaces,
  planContactSheet,
  planPage,
} from 'src/utils/book/render.js';
import { reviewBook } from 'src/utils/book/review.js';
import { asHumanReadable } from 'src/utils/bytes.js';
import { ImmichFileResponse } from 'src/utils/file.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { findOrFail } from 'src/utils/misc.js';

type Book = NonNullable<Awaited<ReturnType<BookRepository['get']>>>;
type BookPage = Awaited<ReturnType<BookRepository['getPages']>>[number];
type RenderAsset = Awaited<ReturnType<BookRepository['getAssetsForRender']>>[number];
type AgentAsset = Awaited<ReturnType<AssetJobRepository['getForAgent']>>[number];

export type BookRenderResult = {
  data: Buffer;
  warnings: BookRenderWarning[];
  /** private sources (e.g. travel documents) blurred on the page, when asked to hide them */
  hidden?: string[];
};

/** the long edge a private source is shrunk to before it fills its slot: its text can't be read */
const HIDDEN_SOURCE_PX = 12;

/** a placed photo that an improved copy would help, see `ImproveService.estimate` */
export type BookImprovement = { assetId: string; recipe: ImproveRecipe; gain: number };

export type BookImprovedPhoto = { sourceId: string; id: string; description: string; pages: number[] };

export type BookAutoLayoutResult = {
  book: BookDetailResponseDto;
  plan: AutoLayoutPlan;
  /** photos considered, after the album cap and the video filter */
  photoCount: number;
  warnings: string[];
  /** placed photos that improved copies would help, when they were not created */
  improvements: BookImprovement[];
  /** improved copies that were created and placed instead of their originals */
  improved: BookImprovedPhoto[];
};

export type BookApplyImprovementsResult = {
  improved: BookImprovedPhoto[];
  skipped: Array<{ assetId: string; reason: string }>;
};

/** the simulated fixes of the photos of a layout, by asset id */
type LayoutEstimates = Map<string, ImproveEstimate>;

type LayOutOptions = {
  assetIds: string[];
  targetPageCount?: number;
  includeMaps?: boolean;
  mapStyle?: BookMapStyleOption;
  illustratedMaps?: boolean;
  heroAssetIds?: string[];
  keepExisting?: boolean;
  captions?: AutoLayoutCaptions;
  maxArtworkShare?: number;
  maxStackPairs?: number;
  considerImprovements?: boolean;
  improvePhotos?: boolean;
};

const DEFAULT_PAGE_SIZE_MM = 210;
/** most photos an automatic layout considers; larger albums are narrowed down first */
export const MAX_LAYOUT_PHOTOS = 600;
const MAX_ALBUM_PHOTOS = 3000;
/** image analysis is skipped for more uncached photos than this, using metadata-only scores */
const MAX_ANALYZED_PHOTOS = 300;
const ILLUSTRATED_MAP_LONG_EDGE = 1536;

export const getMapArtPrompt = (title?: string) =>
  [
    'Redraw this map as a hand-illustrated vintage watercolor travel map, like a page of a travel journal:',
    'soft watercolor washes on textured cream paper, hand-inked coastlines, rivers and roads, and small illustrated',
    'landmarks or scenery where they fit.',
    'Keep the geography, the route line, the pins and the place names exactly where they are and clearly legible,',
    `and keep the compass rose and the scale bar${title ? ` and the title "${title}"` : ''}.`,
    'Do not add, remove or translate any text, and keep the aspect ratio of the map.',
  ].join(' ');

/** the most source photos whose text is read for their pages (each is read at full resolution) */
const MAX_SOURCE_PAGES = 24;

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

export const getBookPdfPath = (book: { id: string; ownerId: string }) =>
  join(StorageCore.getFolderLocation(StorageFolder.Thumbnails, book.ownerId), 'books', `${book.id}.pdf`);

/** previews of recently viewed books, keyed by book id and content version */
const PREVIEW_CACHE_SIZE = 8;
const previewCache = new Map<string, string>();

export const getBookHtmlPath = (book: { id: string; ownerId: string }) =>
  join(StorageCore.getFolderLocation(StorageFolder.Thumbnails, book.ownerId), 'books', `${book.id}.html`);

const getAssetDimensions = (asset: RenderAsset) =>
  asset.width && asset.height
    ? { width: asset.width, height: asset.height }
    : getDimensions({
        exifImageWidth: asset.exifImageWidth,
        exifImageHeight: asset.exifImageHeight,
        orientation: asset.orientation,
      });

/** Picks the file a slot is drawn from; edited assets always use their edited renditions */
const getRenderInput = (asset: RenderAsset, mode: BookRenderMode): Omit<RenderSource, 'width' | 'height'> | null => {
  const find = (type: AssetFileType) =>
    asset.files.find((file) => file.type === type && file.isEdited === asset.isEdited)?.path ??
    asset.files.find((file) => file.type === type && !file.isEdited)?.path;

  const preview = find(AssetFileType.Preview);
  const thumbnail = find(AssetFileType.Thumbnail);

  switch (mode) {
    case 'thumbnail': {
      const input = thumbnail ?? preview;
      return input ? { input } : null;
    }

    case 'review': {
      const input = preview ?? thumbnail;
      return input ? { input } : null;
    }

    case 'print': {
      if (asset.type === AssetType.Image) {
        if (!asset.isEdited && mimeTypes.isWebSupportedImage(asset.originalFileName)) {
          return { input: asset.originalPath };
        }

        const fullsize = find(AssetFileType.FullSize);
        if (fullsize) {
          return { input: fullsize };
        }
      }

      return preview
        ? { input: preview, fallback: 'no full resolution image is available, so the lower resolution preview is used' }
        : null;
    }
  }
};

const toPageValues = (page: AutoLayoutPage): BookPageWithPlacements => ({
  layout: page.layout,
  sectionTitle: page.sectionTitle ?? null,
  caption: page.caption ?? null,
  background: null,
  map: page.map ?? null,
  assets: page.slots.map((slot, index) => ({
    slot: index,
    assetId: slot.assetId,
    crop: slot.crop,
    caption: slot.caption ?? null,
  })),
});

/** event index of every photo, see `splitEvents`; a single day is split into chapters by its own gaps */
const getEventIndex = (rows: AgentAsset[]) => {
  const points = rows.map((row) => ({
    id: row.id,
    time: row.localDateTime.getTime(),
    latitude: row.latitude,
    longitude: row.longitude,
  }));
  const events = splitEvents(points, getAdaptiveEventOptions(points));
  return new Map(events.flatMap((event, index) => event.map(({ id }) => [id, index] as const)));
};

/** the people in a photo, once each */
const getPeople = (row: Pick<AgentAsset, 'faces'>): AutoLayoutPerson[] => {
  const people = new Map<string, AutoLayoutPerson>();
  for (const face of row.faces) {
    if (face.personId && !people.get(face.personId)?.name) {
      people.set(face.personId, { id: face.personId, name: face.name });
    }
  }
  return people.values().toArray();
};

const toCountryOutlines = (rows: Array<{ admin: string; coordinates: string }>) =>
  rows.map((row) => ({ name: row.admin, rings: [parsePolygon(row.coordinates)] }));

@Injectable()
export class BookService extends BaseService {
  getLayouts(): BookLayoutResponseDto[] {
    return bookLayouts.map((layout) => mapBookLayout(layout));
  }

  getStylePresets(): BookStylePresetResponseDto[] {
    return bookStylePresetIds.map((id) => mapBookStylePreset(id));
  }

  async getAll(auth: AuthDto): Promise<BookResponseDto[]> {
    const books = await this.bookRepository.getAll(auth.user.id);
    return books.map((book) => mapBook(book));
  }

  async get(auth: AuthDto, id: string): Promise<BookDetailResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookRead, ids: [id] });
    return this.getDetail(id);
  }

  async create(auth: AuthDto, dto: BookCreateDto): Promise<BookDetailResponseDto> {
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    }

    const size = {
      pageWidthMm: dto.pageWidthMm ?? DEFAULT_PAGE_SIZE_MM,
      pageHeightMm: dto.pageHeightMm ?? DEFAULT_PAGE_SIZE_MM,
    };
    const style = this.mergeStyle(undefined, dto.style, dto.stylePreset);
    this.requireValidStyle(size, style);

    const book = await this.bookRepository.create({
      ownerId: auth.user.id,
      albumId: dto.albumId ?? null,
      title: dto.title,
      subtitle: dto.subtitle ?? null,
      ...size,
      style,
    });

    return mapBookDetail(book, []);
  }

  /** Creates a book from an album and lays out its photos automatically */
  async createFromAlbum(auth: AuthDto, dto: BookFromAlbumDto): Promise<BookAutoLayoutResponseDto> {
    const { book, warnings } = await this.createFromAlbumWithPlan(auth, dto);
    return { ...book, warnings };
  }

  async createFromAlbumWithPlan(auth: AuthDto, dto: BookFromAlbumDto): Promise<BookAutoLayoutResult> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    const album = await this.albumRepository.getById(dto.albumId, { withAssets: false });
    if (!album) {
      throw new BadRequestException('Album not found');
    }

    const assetIds = await this.getAlbumAssetIds(auth, dto.albumId);
    if (assetIds.length === 0) {
      throw new BadRequestException('The album has no photos');
    }

    const created = await this.create(auth, {
      title: dto.title ?? (album.albumName.trim() || 'Photo book'),
      subtitle: dto.subtitle,
      albumId: dto.albumId,
      pageWidthMm: dto.pageWidthMm,
      pageHeightMm: dto.pageHeightMm,
      stylePreset: dto.stylePreset,
      style: dto.style,
    });

    try {
      return await this.layOut(auth, created.id, {
        assetIds,
        targetPageCount: dto.targetPageCount,
        includeMaps: dto.includeMaps,
        mapStyle: dto.mapStyle,
        illustratedMaps: dto.illustratedMaps,
        captions: dto.captions,
        maxArtworkShare: dto.maxArtworkShare,
        maxStackPairs: dto.maxStackPairs,
        considerImprovements: dto.considerImprovements,
        improvePhotos: dto.improvePhotos,
      });
    } catch (error) {
      await this.bookRepository.delete(created.id);
      throw error;
    }
  }

  /** Lays out a book again from its album (or the given photos), replacing its pages unless `keepExisting` */
  async autoLayout(auth: AuthDto, id: string, dto: BookAutoLayoutDto): Promise<BookAutoLayoutResponseDto> {
    const { book, warnings } = await this.autoLayoutWithPlan(auth, id, dto);
    return { ...book, warnings };
  }

  async autoLayoutWithPlan(auth: AuthDto, id: string, dto: BookAutoLayoutDto): Promise<BookAutoLayoutResult> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');

    let assetIds: string[];
    if (dto.assetIds) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: dto.assetIds });
      assetIds = dto.assetIds;
    } else if (book.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [book.albumId] });
      assetIds = await this.getAlbumAssetIds(auth, book.albumId);
    } else {
      throw new BadRequestException('The book is not linked to an album, so pass the assetIds to lay out');
    }

    if (dto.heroAssetIds?.length) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: dto.heroAssetIds });
      assetIds = [...new Set([...assetIds, ...dto.heroAssetIds])];
    }

    return this.layOut(auth, id, { ...dto, assetIds });
  }

  /** A checklist of what to fix in a book (see `reviewBook`), with the best photos of its album that are not in it */
  async getReview(auth: AuthDto, id: string): Promise<BookReviewResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookRead, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const pages = await this.bookRepository.getPages(id);

    const placedIds = new Set(pages.flatMap((page) => page.assets.map(({ assetId }) => assetId)));
    if (book.coverAssetId) {
      placedIds.add(book.coverAssetId);
    }
    const placed =
      placedIds.size > 0
        ? await this.checkAccess({ auth, permission: Permission.AssetRead, ids: placedIds })
        : new Set<string>();

    let albumIds: string[] = [];
    if (book.albumId) {
      const albums = await this.checkAccess({ auth, permission: Permission.AlbumRead, ids: new Set([book.albumId]) });
      albumIds = albums.has(book.albumId) ? await this.getAlbumAssetIds(auth, book.albumId) : [];
    }

    const estimates: LayoutEstimates = new Map();
    const photos = await this.getLayoutPhotos(auth, [...placed, ...albumIds], placed, [], {
      estimates,
      only: placed,
      addGain: false,
    });
    const { books } = await this.getConfig({ withCache: true });
    return reviewBook({
      size: book,
      style: resolveBookStyle(book.style),
      pages,
      photos: photos.map((photo) => ({ ...photo, gain: estimates.get(photo.id)?.gain })),
      candidateIds: albumIds,
      coverAssetId: book.coverAssetId,
      stadiaApiKey: books.maps.stadiaApiKey,
    });
  }

  async update(auth: AuthDto, id: string, dto: BookUpdateDto): Promise<BookDetailResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    }
    if (dto.coverAssetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.coverAssetId] });
    }

    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const size = {
      pageWidthMm: dto.pageWidthMm ?? book.pageWidthMm,
      pageHeightMm: dto.pageHeightMm ?? book.pageHeightMm,
    };
    const style = this.mergeStyle(book.style, dto.style, dto.stylePreset);
    this.requireValidStyle(size, style);

    await this.bookRepository.update(id, {
      title: dto.title,
      subtitle: dto.subtitle,
      albumId: dto.albumId,
      coverAssetId: dto.coverAssetId,
      pageWidthMm: dto.pageWidthMm,
      pageHeightMm: dto.pageHeightMm,
      style: dto.style || dto.stylePreset ? style : undefined,
    });

    return this.getDetail(id);
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.BookDelete, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    await this.bookRepository.delete(id);

    const files = [
      ...new Set(
        [getBookPdfPath(book), book.exportPath, getBookHtmlPath(book), book.htmlExportPath].filter(
          (path): path is string => !!path,
        ),
      ),
    ];
    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files } });
  }

  async addPage(auth: AuthDto, id: string, dto: BookPageCreateDto): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    // an alias (e.g. source-page) is stored as the layout it names
    const layout = this.requireLayout(dto.layout).id;
    await this.requireMapAccess(auth, dto.map);

    const page = await this.bookRepository.addPage(
      id,
      {
        layout,
        sectionTitle: dto.sectionTitle ?? null,
        caption: dto.caption ?? null,
        background: dto.background ?? null,
        map: dto.map ?? null,
      },
      dto.position,
    );

    return mapBookPage(page, book);
  }

  async updatePage(auth: AuthDto, id: string, pageId: string, dto: BookPageUpdateDto): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const current = await findOrFail(() => this.bookRepository.getPage(id, pageId), 'Page');
    await this.requireMapAccess(auth, dto.map);

    let slotCount: number | undefined;
    let layout = dto.layout;
    if (layout !== undefined && layout !== current.layout) {
      // an alias (e.g. source-page) is stored as the layout it names
      const definition = this.requireLayout(layout);
      layout = definition.id;
      slotCount = layout === current.layout ? undefined : definition.slots.length;
    }

    const page = await findOrFail(
      () =>
        this.bookRepository.updatePage(
          id,
          pageId,
          {
            layout,
            sectionTitle: dto.sectionTitle,
            caption: dto.caption,
            background: dto.background,
            map: dto.map,
          },
          slotCount,
        ),
      'Page',
    );

    return mapBookPage(page, book);
  }

  async removePage(auth: AuthDto, id: string, pageId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    await findOrFail(() => this.bookRepository.getPage(id, pageId), 'Page');
    await this.bookRepository.removePage(id, pageId);
  }

  async movePage(auth: AuthDto, id: string, pageId: string, dto: BookPageMoveDto): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const page = await findOrFail(() => this.bookRepository.movePage(id, pageId, dto.position), 'Page');
    return mapBookPage(page, book);
  }

  async setSlot(
    auth: AuthDto,
    id: string,
    pageId: string,
    slot: number,
    dto: BookSlotUpdateDto,
  ): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.assetId] });

    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const page = await findOrFail(() => this.bookRepository.getPage(id, pageId), 'Page');
    const aspectRatio = this.requireSlot(book, page, slot);

    const crop = dto.crop ?? (await this.getDefaultCrop(dto.assetId, aspectRatio));
    await this.bookRepository.upsertSlot(id, {
      pageId,
      slot,
      assetId: dto.assetId,
      crop,
      caption: dto.caption ?? null,
    });

    return this.getPageResponse(book, pageId);
  }

  async updateSlot(
    auth: AuthDto,
    id: string,
    pageId: string,
    slot: number,
    dto: BookSlotPatchDto,
  ): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const page = await findOrFail(() => this.bookRepository.getPage(id, pageId), 'Page');
    const aspectRatio = this.requireSlot(book, page, slot);

    const placement = page.assets.find((asset) => asset.slot === slot);
    if (!placement) {
      throw new BadRequestException(`Slot ${slot} is empty`);
    }

    const crop =
      dto.crop === null ? await this.getDefaultCrop(placement.assetId, aspectRatio) : (dto.crop ?? undefined);
    await this.bookRepository.updateSlot(id, pageId, slot, { crop, caption: dto.caption });

    return this.getPageResponse(book, pageId);
  }

  async clearSlot(auth: AuthDto, id: string, pageId: string, slot: number): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const page = await findOrFail(() => this.bookRepository.getPage(id, pageId), 'Page');
    this.requireSlot(book, page, slot);

    await this.bookRepository.deleteSlot(id, pageId, slot);
    return this.getPageResponse(book, pageId);
  }

  /**
   * One page as an image; with `hidePrivate` (for the assistant) the private sources on it, such as travel documents,
   * are blurred beyond reading
   */
  async renderPage(
    auth: AuthDto,
    id: string,
    pageId: string,
    dto: BookRenderQueryDto = {},
    hidePrivate = false,
  ): Promise<BookRenderResult> {
    await this.requireAccess({ auth, permission: Permission.BookRead, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const pages = await this.bookRepository.getPages(id);
    const index = pages.findIndex((page) => page.id === pageId);
    if (index === -1) {
      throw new BadRequestException('Page not found');
    }

    const longEdge = dto.size ?? REVIEW_LONG_EDGE_PX;
    return this.renderBookPage(auth, book, pages[index], index + 1, {
      mode: longEdge <= 400 ? 'thumbnail' : 'review',
      dpi: getDpiForLongEdge(book, longEdge),
      pages,
      hidePrivate,
    });
  }

  /**
   * One image of pages `from`..`to` (one-based, inclusive) as labelled two-page spreads; with `hidePrivate` (for the
   * assistant) the private sources, such as travel documents, are blurred beyond reading
   */
  async renderContactSheet(
    auth: AuthDto,
    id: string,
    range: { from?: number; to?: number } = {},
    hidePrivate = false,
  ): Promise<BookRenderResult & { pages: number[] }> {
    await this.requireAccess({ auth, permission: Permission.BookRead, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const pages = await this.bookRepository.getPages(id);

    const from = Math.max(1, range.from ?? 1);
    const to = Math.min(pages.length, range.to ?? pages.length);
    if (pages.length === 0 || from > to) {
      throw new BadRequestException(pages.length === 0 ? 'The book has no pages' : 'Invalid page range');
    }

    const numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const spreadCount = new Set(numbers.map((number) => Math.floor(number / 2))).size;
    const { spreadsPerRow, thumb } = getContactSheetLayout(book, spreadCount);
    const dpi = getDpiForLongEdge(book, Math.max(thumb.width, thumb.height));

    const rendered: { number: number; image: Buffer }[] = [];
    const warnings: BookRenderWarning[] = [];
    const hidden: string[] = [];
    for (const number of numbers) {
      const result = await this.renderBookPage(auth, book, pages[number - 1], number, {
        mode: 'thumbnail',
        dpi,
        pages,
        hidePrivate,
      });
      rendered.push({ number, image: result.data });
      warnings.push(...result.warnings);
      hidden.push(...(result.hidden ?? []));
    }

    const spec = planContactSheet(rendered, thumb, { spreadsPerRow });
    const { data } = await this.mediaRepository.composeBookPage(spec);
    return { data, warnings, pages: numbers, ...(hidden.length > 0 && { hidden: [...new Set(hidden)] }) };
  }

  async export(auth: AuthDto, id: string, dto: Partial<BookExportDto> = {}): Promise<BookResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookDownload, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    if (book.pageCount === 0) {
      throw new BadRequestException('The book has no pages');
    }

    // always queue: the job queue drops duplicates while one is waiting, and a lost job can't block the book
    if (dto.format === BookExportFormat.Html) {
      await this.bookRepository.setHtmlExportStatus(id, BookExportStatus.Pending);
      await this.jobRepository.queue({ name: JobName.BookExportHtml, data: { id } });
      return mapBook({ ...book, htmlExportStatus: BookExportStatus.Pending });
    }

    await this.bookRepository.setExportStatus(id, BookExportStatus.Pending);
    await this.jobRepository.queue({ name: JobName.BookExport, data: { id } });

    return mapBook({ ...book, exportStatus: BookExportStatus.Pending });
  }

  async downloadPdf(auth: AuthDto, id: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.BookDownload, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    if (!book.exportPath) {
      throw new BadRequestException('The book has not been exported yet');
    }

    return new ImmichFileResponse({
      path: book.exportPath,
      contentType: 'application/pdf',
      cacheControl: CacheControl.PrivateWithoutCache,
      fileName: `${book.title.replaceAll(/[\\/:*?"<>|]/g, '_')}.pdf`,
    });
  }

  /** The book as the single-file HTML web book, built on demand at screen quality, for previewing in the app */
  async previewHtml(auth: AuthDto, id: string): Promise<string> {
    await this.requireAccess({ auth, permission: Permission.BookRead, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    if (book.pageCount === 0) {
      throw new BadRequestException('The book has no pages');
    }

    const key = `${book.id}/${book.contentUpdatedAt.toISOString()}`;
    const cached = previewCache.get(key);
    if (cached) {
      return cached;
    }

    const pages = await this.bookRepository.getPages(id);
    const { html } = await this.createBookHtml(auth, book, pages, HTML_PREVIEW_QUALITY);
    for (const cachedKey of previewCache.keys()) {
      if (cachedKey.startsWith(`${book.id}/`) || previewCache.size >= PREVIEW_CACHE_SIZE) {
        previewCache.delete(cachedKey);
      }
    }
    previewCache.set(key, html);
    return html;
  }

  async downloadHtml(auth: AuthDto, id: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.BookDownload, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    if (!book.htmlExportPath) {
      throw new BadRequestException('The book has not been exported as HTML yet');
    }

    return new ImmichFileResponse({
      path: book.htmlExportPath,
      contentType: 'text/html',
      cacheControl: CacheControl.PrivateWithoutCache,
      fileName: getHtmlFileName(book.title),
      disposition: 'attachment',
    });
  }

  @OnJob({ name: JobName.BookExport, queue: QueueName.BackgroundTask })
  async handleBookExport({ id }: JobOf<JobName.BookExport>): Promise<JobStatus> {
    const book = await this.bookRepository.get(id);
    if (!book) {
      return JobStatus.Skipped;
    }

    await this.bookRepository.setExportStatus(id, BookExportStatus.Running);

    try {
      const auth = await this.getOwnerAuth(book);
      const pages = await this.bookRepository.getPages(id);
      if (pages.length === 0) {
        throw new Error('The book has no pages');
      }

      const warnings: BookRenderWarning[] = [];
      const renderPages = async function* (service: BookService) {
        for (const [index, page] of pages.entries()) {
          const result = await service.renderBookPage(auth, book, page, index + 1, { mode: 'print', dpi: PRINT_DPI });
          warnings.push(...result.warnings);
          yield result.data;
        }
      };

      const pdf = await createBookPdf(renderPages(this), book, { title: book.title, subject: book.subtitle });

      const path = getBookPdfPath(book);
      this.storageCore.ensureFolders(path);
      await this.storageRepository.createOrOverwriteFile(`${path}.tmp`, pdf);
      await this.storageRepository.rename(`${path}.tmp`, path);
      await this.bookRepository.setExportStatus(id, BookExportStatus.Completed, path);

      for (const warning of warnings) {
        this.logger.debug(`Book ${id}: ${warning.message}`);
      }
      this.logger.log(`Exported book ${id} (${pages.length} pages, ${warnings.length} warnings)`);

      await this.notifyOwner(book, {
        level: NotificationLevel.Success,
        title: 'Photo book ready',
        description: `The PDF of "${book.title}" is ready to download`,
      });

      return JobStatus.Success;
    } catch (error: any) {
      this.logger.error(`Unable to export book ${id}: ${error?.message ?? error}`, error?.stack);
      await this.bookRepository.setExportStatus(id, BookExportStatus.Failed);
      await this.notifyOwner(book, {
        level: NotificationLevel.Error,
        title: 'Photo book export failed',
        description: `The PDF of "${book.title}" could not be created`,
      });
      return JobStatus.Failed;
    }
  }

  @OnJob({ name: JobName.BookExportHtml, queue: QueueName.BackgroundTask })
  async handleBookExportHtml({ id }: JobOf<JobName.BookExportHtml>): Promise<JobStatus> {
    const book = await this.bookRepository.get(id);
    if (!book) {
      return JobStatus.Skipped;
    }

    await this.bookRepository.setHtmlExportStatus(id, BookExportStatus.Running);

    try {
      const auth = await this.getOwnerAuth(book);
      const pages = await this.bookRepository.getPages(id);
      if (pages.length === 0) {
        throw new Error('The book has no pages');
      }

      const { html, imageCount } = await this.createBookHtml(auth, book, pages);
      const data = Buffer.from(html);

      const path = getBookHtmlPath(book);
      this.storageCore.ensureFolders(path);
      await this.storageRepository.createOrOverwriteFile(`${path}.tmp`, data);
      await this.storageRepository.rename(`${path}.tmp`, path);
      await this.bookRepository.setHtmlExportStatus(id, BookExportStatus.Completed, path);

      const size = asHumanReadable(data.length);
      const large = data.length > HTML_LARGE_FILE_BYTES;
      const message = `Exported book ${id} as HTML (${pages.length} pages, ${imageCount} photos, ${size})`;
      if (large) {
        this.logger.warn(`${message}; the file may be too large to email`);
      } else {
        this.logger.log(message);
      }

      await this.notifyOwner(book, {
        level: large ? NotificationLevel.Warning : NotificationLevel.Success,
        title: 'Web photo book ready',
        description: large
          ? `The HTML version of "${book.title}" is ready to download, but at ${size} it may be too large to email`
          : `The HTML version of "${book.title}" is ready to download (${size})`,
      });

      return JobStatus.Success;
    } catch (error: any) {
      this.logger.error(`Unable to export book ${id} as HTML: ${error?.message ?? error}`, error?.stack);
      await this.bookRepository.setHtmlExportStatus(id, BookExportStatus.Failed);
      await this.notifyOwner(book, {
        level: NotificationLevel.Error,
        title: 'Photo book export failed',
        description: `The HTML version of "${book.title}" could not be created`,
      });
      return JobStatus.Failed;
    }
  }

  /** Embeds every placed photo once, sized for screens, and renders map pages as whole-page images */
  private async createBookHtml(
    auth: AuthDto,
    book: Book,
    pages: BookPage[],
    quality: HtmlImageQuality = HTML_EXPORT_QUALITY,
  ) {
    const assetIds = new Set<string>();
    for (const page of pages) {
      if (isImagePageLayout(page.layout)) {
        continue;
      }
      for (const asset of page.assets) {
        assetIds.add(asset.assetId);
      }
      if (page.layout === 'cover' && book.coverAssetId) {
        assetIds.add(book.coverAssetId);
      }
    }

    const allowed =
      assetIds.size > 0
        ? await this.checkAccess({ auth, permission: Permission.AssetRead, ids: assetIds })
        : new Set<string>();
    const assets = await this.bookRepository.getAssetsForRender([...allowed]);
    const { image } = await this.getConfig({ withCache: true });

    const sources = new Map<
      string,
      { asset: RenderAsset; preview?: RenderSource['input']; full?: RenderSource['input']; size: ImageSize }
    >();
    for (const asset of assets) {
      const preview = getRenderInput(asset, 'review')?.input;
      const print = getRenderInput(asset, 'print');
      const full = print && !print.fallback ? print.input : undefined;
      const input = preview ?? full;
      if (!input) {
        continue;
      }

      let size: ImageSize = getAssetDimensions(asset);
      if (!size.width || !size.height) {
        size = await this.mediaRepository.getImageMetadata(input).catch(() => ({ width: 0, height: 0 }));
      }
      if (size.width && size.height) {
        sources.set(asset.id, { asset, preview, full, size });
      }
    }

    const sizes = new Map([...sources].map(([id, source]) => [id, source.size]));
    const images = new Map<string, HtmlImage>();
    for (const [assetId, request] of planHtmlImages(book, pages, sizes, quality)) {
      const source = sources.get(assetId)!;
      // previews are enough unless a photo is shown larger than its preview
      const previewScale = Math.min(1, image.preview.size / Math.max(source.size.width, source.size.height));
      const useFull =
        !source.preview || (quality !== HTML_PREVIEW_QUALITY && !!source.full && request.scale > previewScale * 1.1);
      const input = (useFull ? source.full : source.preview)!;
      const scale = useFull ? request.scale : Math.min(request.scale, previewScale);

      const { width, height } = getRegionSize(request.region, source.size, scale);
      const result = await this.mediaRepository.composeBookPage({
        width,
        height,
        background: '#ffffff',
        quality: quality.jpegQuality,
        overlay: null,
        slots: [{ left: 0, top: 0, width, height, input, crop: request.region }],
      });
      const [slot] = result.slots;
      if (slot && 'error' in slot) {
        this.logger.warn(`Book ${book.id}: photo ${assetId} could not be embedded (${slot.error})`);
        continue;
      }

      images.set(assetId, {
        data: result.data,
        region: request.region,
        ...source.size,
        alt: source.asset.originalFileName,
      });
    }

    const pageImages = new Map<number, Buffer>();
    for (const [index, page] of pages.entries()) {
      if (!isImagePageLayout(page.layout)) {
        continue;
      }
      const { data } = await this.renderBookPage(auth, book, page, index + 1, {
        mode: 'review',
        dpi: getDpiForLongEdge(book, quality.maxImagePx),
      });
      pageImages.set(index, data);
    }

    const times = sources
      .values()
      .map(({ asset }) => (asset.localDateTime ? new Date(asset.localDateTime).getTime() : NaN))
      .filter((time) => Number.isFinite(time))
      .toArray();
    const dateRange =
      times.length > 0 ? { start: new Date(Math.min(...times)), end: new Date(Math.max(...times)) } : null;

    return { html: buildBookHtml(book, pages, { images, pageImages, dateRange }), imageCount: images.size };
  }

  /** Renders one page; `number` is the one-based page number used in warnings */
  async renderBookPage(
    auth: AuthDto,
    book: Book,
    page: BookPage,
    number: number,
    options: { mode: BookRenderMode; dpi: number; pages?: BookPage[]; hidePrivate?: boolean },
  ): Promise<BookRenderResult> {
    const assetIds = page.assets.map((asset) => asset.assetId);
    if (page.layout === 'cover' && book.coverAssetId) {
      assetIds.push(book.coverAssetId);
    }

    const sources = await this.getRenderSources(auth, assetIds, options.mode);
    // private sources (travel documents) shown to the assistant are shrunk to a few pixels: their text can't be read
    const hidden = options.hidePrivate
      ? await BaseService.create(CollectionService, this).getPrivateSourceIds(assetIds)
      : new Set<string>();
    for (const assetId of hidden) {
      const source = sources.get(assetId);
      if (source) {
        sources.set(assetId, {
          ...source,
          input: await this.mediaRepository.resizeToJpeg(source.input, HIDDEN_SOURCE_PX),
        });
      }
    }
    const { mapImage, warnings } = await this.renderMapArea(auth, book, page, number, options);
    const plan = planPage(book, page, { ...options, sources, mapImage });
    const result = await this.mediaRepository.composeBookPage(plan.spec);
    return {
      data: result.data,
      warnings: [...getPageWarnings(plan, result, number), ...warnings],
      ...(hidden.size > 0 && { hidden: [...hidden] }),
    };
  }

  /**
   * The map of a page as an image (see `renderMapImage`), e.g. for exports. `pages` are the pages of the book, used to
   * find the photos a map plots by default; they are loaded when omitted.
   */
  async renderPageMap(
    auth: AuthDto,
    book: Book,
    page: BookPage,
    size: MapRenderSize,
    options: { mode?: BookRenderMode; pages?: BookPage[] } = {},
  ): Promise<MapRenderResult> {
    const { ctx, warnings } = await this.getMapRenderContext(auth, book, page, options);
    const result = await renderMap(ctx, page, size);
    return { ...result, warnings: [...warnings, ...result.warnings] };
  }

  /** Everything `renderMapImage` needs to draw the map of a page */
  async getMapRenderContext(
    auth: AuthDto,
    book: Book,
    page: BookPage,
    options: { mode?: BookRenderMode; pages?: BookPage[] } = {},
  ): Promise<{ ctx: MapRenderContext; warnings: string[] }> {
    const warnings: string[] = [];
    const pages = options.pages ?? (await this.bookRepository.getPages(book.id));
    const index = pages.findIndex((item) => item.id === page.id);
    const assetIds = index === -1 ? getMapAssetIds([page], 0) : getMapAssetIds(pages, index);
    const illustrated = await this.getIllustratedMap(auth, book, page, options.mode ?? 'review', warnings);

    return {
      ctx: await this.newMapContext(book, illustrated ? [] : await this.getMapPoints(auth, assetIds), illustrated),
      warnings,
    };
  }

  /** Starts an art job that redraws the map of a page as an illustration; the renderer uses it once it completes */
  async illustratePageMap(auth: AuthDto, id: string, pageId: string): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const pages = await this.bookRepository.getPages(id);
    const index = pages.findIndex((item) => item.id === pageId);
    if (index === -1) {
      throw new BadRequestException('Page not found');
    }

    const page = pages[index];
    const layout = this.requireLayout(page.layout);
    if (!layout.map) {
      throw new BadRequestException(`Layout "${layout.id}" has no map; use the map or map-photo layout`);
    }

    const { agent } = await this.getConfig({ withCache: true });
    if (!isArtEnabled(agent)) {
      throw new BadRequestException('Illustrated maps need an art agent profile (Administration → AI assistant)');
    }

    const map: BookMap = { style: 'sketch', showRoute: true, labels: true, ...page.map };
    delete map.artJobId;
    delete map.illustratedAssetId;
    const assetIds = getMapAssetIds(pages, index);
    const points = await this.getMapPoints(auth, assetIds);
    if (points.length === 0) {
      throw new BadRequestException('None of the photos of this map have a GPS location');
    }

    const ctx = await this.newMapContext(book, points);
    const artJobId = await this.startMapIllustration(
      auth,
      book,
      layout,
      { map, sectionTitle: page.sectionTitle },
      ctx,
      assetIds[0],
    );
    const updated = await findOrFail(
      () => this.bookRepository.updatePage(id, pageId, { map: { ...map, artJobId } }),
      'Page',
    );
    return mapBookPage(updated, book);
  }

  private async newMapContext(
    book: Book,
    points: MapPoint[],
    illustrated?: string | Buffer,
  ): Promise<MapRenderContext> {
    const { books } = await this.getConfig({ withCache: true });
    return {
      points,
      stadiaApiKey: books.maps.stadiaApiKey || undefined,
      getCountries: async (bounds) => toCountryOutlines(await this.bookRepository.getCountryOutlines(bounds)),
      illustrated,
      fontFamily: resolveBookStyle(book.style).fontFamily,
    };
  }

  private async renderMapArea(
    auth: AuthDto,
    book: Book,
    page: BookPage,
    number: number,
    options: { mode: BookRenderMode; dpi: number; pages?: BookPage[] },
  ): Promise<{ mapImage?: Buffer; warnings: BookRenderWarning[] }> {
    const warning = (message: string): BookRenderWarning => ({
      page: number,
      type: 'map',
      message: `Page ${number}: ${message}`,
    });
    const layout = getLayout(page.layout);
    const rectMm = layout ? getMapRectMm(layout, book, resolveBookStyle(book.style)) : null;
    if (!rectMm) {
      return {
        warnings: page.map
          ? [
              warning(
                `the page has a map, but its layout "${page.layout}" has no map area; use the map or map-photo layout`,
              ),
            ]
          : [],
      };
    }

    const rect = toPxRect(rectMm, options.dpi);
    try {
      const result = await this.renderPageMap(
        auth,
        book,
        page,
        { width: rect.width, height: rect.height, quality: options.mode === 'print' ? 92 : 85 },
        options,
      );
      return { mapImage: result.data, warnings: result.warnings.map((message) => warning(message)) };
    } catch (error: any) {
      this.logger.warn(`Unable to render the map of book page ${page.id}: ${error?.message ?? error}`);
      return { warnings: [warning(`the map could not be drawn (${error?.message ?? error})`)] };
    }
  }

  private async getMapPoints(auth: AuthDto, assetIds: string[]): Promise<MapPoint[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const allowed = await this.checkAccess({ auth, permission: Permission.AssetRead, ids: new Set(assetIds) });
    const rows = await this.bookRepository.getAssetLocations([...allowed]);
    return rows
      .filter((row) => row.latitude !== null && row.longitude !== null && !(row.latitude === 0 && row.longitude === 0))
      .map((row) => ({ lat: row.latitude!, lon: row.longitude!, time: row.localDateTime.getTime(), city: row.city }));
  }

  /** the illustrated map of a page, once its art job completed; caches the result on the page */
  private async getIllustratedMap(
    auth: AuthDto,
    book: Book,
    page: BookPage,
    mode: BookRenderMode,
    warnings: string[],
  ): Promise<string | Buffer | undefined> {
    const map = page.map;
    if (!map || (!map.illustratedAssetId && !map.artJobId)) {
      return;
    }

    let assetId = map.illustratedAssetId;
    if (!assetId && map.artJobId) {
      const allowed = await this.checkAccess({ auth, permission: Permission.ArtJobRead, ids: new Set([map.artJobId]) });
      const job = allowed.has(map.artJobId) ? await this.artJobRepository.get(map.artJobId) : undefined;
      if (!job) {
        warnings.push('the illustrated map was not found, so the map is rendered');
        return;
      }

      switch (job.status) {
        case ArtJobStatus.Pending:
        case ArtJobStatus.Running: {
          warnings.push('the illustrated map is still being drawn, so the map is rendered for now');
          return;
        }
        case ArtJobStatus.Failed: {
          warnings.push(`the map could not be illustrated (${job.error ?? 'unknown error'}), so the map is rendered`);
          return;
        }
        case ArtJobStatus.Completed: {
          assetId = job.resultAssetId ?? undefined;
          if (assetId) {
            await this.bookRepository
              .updatePage(book.id, page.id, { map: { ...map, illustratedAssetId: assetId } })
              .catch((error) => this.logger.warn(`Unable to save the illustrated map of page ${page.id}: ${error}`));
          }
          break;
        }
      }
    }

    if (!assetId) {
      return;
    }

    const allowed = await this.checkAccess({ auth, permission: Permission.AssetRead, ids: new Set([assetId]) });
    const [asset] = allowed.has(assetId) ? await this.bookRepository.getAssetsForRender([assetId]) : [];
    if (!asset) {
      warnings.push('the illustrated map is missing or not accessible, so the map is rendered');
      return;
    }

    // a new artwork has no thumbnails for a little while
    return getRenderInput(asset, mode)?.input ?? asset.originalPath;
  }

  /** saves the rendered map as an asset next to the section's first photo and starts an art job that redraws it */
  private async startMapIllustration(
    auth: AuthDto,
    book: Book,
    layout: BookLayout,
    page: { map: BookMap; sectionTitle?: string | null },
    ctx: MapRenderContext,
    sourceAssetId: string,
  ): Promise<string> {
    const rect = getMapRectMm(layout, book, resolveBookStyle(book.style))!;
    const aspect = rect.width / rect.height;
    const size =
      aspect >= 1
        ? { width: ILLUSTRATED_MAP_LONG_EDGE, height: Math.round(ILLUSTRATED_MAP_LONG_EDGE / aspect) }
        : { width: Math.round(ILLUSTRATED_MAP_LONG_EDGE * aspect), height: ILLUSTRATED_MAP_LONG_EDGE };
    const { data } = await renderMap({ ...ctx, illustrated: null }, page, { ...size, format: 'png' });

    const title = page.map.title ?? page.sectionTitle ?? undefined;
    const derivedAssetService = BaseService.create(DerivedAssetService, this);
    const { id } = await derivedAssetService.createDerivedAsset(
      auth,
      sourceAssetId,
      { buffer: data, extension: 'png' },
      { description: `Map${title ? ` of ${title}` : ''} for the book “${book.title}”`, suffix: 'map', stack: false },
    );

    const artService = BaseService.create(ArtService, this);
    const job = await artService.createJob(auth, { assetId: id, prompt: getMapArtPrompt(title) });
    return job.id;
  }

  /** accessible photos of an album in time order */
  private async getAlbumAssetIds(auth: AuthDto, albumId: string) {
    const rows = await this.assetJobRepository.getForAgentEvents({
      albumId,
      viewingUserId: auth.user.id,
      limit: MAX_ALBUM_PHOTOS,
    });
    return rows.map((row) => row.id);
  }

  private async layOut(auth: AuthDto, id: string, options: LayOutOptions): Promise<BookAutoLayoutResult> {
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const existing = options.keepExisting ? await this.bookRepository.getPages(id) : [];
    const placed = new Set(existing.flatMap((page) => page.assets.map(({ assetId }) => assetId)));
    const heroIds = new Set(options.heroAssetIds);
    const assetIds = options.assetIds.filter((assetId) => !placed.has(assetId) || heroIds.has(assetId));

    const warnings: string[] = [];
    const estimates: LayoutEstimates = new Map();
    const considerImprovements = options.considerImprovements ?? true;
    const photos = await this.getLayoutPhotos(
      auth,
      assetIds,
      heroIds,
      warnings,
      considerImprovements ? { estimates, addGain: true } : undefined,
    );
    if (photos.length === 0) {
      throw new BadRequestException(
        placed.size > 0 ? 'All photos are already in the book' : 'There are no photos to lay out',
      );
    }

    const { books } = await this.getConfig({ withCache: true });
    const { style: mapStyle, warning: mapWarning } = resolveMapStyle(options.mapStyle, books.maps);
    const includeMaps = options.includeMaps ?? true;

    const plan = planAutoLayout(photos, {
      size: book,
      style: resolveBookStyle(book.style),
      targetPageCount: options.targetPageCount,
      includeMaps,
      mapStyle,
      heroIds: [...heroIds],
      cover: existing.length === 0,
      captions: options.captions,
      maxArtworkShare: options.maxArtworkShare,
      maxStackPairs: options.maxStackPairs,
    });

    if (mapWarning && plan.pages.some((page) => page.map)) {
      warnings.push(mapWarning);
    }
    if (options.illustratedMaps && plan.pages.some((page) => page.map)) {
      await this.illustratePlannedMaps(auth, book, plan, photos, warnings);
    }

    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    if (options.improvePhotos && !considerImprovements) {
      const placedIds = new Set(plan.usedIds);
      await this.getLayoutPhotos(auth, [...placedIds], new Set(), [], { estimates, only: placedIds, addGain: false });
    }
    const improvements = this.getImprovements(plan.usedIds, byId, estimates);
    let improved: BookImprovedPhoto[] = [];
    if (options.improvePhotos && improvements.length > 0) {
      const copies = await this.createImprovedCopies(auth, improvements, warnings);
      improved = this.swapInCopies(book, plan.pages, copies, byId);
      plan.usedIds = plan.usedIds.map((assetId) => copies.get(assetId)?.id ?? assetId);
    }

    await this.bookRepository.replacePages(
      id,
      plan.pages.map((page) => toPageValues(page)),
      { keepExisting: options.keepExisting },
    );

    const improvedIds = new Set(improved.map(({ sourceId }) => sourceId));
    return {
      book: await this.getDetail(id),
      plan,
      photoCount: photos.length,
      warnings,
      improvements: improvements.filter(({ assetId }) => !improvedIds.has(assetId)),
      improved,
    };
  }

  /**
   * Creates improved copies (straightened, auto-enhanced) of the photos in a book that the simulated fixes clearly
   * help, and places them instead of their originals, with the crops of the slots recomputed for the copies.
   */
  async applyImprovements(
    auth: AuthDto,
    id: string,
    options: { assetIds?: string[] } = {},
  ): Promise<BookApplyImprovementsResult> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const pages = await this.bookRepository.getPages(id);

    const placedIds = new Set(pages.flatMap((page) => page.assets.map(({ assetId }) => assetId)));
    const wanted = options.assetIds ? new Set(options.assetIds) : placedIds;
    const requested = placedIds.intersection(wanted);
    const allowed =
      requested.size > 0
        ? requested.intersection(await this.checkAccess({ auth, permission: Permission.AssetRead, ids: requested }))
        : new Set<string>();

    const estimates: LayoutEstimates = new Map();
    const photos = await this.getLayoutPhotos(auth, [...allowed], new Set(), [], {
      estimates,
      only: allowed,
      addGain: false,
    });
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const improvements = this.getImprovements([...allowed], byId, estimates);

    const failures = new Map<string, string>();
    const copies = await this.createImprovedCopies(auth, improvements, [], failures);
    const layoutPages: AutoLayoutPage[] = pages.map((page) => ({
      layout: page.layout,
      slots: page.assets.map((asset) => ({ assetId: asset.assetId, crop: asset.crop ?? { ...FULL_CROP } })),
    }));
    const improved = this.swapInCopies(book, layoutPages, copies, byId);

    for (const [index, page] of pages.entries()) {
      for (const [slotIndex, asset] of page.assets.entries()) {
        const slot = layoutPages[index].slots[slotIndex];
        if (slot.assetId === asset.assetId) {
          continue;
        }
        await this.bookRepository.upsertSlot(id, {
          pageId: page.id,
          slot: asset.slot,
          assetId: slot.assetId,
          crop: slot.crop,
          caption: asset.caption ?? null,
        });
      }
    }
    const coverCopy = book.coverAssetId ? copies.get(book.coverAssetId) : undefined;
    if (coverCopy) {
      await this.bookRepository.update(id, { coverAssetId: coverCopy.id });
    }

    const reasonFor = (assetId: string) => {
      if (!placedIds.has(assetId)) {
        return 'not in the book';
      }
      if (!allowed.has(assetId)) {
        return 'no access';
      }
      const photo = byId.get(assetId);
      if (photo?.kind === 'improved') {
        return 'already improved';
      }
      return failures.get(assetId) ?? 'no fix helps it measurably';
    };
    const skipped = [...wanted]
      .filter((assetId) => !copies.has(assetId))
      .map((assetId) => ({ assetId, reason: reasonFor(assetId) }));
    return { improved, skipped };
  }

  /** placed photos with a helpful recipe; artwork and copies that are already improved are left alone */
  private getImprovements(
    assetIds: string[],
    photos: Map<string, AutoLayoutPhoto>,
    estimates: LayoutEstimates,
  ): BookImprovement[] {
    const result: BookImprovement[] = [];
    for (const assetId of new Set(assetIds)) {
      const photo = photos.get(assetId);
      const estimate = estimates.get(assetId);
      if (!photo || !estimate || estimate.gain <= 0 || photo.kind === 'artwork' || photo.kind === 'improved') {
        continue;
      }
      // the slots crop the photos, so only straightening and enhancing are applied
      const { crop: _, ...recipe } = estimate.recipe;
      if (!isEmptyRecipe(recipe)) {
        result.push({ assetId, recipe, gain: estimate.gain });
      }
    }
    return result;
  }

  /** one improved copy per photo, one at a time: every photo is decoded at full resolution */
  private async createImprovedCopies(
    auth: AuthDto,
    improvements: BookImprovement[],
    warnings: string[],
    failures = new Map<string, string>(),
  ) {
    const improveService = BaseService.create(ImproveService, this);
    const copies = new Map<string, ImprovedCopyResult>();
    for (const { assetId, recipe } of improvements) {
      try {
        copies.set(assetId, await improveService.createImprovedCopy(auth, assetId, recipe));
      } catch (error: any) {
        const message = String(error?.response?.message ?? error?.message ?? error);
        failures.set(assetId, message);
        warnings.push(`Photo ${assetId} could not be improved (${message}), so the original is used`);
      }
    }
    return copies;
  }

  /** places the copies instead of their originals, with the crops of the slots recomputed for the copies */
  private swapInCopies(
    book: Book,
    pages: AutoLayoutPage[],
    copies: Map<string, ImprovedCopyResult>,
    photos: Map<string, AutoLayoutPhoto>,
  ): BookImprovedPhoto[] {
    const style = resolveBookStyle(book.style);
    const improved = new Map<string, BookImprovedPhoto>();
    for (const [index, page] of pages.entries()) {
      const layout = getLayout(page.layout);
      const aspects = layout ? getSlotAspectRatios(layout, book, style) : [];
      for (const [slotIndex, slot] of page.slots.entries()) {
        const copy = copies.get(slot.assetId);
        const photo = photos.get(slot.assetId);
        if (!copy || !photo) {
          continue;
        }
        // the faces of the copy are detected later, so the faces of the original are moved into it
        const faces = mapFaces(
          photo.faces.map((face) => ({ x1: face.x, y1: face.y, x2: face.x + face.width, y2: face.y + face.height })),
          { rotate: copy.applied.rotate, crop: copy.applied.crop },
          photo,
        ).map((face) => ({ x: face.x1, y: face.y1, width: face.x2 - face.x1, height: face.y2 - face.y1 }));
        const aspect = aspects[slotIndex];
        page.slots[slotIndex] = {
          ...slot,
          assetId: copy.id,
          crop: aspect ? getDefaultCrop({ width: copy.width, height: copy.height }, faces, aspect) : slot.crop,
        };
        const entry = improved.get(copy.sourceId) ?? {
          sourceId: copy.sourceId,
          id: copy.id,
          description: copy.description,
          pages: [],
        };
        entry.pages.push(index + 1);
        improved.set(copy.sourceId, entry);
      }
    }
    return improved.values().toArray();
  }

  private async illustratePlannedMaps(
    auth: AuthDto,
    book: Book,
    plan: AutoLayoutPlan,
    photos: AutoLayoutPhoto[],
    warnings: string[],
  ) {
    const { agent } = await this.getConfig({ withCache: true });
    if (!isArtEnabled(agent)) {
      warnings.push('Illustrated maps need an art agent profile (Administration → AI assistant), so they were skipped');
      return;
    }

    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const pages = plan.pages.map((page) => ({ ...page, assets: page.slots }));

    for (const [index, page] of plan.pages.entries()) {
      const layout = getLayout(page.layout);
      if (!page.map || !layout?.map) {
        continue;
      }

      const assetIds = getMapAssetIds(pages, index);
      const points = assetIds
        .map((assetId) => byId.get(assetId))
        .filter((photo) => typeof photo?.lat === 'number' && typeof photo?.lon === 'number')
        .map((photo) => ({ lat: photo!.lat!, lon: photo!.lon!, time: photo!.takenAt, city: photo!.city }))
        .toSorted((a, b) => a.time - b.time);
      if (points.length === 0) {
        continue;
      }

      try {
        const ctx = await this.newMapContext(book, points);
        const artJobId = await this.startMapIllustration(
          auth,
          book,
          layout,
          { map: page.map, sectionTitle: page.sectionTitle },
          ctx,
          assetIds[0],
        );
        page.map = { ...page.map, artJobId };
      } catch (error: any) {
        const message = error?.response?.message ?? error?.message ?? String(error);
        warnings.push(`Page ${index + 1}: the map could not be illustrated (${message})`);
      }
    }
  }

  /** photos with their size, faces, place, quality score, near-duplicate cluster and event */
  private async getLayoutPhotos(
    auth: AuthDto,
    assetIds: string[],
    heroIds: Set<string>,
    warnings: string[],
    improve?: {
      /** filled with the simulated fixes of the photos */
      estimates: LayoutEstimates;
      /** simulate these photos; default: the best by the scores that forgive fixable weaknesses */
      only?: Set<string>;
      /** score the photos on what they can become */
      addGain: boolean;
    },
  ): Promise<AutoLayoutPhoto[]> {
    const found = await this.assetJobRepository.getForAgent([...new Set(assetIds)], auth.user.id);
    let rows = found.filter((row) => row.type === AssetType.Image);

    if (rows.length > MAX_LAYOUT_PHOTOS) {
      const eventIndex = getEventIndex(rows);
      const candidates = rows.map((row) => ({
        id: row.id,
        time: row.localDateTime.getTime(),
        score: scorePhoto(
          null,
          row.faces.map((face) => normalizeFaceBox(face)),
          { isFavorite: row.isFavorite, rating: row.rating },
        ).overall,
        event: eventIndex.get(row.id) ?? null,
        personIds: getPeople(row).map(({ id }) => id),
      }));
      const { ids } = selectBest(candidates, {
        count: MAX_LAYOUT_PHOTOS,
        minPerEvent: 1,
        requirePersonIds: getMainPeople(candidates),
        minPerPerson: MAIN_PEOPLE_DEFAULTS.perBook,
        minPerPersonPerEvent: MAIN_PEOPLE_DEFAULTS.perEvent,
        mustIncludeIds: [...heroIds],
        chronological: true,
      });
      const selected = new Set(ids);
      warnings.push(`There are ${rows.length} photos, so the best ${selected.size} of them were laid out`);
      rows = rows.filter((row) => selected.has(row.id));
    }

    const ids = rows.map((row) => row.id);
    const [renderAssets, embeddings, stackInfo, collectionTags, { machineLearning }] = await Promise.all([
      this.bookRepository.getAssetsForRender(ids),
      this.searchRepository.getEmbeddings(ids),
      this.bookRepository.getStackInfo(ids),
      // the entries and sources of the collections, e.g. dishes and menus tagged Food/<Restaurant>/<Dish> and
      // Food/<Restaurant>/Menu
      Promise.all(
        getCollectionTagPrefixes().map((prefix) => this.tagRepository.getAssetTagValues(auth.user.id, ids, prefix)),
      ),
      this.getConfig({ withCache: true }),
    ]);

    const assets = new Map(renderAssets.map((asset) => [asset.id, asset]));
    const tagValues = Map.groupBy(collectionTags.flat(), ({ assetId }) => assetId);
    const stacks = new Map(stackInfo.map((info) => [info.id, info]));
    const vectors = new Map(embeddings.map(({ assetId, embedding }) => [assetId, parseEmbedding(embedding)]));
    const clusters = clusterSimilar(
      rows.map((row) => ({ id: row.id, time: row.fileCreatedAt.getTime(), embedding: vectors.get(row.id) })),
      getClusterDefaults(machineLearning.duplicateDetection.maxDistance),
    );
    const clusterIndex = toClusterIndex(clusters.filter((cluster) => cluster.ids.length > 1));
    const eventIndex = getEventIndex(rows);

    const uncached = rows.filter(
      (row) => row.previewPath && !analysisCache.has(getAnalysisKey({ ...row, previewPath: row.previewPath })),
    ).length;
    const analyze = uncached <= MAX_ANALYZED_PHOTOS;
    if (!analyze) {
      warnings.push(`Photo quality was estimated from metadata, because ${uncached} photos have not been analyzed yet`);
    }
    const analyses = await mapLimit(rows, 4, (row) => this.getImageAnalysis(row, analyze));
    if (improve && analyze) {
      await this.estimateImprovements(rows, analyses, heroIds, improve);
    }

    const photos = rows.map((row, index): AutoLayoutPhoto => {
      const asset = assets.get(row.id);
      const size = asset ? getAssetDimensions(asset) : { width: row.width ?? 0, height: row.height ?? 0 };
      const faces = row.faces.map((face) => normalizeFaceBox(face));
      return {
        id: row.id,
        width: size.width,
        height: size.height,
        takenAt: row.localDateTime.getTime(),
        lat: row.latitude,
        lon: row.longitude,
        city: row.city,
        country: row.country,
        score:
          scorePhoto(analyses[index], faces, { isFavorite: row.isFavorite, rating: row.rating }).overall +
          (improve?.addGain ? (improve.estimates.get(row.id)?.gain ?? 0) : 0),
        // face boxes are relative to the unedited image
        faces: asset?.isEdited
          ? []
          : faces.map((box) => ({ x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 })),
        isFavorite: row.isFavorite,
        clusterId: clusterIndex.get(row.id) ?? null,
        eventIndex: eventIndex.get(row.id) ?? 0,
        stackId: stacks.get(row.id)?.stackId ?? null,
        kind: getPhotoKind(stacks.get(row.id) ?? {}),
        people: getPeople(row),
        embedding: vectors.get(row.id) ?? null,
        collection: getCollectionTag((tagValues.get(row.id) ?? []).map(({ value }) => value)) ?? null,
      };
    });
    // the source (menu) photo that reads best gets the source page
    const menuIds = photos.filter((photo) => photo.collection?.kind === 'source').map((photo) => photo.id);
    if (menuIds.length > 1) {
      const lines = Map.groupBy(await this.ocrRepository.getByAssetIds(menuIds), ({ assetId }) => assetId);
      for (const photo of photos) {
        photo.textLines = lines.get(photo.id)?.length ?? 0;
      }
    }
    // the page a pack typesets from the text of a source: beside its photo (the ingredients and steps of a recipe), or
    // in place of it (the fields of a ticket, whose photo is never printed, even when its text can't be read)
    const typeset = photos
      .filter((photo) => photo.collection?.kind === 'source' && getPhotoPack(photo)?.book.sourcePage)
      .slice(0, MAX_SOURCE_PAGES);
    if (typeset.length > 0) {
      const collections = BaseService.create(CollectionService, this);
      await mapLimit(typeset, 2, async (photo) => {
        const { pack, place } = photo.collection!;
        const page = await collections.getSourcePage(pack, photo.id, place);
        if (page) {
          photo.sourcePage = { ...page, layout: getPhotoPack(photo)!.book.sourcePage!.layout };
        }
      });
    }

    // a copy of a dish (e.g. an improved one) is still that dish
    return shareCollectionTagsInStacks(photos);
  }

  /**
   * The simulated fixes (straightening and auto-enhance; the slots crop the photos) of up to `IMPROVE_MAX_POOL` photos:
   * the given ones, or the heroes and the best by the scores that forgive what the fixes can repair
   */
  private async estimateImprovements(
    rows: AgentAsset[],
    analyses: Array<ImageAnalysis | null>,
    heroIds: Set<string>,
    improve: { estimates: LayoutEstimates; only?: Set<string> },
  ) {
    const sources = rows.map((row) => toImproveSource(row));
    let pool = sources.filter((source, index) => analyses[index] && (!improve.only || improve.only.has(source.id)));
    if (!improve.only && pool.length > IMPROVE_MAX_POOL) {
      const scores = new Map(
        sources.map((source, index) => [
          source.id,
          getPoolScore(analyses[index], source.faces, { isFavorite: source.isFavorite, rating: source.rating }, source),
        ]),
      );
      pool = pool
        .toSorted(
          (a, b) => Number(heroIds.has(b.id)) - Number(heroIds.has(a.id)) || scores.get(b.id)! - scores.get(a.id)!,
        )
        .slice(0, IMPROVE_MAX_POOL);
    }

    const estimates = await BaseService.create(ImproveService, this).estimateMany(pool, { crop: false });
    for (const [index, estimate] of estimates.entries()) {
      if (estimate) {
        improve.estimates.set(pool[index].id, estimate);
      }
    }
  }

  private async getImageAnalysis(
    row: { id: string; checksum: Buffer; previewPath: string | null },
    analyze: boolean,
  ): Promise<ImageAnalysis | null> {
    if (!row.previewPath) {
      return null;
    }

    const key = getAnalysisKey({ ...row, previewPath: row.previewPath });
    const cached = analysisCache.get(key);
    if (cached || !analyze) {
      return cached ?? null;
    }

    try {
      const analysis = await this.mediaRepository.analyzeImage(row.previewPath);
      analysisCache.set(key, analysis);
      return analysis;
    } catch (error) {
      this.logger.warn(`Unable to analyze preview of asset ${row.id}: ${error}`);
      return null;
    }
  }

  private async getRenderSources(auth: AuthDto, assetIds: string[], mode: BookRenderMode) {
    const sources = new Map<string, RenderSource>();
    if (assetIds.length === 0) {
      return sources;
    }

    const allowed = await this.checkAccess({ auth, permission: Permission.AssetRead, ids: new Set(assetIds) });
    for (const asset of await this.bookRepository.getAssetsForRender([...allowed])) {
      const input = getRenderInput(asset, mode);
      if (input) {
        sources.set(asset.id, { ...input, ...getAssetDimensions(asset) });
      }
    }

    return sources;
  }

  private async getDefaultCrop(assetId: string, aspectRatio: number): Promise<NormalizedRect> {
    const [asset] = await this.bookRepository.getAssetsForRender([assetId]);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    // face boxes are relative to the unedited image
    const faces = asset.isEdited ? [] : normalizeFaces(await this.bookRepository.getFaces([assetId]));
    return getDefaultCrop(getAssetDimensions(asset), faces, aspectRatio);
  }

  private async getDetail(id: string) {
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const pages = await this.bookRepository.getPages(id);
    return mapBookDetail(book, pages);
  }

  private async getPageResponse(book: Book, pageId: string) {
    const page = await findOrFail(() => this.bookRepository.getPage(book.id, pageId), 'Page');
    return mapBookPage(page, book);
  }

  private async requireMapAccess(auth: AuthDto, map: BookMap | null | undefined) {
    if (!map) {
      return;
    }

    const assetIds = [...(map.assetIds ?? []), ...(map.illustratedAssetId ? [map.illustratedAssetId] : [])];
    if (assetIds.length > 0) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: assetIds });
    }
    if (map.artJobId) {
      await this.requireAccess({ auth, permission: Permission.ArtJobRead, ids: [map.artJobId] });
    }
  }

  /** the current style (or the preset), with the changes */
  private mergeStyle(
    current: BookStyle | undefined,
    update: BookStyleUpdate | undefined,
    preset?: BookStylePreset,
  ): BookStyle {
    const base = preset ? bookStylePresets[preset].style : resolveBookStyle(current);
    const changes = Object.fromEntries(Object.entries(update ?? {}).filter(([, value]) => value !== undefined));
    return resolveBookStyle({ ...base, ...changes });
  }

  private requireValidStyle(size: PageSize, style: BookStyle) {
    const error = validatePageStyle(size, style);
    if (error) {
      throw new BadRequestException(error);
    }
  }

  private requireLayout(id: string) {
    const layout = getLayout(id);
    if (!layout) {
      throw new BadRequestException(
        `Unknown layout "${id}". Valid layouts: ${bookLayouts.map((l) => l.id).join(', ')}`,
      );
    }
    return layout;
  }

  /** Validates a zero-based slot index against the page's layout and returns the slot's aspect ratio */
  private requireSlot(book: Book, page: { layout: string }, slot: number) {
    const layout = this.requireLayout(page.layout);
    const aspectRatios = getSlotAspectRatios(layout, book, resolveBookStyle(book.style));
    if (slot < 0 || slot >= aspectRatios.length) {
      throw new BadRequestException(
        aspectRatios.length === 0
          ? `Layout "${layout.id}" has no photo slots`
          : `Invalid slot ${slot} for layout "${layout.id}", which has ${aspectRatios.length} slot(s) (0-${aspectRatios.length - 1})`,
      );
    }
    return aspectRatios[slot];
  }

  private async getOwnerAuth(book: Book): Promise<AuthDto> {
    const owner = await this.userRepository.get(book.ownerId, {});
    if (!owner) {
      throw new Error('Book owner not found');
    }

    return {
      user: {
        id: owner.id,
        isAdmin: owner.isAdmin,
        name: owner.name,
        email: owner.email,
        quotaUsageInBytes: owner.quotaUsageInBytes,
        quotaSizeInBytes: owner.quotaSizeInBytes,
      },
    };
  }

  private async notifyOwner(
    book: Book,
    notification: { level: NotificationLevel; title: string; description: string },
  ): Promise<void> {
    try {
      const item = await this.notificationRepository.create({
        userId: book.ownerId,
        type: NotificationType.Custom,
        ...notification,
        data: JSON.stringify({ bookId: book.id }),
      });
      this.websocketRepository.clientSend('on_notification', book.ownerId, mapNotification(item));
    } catch (error: any) {
      this.logger.warn(`Unable to notify the owner of book ${book.id}: ${error?.message ?? error}`);
    }
  }
}

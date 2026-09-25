import { BadRequestException, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { JobOf } from 'src/types.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  BookCreateDto,
  BookDetailResponseDto,
  BookExportDto,
  BookLayoutResponseDto,
  BookPageCreateDto,
  BookPageMoveDto,
  BookPageResponseDto,
  BookPageUpdateDto,
  BookRenderQueryDto,
  BookResponseDto,
  BookSlotPatchDto,
  BookSlotUpdateDto,
  BookStyle,
  BookStyleUpdate,
  BookUpdateDto,
  NormalizedRect,
  mapBook,
  mapBookDetail,
  mapBookLayout,
  mapBookPage,
  resolveBookStyle,
} from 'src/dtos/book.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
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
import { BookRepository } from 'src/repositories/book.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { getDimensions } from 'src/utils/asset.util.js';
import {
  HTML_JPEG_QUALITY,
  HTML_LARGE_FILE_BYTES,
  HTML_MAX_IMAGE_PX,
  HtmlImage,
  ImageSize,
  buildBookHtml,
  getHtmlFileName,
  getRegionSize,
  isImagePageLayout,
  planHtmlImages,
} from 'src/utils/book/html.js';
import { PageSize, bookLayouts, getLayout, getSlotAspectRatios, validatePageStyle } from 'src/utils/book/layouts.js';
import { createBookPdf } from 'src/utils/book/pdf.js';
import {
  BookRenderMode,
  BookRenderWarning,
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
import { asHumanReadable } from 'src/utils/bytes.js';
import { ImmichFileResponse } from 'src/utils/file.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { findOrFail } from 'src/utils/misc.js';

type Book = NonNullable<Awaited<ReturnType<BookRepository['get']>>>;
type BookPage = Awaited<ReturnType<BookRepository['getPages']>>[number];
type RenderAsset = Awaited<ReturnType<BookRepository['getAssetsForRender']>>[number];

export type BookRenderResult = { data: Buffer; warnings: BookRenderWarning[] };

const DEFAULT_PAGE_SIZE_MM = 210;

export const getBookPdfPath = (book: { id: string; ownerId: string }) =>
  join(StorageCore.getFolderLocation(StorageFolder.Thumbnails, book.ownerId), 'books', `${book.id}.pdf`);

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

@Injectable()
export class BookService extends BaseService {
  getLayouts(): BookLayoutResponseDto[] {
    return bookLayouts.map((layout) => mapBookLayout(layout));
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
    const style = this.mergeStyle(undefined, dto.style);
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
    const style = this.mergeStyle(book.style, dto.style);
    this.requireValidStyle(size, style);

    await this.bookRepository.update(id, {
      title: dto.title,
      subtitle: dto.subtitle,
      albumId: dto.albumId,
      coverAssetId: dto.coverAssetId,
      pageWidthMm: dto.pageWidthMm,
      pageHeightMm: dto.pageHeightMm,
      style: dto.style ? style : undefined,
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
    this.requireLayout(dto.layout);

    const page = await this.bookRepository.addPage(
      id,
      {
        layout: dto.layout,
        sectionTitle: dto.sectionTitle ?? null,
        caption: dto.caption ?? null,
        background: dto.background ?? null,
      },
      dto.position,
    );

    return mapBookPage(page, book);
  }

  async updatePage(auth: AuthDto, id: string, pageId: string, dto: BookPageUpdateDto): Promise<BookPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    const current = await findOrFail(() => this.bookRepository.getPage(id, pageId), 'Page');

    let slotCount: number | undefined;
    if (dto.layout !== undefined && dto.layout !== current.layout) {
      slotCount = this.requireLayout(dto.layout).slots.length;
    }

    const page = await findOrFail(
      () =>
        this.bookRepository.updatePage(
          id,
          pageId,
          {
            layout: dto.layout,
            sectionTitle: dto.sectionTitle,
            caption: dto.caption,
            background: dto.background,
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

  async renderPage(auth: AuthDto, id: string, pageId: string, dto: BookRenderQueryDto = {}): Promise<BookRenderResult> {
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
    });
  }

  /** One image of pages `from`..`to` (one-based, inclusive) as labelled two-page spreads */
  async renderContactSheet(
    auth: AuthDto,
    id: string,
    range: { from?: number; to?: number } = {},
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
    for (const number of numbers) {
      const result = await this.renderBookPage(auth, book, pages[number - 1], number, { mode: 'thumbnail', dpi });
      rendered.push({ number, image: result.data });
      warnings.push(...result.warnings);
    }

    const spec = planContactSheet(rendered, thumb, { spreadsPerRow });
    const { data } = await this.mediaRepository.composeBookPage(spec);
    return { data, warnings, pages: numbers };
  }

  async export(auth: AuthDto, id: string, dto: Partial<BookExportDto> = {}): Promise<BookResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookDownload, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    if (book.pageCount === 0) {
      throw new BadRequestException('The book has no pages');
    }

    if (dto.format === BookExportFormat.Html) {
      if (book.htmlExportStatus !== BookExportStatus.Pending) {
        await this.bookRepository.setHtmlExportStatus(id, BookExportStatus.Pending);
        await this.jobRepository.queue({ name: JobName.BookExportHtml, data: { id } });
      }

      return mapBook({ ...book, htmlExportStatus: BookExportStatus.Pending });
    }

    if (book.exportStatus !== BookExportStatus.Pending) {
      await this.bookRepository.setExportStatus(id, BookExportStatus.Pending);
      await this.jobRepository.queue({ name: JobName.BookExport, data: { id } });
    }

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
  private async createBookHtml(auth: AuthDto, book: Book, pages: BookPage[]) {
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
    for (const [assetId, request] of planHtmlImages(book, pages, sizes)) {
      const source = sources.get(assetId)!;
      // previews are enough unless a photo is shown larger than its preview
      const previewScale = Math.min(1, image.preview.size / Math.max(source.size.width, source.size.height));
      const useFull = !source.preview || (!!source.full && request.scale > previewScale * 1.1);
      const input = (useFull ? source.full : source.preview)!;
      const scale = useFull ? request.scale : Math.min(request.scale, previewScale);

      const { width, height } = getRegionSize(request.region, source.size, scale);
      const result = await this.mediaRepository.composeBookPage({
        width,
        height,
        background: '#ffffff',
        quality: HTML_JPEG_QUALITY,
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
        dpi: getDpiForLongEdge(book, HTML_MAX_IMAGE_PX),
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
    options: { mode: BookRenderMode; dpi: number },
  ): Promise<BookRenderResult> {
    const assetIds = page.assets.map((asset) => asset.assetId);
    if (page.layout === 'cover' && book.coverAssetId) {
      assetIds.push(book.coverAssetId);
    }

    const sources = await this.getRenderSources(auth, assetIds, options.mode);
    const plan = planPage(book, page, { ...options, sources });
    const result = await this.mediaRepository.composeBookPage(plan.spec);
    return { data: result.data, warnings: getPageWarnings(plan, result, number) };
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

  private mergeStyle(current: BookStyle | undefined, update: BookStyleUpdate | undefined): BookStyle {
    return resolveBookStyle({ ...resolveBookStyle(current), ...update });
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

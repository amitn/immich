import { BadRequestException, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { JobOf } from 'src/types.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  BookCreateDto,
  BookDetailResponseDto,
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

    const files = [...new Set([getBookPdfPath(book), book.exportPath].filter((path): path is string => !!path))];
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

  async export(auth: AuthDto, id: string): Promise<BookResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookDownload, ids: [id] });
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    if (book.pageCount === 0) {
      throw new BadRequestException('The book has no pages');
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

  @OnJob({ name: JobName.BookExport, queue: QueueName.BackgroundTask })
  async handleBookExport({ id }: JobOf<JobName.BookExport>): Promise<JobStatus> {
    const book = await this.bookRepository.get(id);
    if (!book) {
      return JobStatus.Skipped;
    }

    await this.bookRepository.setExportStatus(id, BookExportStatus.Running);

    try {
      const owner = await this.userRepository.get(book.ownerId, {});
      if (!owner) {
        throw new Error('Book owner not found');
      }

      const auth: AuthDto = {
        user: {
          id: owner.id,
          isAdmin: owner.isAdmin,
          name: owner.name,
          email: owner.email,
          quotaUsageInBytes: owner.quotaUsageInBytes,
          quotaSizeInBytes: owner.quotaSizeInBytes,
        },
      };

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

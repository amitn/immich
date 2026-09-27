import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  BookStyle,
  BookStyleUpdate,
  BookUserStyleCreateDto,
  BookUserStyleResponseDto,
  BookUserStyleUpdateDto,
  mapBookUserStyle,
  resolveBookStyle,
} from 'src/dtos/book.dto.js';
import { ActivityLogAction, AssetFileType, Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { BookService } from 'src/services/book.service.js';
import { ActivityRecorder, quote, recordActivity } from 'src/utils/activity-log.js';
import { Palette, extractPalette } from 'src/utils/book/palette.js';
import {
  BookRenderWarning,
  ContactSheetPage,
  RenderPlacement,
  getDpiForLongEdge,
  planContactSheet,
} from 'src/utils/book/render.js';
import { BookStyleCheck, checkBookStyle } from 'src/utils/book/style-check.js';
import { findOrFail } from 'src/utils/misc.js';
import { requireNotSharedLink } from 'src/utils/shared-link.js';

type RenderableBook = Parameters<BookService['renderBookPage']>[1];
type RenderablePage = Parameters<BookService['renderBookPage']>[2];

/** most photos a sample book is made of, and whose colours are read */
export const MAX_STYLE_SAMPLE_PHOTOS = 6;
export const MAX_PALETTE_PHOTOS = 24;
/** the long edge of a page in a style preview */
const PREVIEW_PAGE_PX = 480;
/** the long edge photos are shrunk to before their colours are read */
const PALETTE_SAMPLE_PX = 96;

export type BookStylePreviewText = { title?: string; subtitle?: string; sectionTitle?: string; caption?: string };

export type BookStylePreviewResult = {
  /** the cover and the first spread, side by side (JPEG) */
  data: Buffer;
  /** one-based page numbers shown */
  pages: number[];
  style: Required<BookStyle>;
  check: BookStyleCheck;
  warnings: string[];
  hidden?: string[];
};

/** the render warnings that matter for a sample (print resolution does not) */
const SAMPLE_WARNINGS = new Set<BookRenderWarning['type']>(['empty-slot', 'missing-asset', 'render-error']);

const DEFAULT_SAMPLE_TEXT: Required<BookStylePreviewText> = {
  title: 'Our summer',
  subtitle: 'A sample of the style',
  sectionTitle: 'The first days',
  caption: 'Captions look like this: the place, the day and who was there',
};

/** the pages of a sample book: a cover, a chapter opener and a page of photos */
export const planSamplePages = (assetIds: string[], text: Required<BookStylePreviewText>) => {
  const [first, second = first, ...rest] = assetIds;
  const place = (ids: string[], captions = false): RenderPlacement[] =>
    ids.map((assetId, slot) => ({ slot, assetId, crop: null, caption: captions && slot === 0 ? text.caption : null }));

  const pages: RenderablePage[] = [
    { layout: 'cover', assets: place([first]) },
    { layout: 'section-opener', sectionTitle: text.sectionTitle, assets: place([second]) },
    rest.length >= 3
      ? { layout: 'hero-top-two', assets: place(rest.slice(0, 3), true) }
      : rest.length === 2
        ? { layout: 'two-vertical', assets: place(rest, true) }
        : { layout: 'single', caption: text.caption, assets: place([rest[0] ?? first]) },
  ].map((page, index) => ({
    id: `sample-${index + 1}`,
    bookId: 'sample',
    position: index,
    sectionTitle: null,
    caption: null,
    background: null,
    map: null,
    updatedAt: new Date(),
    ...page,
  })) as unknown as RenderablePage[];
  return pages;
};

/** The book styles the user designed: saving, applying (see `BookService.update`), previewing and palettes */
@Injectable()
export class BookStyleService extends BaseService {
  private bookService?: BookService;

  private get books() {
    this.bookService ??= BaseService.create(BookService, this);
    return this.bookService;
  }

  async getAll(auth: AuthDto): Promise<BookUserStyleResponseDto[]> {
    requireNotSharedLink(auth);
    const styles = await this.bookRepository.getStyles(auth.user.id);
    return styles.map((style) => mapBookUserStyle(style));
  }

  async get(auth: AuthDto, id: string): Promise<BookUserStyleResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookStyleRead, ids: [id] });
    return mapBookUserStyle(await findOrFail(() => this.bookRepository.getStyle(id), 'Book style'));
  }

  async create(
    auth: AuthDto,
    dto: BookUserStyleCreateDto,
    activity?: ActivityRecorder,
  ): Promise<BookUserStyleResponseDto> {
    requireNotSharedLink(auth);
    const style = this.requireValidStyle(dto.style);
    const row = await this.bookRepository.createStyle({
      ownerId: auth.user.id,
      name: dto.name,
      description: dto.description ?? '',
      style,
    });
    await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, auth.user.id, activity, {
      action: ActivityLogAction.BookStyleCreate,
      summary: `Saved the book style ${quote(row.name)}`,
      targetId: row.id,
      undo: { styleId: row.id, updatedAt: row.updatedAt.toISOString() },
    });
    return mapBookUserStyle(row);
  }

  async update(auth: AuthDto, id: string, dto: BookUserStyleUpdateDto): Promise<BookUserStyleResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookStyleUpdate, ids: [id] });
    const current = await findOrFail(() => this.bookRepository.getStyle(id), 'Book style');
    const style = dto.style ? this.requireValidStyle({ ...resolveBookStyle(current.style), ...dto.style }) : undefined;
    const row = await this.bookRepository.updateStyle(id, { name: dto.name, description: dto.description, style });
    return mapBookUserStyle(row);
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.BookStyleDelete, ids: [id] });
    // books that use the style keep their copy of it
    await this.bookRepository.deleteStyle(id);
  }

  /**
   * Renders a style on a sample: the cover and the first spread of a book (`bookId`), or of a sample book made of
   * the photos (`assetIds`). Nothing is saved. Private sources (e.g. travel documents) are blurred.
   */
  async preview(
    auth: AuthDto,
    input: Partial<BookStyle>,
    source: { bookId?: string; assetIds?: string[]; text?: BookStylePreviewText },
  ): Promise<BookStylePreviewResult> {
    requireNotSharedLink(auth);
    const style = resolveBookStyle(stripUndefined(input));
    let book: RenderableBook;
    let pages: RenderablePage[];

    if (source.bookId) {
      await this.requireAccess({ auth, permission: Permission.BookRead, ids: [source.bookId] });
      const current = await findOrFail(() => this.bookRepository.get(source.bookId!), 'Book');
      const bookPages = await this.bookRepository.getPages(source.bookId);
      pages = bookPages.slice(0, 3);
      if (pages.length === 0) {
        throw new BadRequestException('The book has no pages yet: pass assetIds to preview the style on photos');
      }
      book = { ...current, style };
    } else {
      const assetIds = [...new Set(source.assetIds)].slice(0, MAX_STYLE_SAMPLE_PHOTOS);
      if (assetIds.length === 0) {
        throw new BadRequestException('Pass a bookId or some assetIds to preview the style on');
      }
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: assetIds });
      const text = { ...DEFAULT_SAMPLE_TEXT, ...stripUndefined(source.text ?? {}) };
      book = {
        id: 'sample',
        ownerId: auth.user.id,
        albumId: null,
        coverAssetId: null,
        title: text.title,
        subtitle: text.subtitle,
        pageWidthMm: 210,
        pageHeightMm: 210,
        style,
      } as unknown as RenderableBook;
      pages = planSamplePages(assetIds, text);
    }

    const check = checkBookStyle(style, book);
    if (check.errors.length > 0) {
      throw new BadRequestException(check.errors.join('; '));
    }

    const aspect = book.pageWidthMm / book.pageHeightMm;
    const thumb =
      aspect >= 1
        ? { width: PREVIEW_PAGE_PX, height: Math.round(PREVIEW_PAGE_PX / aspect) }
        : { width: Math.round(PREVIEW_PAGE_PX * aspect), height: PREVIEW_PAGE_PX };
    const dpi = getDpiForLongEdge(book, PREVIEW_PAGE_PX);

    const rendered: ContactSheetPage[] = [];
    const warnings: string[] = [];
    const hidden = new Set<string>();
    for (const [index, page] of pages.entries()) {
      const result = await this.books.renderBookPage(auth, book, page, index + 1, {
        mode: 'review',
        dpi,
        pages,
        hidePrivate: true,
      });
      rendered.push({ number: index + 1, image: result.data });
      warnings.push(
        ...result.warnings.filter((warning) => SAMPLE_WARNINGS.has(warning.type)).map(({ message }) => message),
      );
      for (const id of result.hidden ?? []) {
        hidden.add(id);
      }
    }

    const spec = planContactSheet(rendered, thumb, { spreadsPerRow: 2 });
    const { data } = await this.mediaRepository.composeBookPage(spec);
    return {
      data,
      pages: rendered.map(({ number }) => number),
      style,
      check,
      warnings,
      ...(hidden.size > 0 && { hidden: [...hidden] }),
    };
  }

  /** the main and accent colours of photos, and a readable book style drawn from them */
  async getPalette(auth: AuthDto, assetIds: string[]): Promise<Palette & { assetIds: string[] }> {
    requireNotSharedLink(auth);
    const ids = [...new Set(assetIds)].slice(0, MAX_PALETTE_PHOTOS);
    if (ids.length === 0) {
      throw new BadRequestException('Pass the photos to take the colours from');
    }
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids });

    const images = [];
    const used: string[] = [];
    for (const asset of await this.bookRepository.getAssetsForRender(ids)) {
      const find = (type: AssetFileType) => asset.files.find((file) => file.type === type)?.path;
      const input = find(AssetFileType.Thumbnail) ?? find(AssetFileType.Preview);
      if (!input) {
        continue;
      }
      const { data, info } = await this.mediaRepository.getSmallRgb(input, PALETTE_SAMPLE_PX);
      images.push({ data, channels: info.channels });
      used.push(asset.id);
    }
    if (images.length === 0) {
      throw new BadRequestException('None of the photos has a thumbnail yet');
    }

    return { ...extractPalette(images), assetIds: used };
  }

  /** the style over the classic preset, checked strictly (see `checkBookStyle`) */
  requireValidStyle(input: BookStyleUpdate): Required<BookStyle> {
    const style = resolveBookStyle(stripUndefined(input));
    const { errors } = checkBookStyle(style);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }
    return style;
  }
}

const stripUndefined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

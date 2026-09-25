import type {
  BookExportFormat,
  BookExportStatus,
  BookMapStyle,
  BookMapStyleOption,
  BookPageDto,
  BookResponseDto,
} from '$lib/types/assistant';

// ---------------------------------------------------------------------------------------------
// Page sizes
// ---------------------------------------------------------------------------------------------

export type BookPageSizePresetId = 'square-21' | 'a4-portrait' | 'a4-landscape' | 'square-30';

export type BookPageSizePreset = {
  id: BookPageSizePresetId;
  /** i18n key of the label */
  labelKey: string;
  widthMm: number;
  heightMm: number;
};

export const BOOK_PAGE_SIZE_PRESETS: BookPageSizePreset[] = [
  { id: 'square-21', labelKey: 'book_page_size_square_21', widthMm: 210, heightMm: 210 },
  { id: 'a4-portrait', labelKey: 'book_page_size_a4_portrait', widthMm: 210, heightMm: 297 },
  { id: 'a4-landscape', labelKey: 'book_page_size_a4_landscape', widthMm: 297, heightMm: 210 },
  { id: 'square-30', labelKey: 'book_page_size_square_30', widthMm: 300, heightMm: 300 },
];

export const DEFAULT_BOOK_PAGE_SIZE: BookPageSizePresetId = 'square-21';

export const getBookPageSizePreset = (id: BookPageSizePresetId) =>
  BOOK_PAGE_SIZE_PRESETS.find((preset) => preset.id === id) ??
  BOOK_PAGE_SIZE_PRESETS.find((preset) => preset.id === DEFAULT_BOOK_PAGE_SIZE)!;

/** The preset matching a book's page size, if any (within half a millimetre) */
export const findBookPageSizePreset = ({ pageWidthMm, pageHeightMm }: { pageWidthMm: number; pageHeightMm: number }) =>
  BOOK_PAGE_SIZE_PRESETS.find(
    ({ widthMm, heightMm }) => Math.abs(widthMm - pageWidthMm) < 0.5 && Math.abs(heightMm - pageHeightMm) < 0.5,
  );

// ---------------------------------------------------------------------------------------------
// Page count
// ---------------------------------------------------------------------------------------------

export const BOOK_MIN_PAGES = 2;
export const BOOK_MAX_PAGES = 200;
/** On average; the automatic layout mixes full-page photos with grids */
const PHOTOS_PER_PAGE = 3;

/**
 * A sensible page count for a book of `assetCount` photos: about three photos per page plus a
 * cover, rounded up to an even number (printed books have facing pages), within the page limits.
 */
export const getDefaultBookPageCount = (assetCount: number) => {
  if (!Number.isFinite(assetCount) || assetCount <= 0) {
    return BOOK_MIN_PAGES;
  }
  const pages = Math.ceil(assetCount / PHOTOS_PER_PAGE) + 1;
  const even = pages + (pages % 2);
  return Math.min(BOOK_MAX_PAGES, Math.max(BOOK_MIN_PAGES, even));
};

/** `undefined` for an empty or invalid value, so the server picks the page count */
export const normalizeBookPageCount = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return;
  }
  return Math.min(BOOK_MAX_PAGES, Math.max(1, Math.round(value)));
};

// ---------------------------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------------------------

export const BOOK_MAP_STYLES: BookMapStyle[] = ['sketch', 'watercolor', 'toner', 'terrain'];
export const BOOK_MAP_STYLE_OPTIONS: BookMapStyleOption[] = ['auto', ...BOOK_MAP_STYLES];
export const BOOK_MAP_LAYOUTS = ['map', 'map-photo'];

/** Tile styles are rendered from Stadia Maps and need an API key in the admin settings */
export const isTileMapStyle = (style: BookMapStyleOption) => style !== 'auto' && style !== 'sketch';

export const isMapPage = (page: Pick<BookPageDto, 'layout'> & { map?: BookPageDto['map'] }) =>
  !!page.map || BOOK_MAP_LAYOUTS.includes(page.layout);

// ---------------------------------------------------------------------------------------------
// Export status
// ---------------------------------------------------------------------------------------------

export type BookExportChoice = BookExportFormat | 'both';

export const toExportFormats = (choice: BookExportChoice): BookExportFormat[] =>
  choice === 'both' ? ['pdf', 'html'] : [choice];

type BookExportFields = Pick<BookResponseDto, 'exportStatus'> & {
  htmlExportStatus?: BookResponseDto['htmlExportStatus'];
};

/** `exportStatus` is the PDF status; servers without HTML export omit `htmlExportStatus` */
export const getBookExportStatus = (book: BookExportFields, format: BookExportFormat): BookExportStatus | null =>
  (format === 'html' ? book.htmlExportStatus : book.exportStatus) ?? null;

export const isExportActive = (status: BookExportStatus | null | undefined) =>
  status === 'pending' || status === 'running';

export const isBookExporting = (book: BookExportFields, formats: BookExportFormat[] = ['pdf', 'html']) =>
  formats.some((format) => isExportActive(getBookExportStatus(book, format)));

/** Combined status of several exports: active while any runs, then failed if any failed */
export const getCombinedExportStatus = (
  book: BookExportFields,
  formats: BookExportFormat[],
): BookExportStatus | null => {
  const statuses = formats.map((format) => getBookExportStatus(book, format));
  if (statuses.length === 0 || statuses.every((status) => status === null)) {
    return null;
  }
  if (statuses.includes('running')) {
    return 'running';
  }
  if (statuses.includes('pending')) {
    return 'pending';
  }
  if (statuses.includes('failed')) {
    return 'failed';
  }
  return statuses.every((status) => status === 'completed') ? 'completed' : null;
};

/** The formats whose export has completed, in a stable order */
export const getCompletedExports = (book: BookExportFields): BookExportFormat[] =>
  (['pdf', 'html'] as const).filter((format) => getBookExportStatus(book, format) === 'completed');

export const getBookFileName = ({ title }: { title: string }, format: BookExportFormat) => {
  const name =
    title
      // eslint-disable-next-line no-control-regex
      .replaceAll(/[\u0000-\u001F<>:"/\\|?*]+/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim() || 'photo-book';
  return `${name}.${format}`;
};

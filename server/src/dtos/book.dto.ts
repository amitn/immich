import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import type { BookPageTable } from 'src/schema/tables/book-page.table.js';
import type { BookTable } from 'src/schema/tables/book.table.js';
import { BookExportFormat, BookExportFormatSchema, BookExportStatusSchema } from 'src/enum.js';
import { BookLayout, PageSize, getLayout, getSlotAspectRatios } from 'src/utils/book/layouts.js';
import { bookMapStyles } from 'src/utils/book/map-styles.js';
import { isoDatetimeToDate } from 'src/validation.js';

export const NormalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1).describe('Left edge, as a fraction of the image width').meta({ format: 'double' }),
    y: z.number().min(0).max(1).describe('Top edge, as a fraction of the image height').meta({ format: 'double' }),
    width: z.number().gt(0).max(1).describe('Width, as a fraction of the image width').meta({ format: 'double' }),
    height: z.number().gt(0).max(1).describe('Height, as a fraction of the image height').meta({ format: 'double' }),
  })
  .refine((rect) => rect.x + rect.width <= 1.0001 && rect.y + rect.height <= 1.0001, {
    error: 'Rectangle must be inside the image',
  })
  .describe('Rectangle normalized to the 0..1 range of the source image')
  .meta({ id: 'NormalizedRect' });

export type NormalizedRect = z.infer<typeof NormalizedRectSchema>;

const cssColor = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, { error: 'Must be a hex color such as #ffffff' });

const fontFamily = z
  .string()
  .max(100)
  .regex(/^[\w\s,'-]+$/, { error: 'Font family contains invalid characters' });

export const BookStyleSchema = z
  .object({
    marginMm: z.number().min(0).max(50).describe('Outer page margin in millimeters').meta({ format: 'double' }),
    gutterMm: z.number().min(0).max(30).describe('Space between photos in millimeters').meta({ format: 'double' }),
    background: cssColor.describe('Page background color (hex)'),
    textColor: cssColor.describe('Caption and title color (hex)'),
    fontFamily: fontFamily.describe('Font family used for captions and titles'),
    titleSizePt: z.number().min(6).max(144).optional().describe('Title font size in points').meta({ format: 'double' }),
    captionSizePt: z
      .number()
      .min(4)
      .max(72)
      .optional()
      .describe('Caption font size in points')
      .meta({ format: 'double' }),
  })
  .describe('Visual style of a book')
  .meta({ id: 'BookStyle' });

export type BookStyle = z.infer<typeof BookStyleSchema>;

export const defaultBookStyle: Required<BookStyle> = Object.freeze({
  marginMm: 12,
  gutterMm: 4,
  background: '#ffffff',
  textColor: '#222222',
  fontFamily: 'serif',
  titleSizePt: 28,
  captionSizePt: 10,
});

export const resolveBookStyle = (style?: Partial<BookStyle> | null): Required<BookStyle> => ({
  ...defaultBookStyle,
  ...Object.fromEntries(Object.entries(style ?? {}).filter(([, value]) => value !== undefined && value !== null)),
});

export const bookStylePresetIds = ['classic', 'soft', 'bold'] as const;

export type BookStylePreset = (typeof bookStylePresetIds)[number];

export const BookStylePresetSchema = z
  .enum(bookStylePresetIds)
  .describe(
    'Style preset: classic (white, 12 mm margins, serif), soft (warm cream, muted brown text, 18 mm margins, ' +
      'serif) or bold (small margins, tight gutters, sans-serif; suits full-bleed photos). The style options ' +
      'override its values',
  )
  .meta({ id: 'BookStylePreset' });

export const bookStylePresets: Record<
  BookStylePreset,
  { name: string; description: string; style: Required<BookStyle> }
> = {
  classic: {
    name: 'Classic',
    description: 'White pages, 12 mm margins and a serif font',
    style: { ...defaultBookStyle },
  },
  soft: {
    name: 'Soft',
    description: 'Warm cream pages, muted brown text, generous 18 mm margins and a serif font',
    style: {
      marginMm: 18,
      gutterMm: 5,
      background: '#f6f1e7',
      textColor: '#5b4636',
      fontFamily: 'serif',
      titleSizePt: 28,
      captionSizePt: 10,
    },
  },
  bold: {
    name: 'Bold',
    description: 'Small 6 mm margins, tight 2.5 mm gutters and a sans-serif font; made for full-bleed photos',
    style: {
      marginMm: 6,
      gutterMm: 2.5,
      background: '#ffffff',
      textColor: '#111111',
      fontFamily: 'sans-serif',
      titleSizePt: 32,
      captionSizePt: 9,
    },
  },
};

export const BookStyleUpdateSchema = BookStyleSchema.partial()
  .describe('Style changes; omitted properties keep their current value')
  .meta({ id: 'BookStyleUpdate' });

export type BookStyleUpdate = z.infer<typeof BookStyleUpdateSchema>;

export const BookMapStyleSchema = z
  .enum(bookMapStyles)
  .describe('Map style; watercolor, toner and terrain use Stadia Maps tiles and fall back to sketch without an API key')
  .meta({ id: 'BookMapStyle' });

export const BookMapStyleOptionSchema = z
  .enum(['auto', ...bookMapStyles])
  .describe('Map style; auto uses the default style from the server config')
  .meta({ id: 'BookMapStyleOption' });

export const BookMapSchema = z
  .object({
    style: BookMapStyleSchema,
    title: z.string().trim().max(200).optional().describe('Title drawn on the map'),
    assetIds: z
      .array(z.uuidv4())
      .max(2000)
      .optional()
      .describe('Photos whose locations are plotted; defaults to the photos of the section that follows the map'),
    showRoute: z.boolean().describe('Connect the locations in time order'),
    labels: z.boolean().describe('Label the places'),
    artJobId: z.uuidv4().optional().describe('Art job that redraws the map as an illustration'),
    illustratedAssetId: z.uuidv4().optional().describe('Illustrated map drawn instead of the rendered map'),
  })
  .describe('A map drawn in the map area of the page layout')
  .meta({ id: 'BookMapDto' });

export type BookMap = z.infer<typeof BookMapSchema>;

const pageSizeMm = z.int().min(50).max(600);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const BookCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).describe('Book title'),
    subtitle: optionalText(200).describe('Book subtitle'),
    albumId: z.uuidv4().nullable().optional().describe('Album the book is made from'),
    pageWidthMm: pageSizeMm.optional().describe('Page width in millimeters (default 210)'),
    pageHeightMm: pageSizeMm.optional().describe('Page height in millimeters (default 210)'),
    stylePreset: BookStylePresetSchema.optional(),
    style: BookStyleUpdateSchema.optional(),
  })
  .meta({ id: 'BookCreateDto' });

const BookUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional().describe('Book title'),
    subtitle: optionalText(200).describe('Book subtitle'),
    albumId: z.uuidv4().nullable().optional().describe('Album the book is made from'),
    coverAssetId: z.uuidv4().nullable().optional().describe('Asset shown on the cover when its slot is empty'),
    pageWidthMm: pageSizeMm.optional().describe('Page width in millimeters'),
    pageHeightMm: pageSizeMm.optional().describe('Page height in millimeters'),
    stylePreset: BookStylePresetSchema.optional().describe(
      'Replace the style with a preset (see GET /books/style-presets); style overrides its values',
    ),
    style: BookStyleUpdateSchema.optional(),
  })
  .meta({ id: 'BookUpdateDto' });

const BookPageCreateSchema = z
  .object({
    layout: z.string().describe('Layout ID (see GET /books/layouts)'),
    position: z.int().min(0).optional().describe('Zero-based position to insert the page at; appended when omitted'),
    sectionTitle: optionalText(200).describe('Section title'),
    caption: optionalText(2000).describe('Page caption'),
    background: cssColor.nullable().optional().describe('Page background color, overriding the book style'),
    map: BookMapSchema.nullable().optional(),
  })
  .meta({ id: 'BookPageCreateDto' });

const BookPageUpdateSchema = z
  .object({
    layout: z.string().optional().describe('Layout ID; photos in slots the new layout lacks are removed'),
    sectionTitle: optionalText(200).describe('Section title'),
    caption: optionalText(2000).describe('Page caption'),
    background: cssColor.nullable().optional().describe('Page background color, overriding the book style'),
    map: BookMapSchema.nullable().optional(),
  })
  .meta({ id: 'BookPageUpdateDto' });

const targetPageCount = z
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe('Approximate number of pages (default: about one page per 2.5 photos, 4 to 80 pages)');
const includeMaps = z
  .boolean()
  .optional()
  .describe('Open the sections that have GPS locations with a map page (default true)');
const illustratedMaps = z
  .boolean()
  .optional()
  .describe('Also redraw every map as an illustration with the art agent (default false)');

export const bookCaptionModes = ['none', 'place', 'place-time', 'people'] as const;

export const BookCaptionModeSchema = z
  .enum(bookCaptionModes)
  .describe(
    'Captions drafted from facts only: none, place (the place when it changes), place-time (place and local time) ' +
      'or people (place and the names of the people); default place',
  )
  .meta({ id: 'BookCaptionMode' });

const layoutTuning = {
  captions: BookCaptionModeSchema.optional(),
  maxArtworkShare: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Most pages with artwork, as a share of the pages (default 0.2); artwork is never on two pages in a row')
    .meta({ format: 'double' }),
  maxStackPairs: z
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe('Artworks shown next to their original on the same page (default 2)'),
  considerImprovements: z
    .boolean()
    .optional()
    .describe(
      'Pick the photos on what they can become after the fixes the app can make (straightening, auto-enhance), ' +
        'simulated on their previews (default true)',
    ),
  improvePhotos: z
    .boolean()
    .optional()
    .describe(
      'Create improved copies (straightened, auto-enhanced) of the placed photos that a fix measurably helps, ' +
        'stacked with the originals, and place the copies instead (default false)',
    ),
};

const BookFromAlbumSchema = z
  .object({
    albumId: z.uuidv4().describe('Album whose photos are laid out'),
    title: z.string().trim().min(1).max(200).optional().describe('Book title (default: the album name)'),
    subtitle: optionalText(200).describe('Book subtitle'),
    pageWidthMm: pageSizeMm.optional().describe('Page width in millimeters (default 210)'),
    pageHeightMm: pageSizeMm.optional().describe('Page height in millimeters (default 210)'),
    stylePreset: BookStylePresetSchema.optional(),
    style: BookStyleUpdateSchema.optional(),
    targetPageCount,
    includeMaps,
    mapStyle: BookMapStyleOptionSchema.optional(),
    illustratedMaps,
    ...layoutTuning,
  })
  .meta({ id: 'BookFromAlbumDto' });

const BookAutoLayoutSchema = z
  .object({
    assetIds: z
      .array(z.uuidv4())
      .min(1)
      .max(2000)
      .optional()
      .describe("Photos to lay out (default: the photos of the book's album)"),
    targetPageCount,
    includeMaps,
    mapStyle: BookMapStyleOptionSchema.optional(),
    illustratedMaps,
    heroAssetIds: z.array(z.uuidv4()).max(100).optional().describe('Photos that get a page of their own'),
    keepExisting: z
      .boolean()
      .optional()
      .describe('Append the new pages to the existing ones instead of replacing them (default false)'),
    ...layoutTuning,
  })
  .meta({ id: 'BookAutoLayoutDto' });

const BookPageMoveSchema = z
  .object({
    position: z.int().min(0).describe('New zero-based position of the page'),
  })
  .meta({ id: 'BookPageMoveDto' });

const BookSlotUpdateSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset to place in the slot'),
    crop: NormalizedRectSchema.nullable()
      .optional()
      .describe('Crop of the asset; a default crop matching the slot is chosen when omitted'),
    caption: optionalText(500).describe('Photo caption'),
  })
  .meta({ id: 'BookSlotUpdateDto' });

const BookPageParamSchema = z.object({
  id: z.uuidv4(),
  pageId: z.uuidv4(),
});

const BookSlotPatchSchema = z
  .object({
    crop: NormalizedRectSchema.nullable().optional().describe('Crop of the placed asset'),
    caption: optionalText(500).describe('Photo caption'),
  })
  .meta({ id: 'BookSlotPatchDto' });

const BookSlotParamSchema = BookPageParamSchema.extend({
  slot: z.coerce.number().int().min(0).max(99),
});

const BookRenderQuerySchema = z
  .object({
    size: z.coerce
      .number()
      .int()
      .min(100)
      .max(4000)
      .optional()
      .describe('Length of the long edge of the rendered page in pixels (default 1200)'),
  })
  .meta({ id: 'BookRenderQueryDto' });

const BookExportSchema = z
  .object({
    format: BookExportFormatSchema.optional().default(BookExportFormat.Pdf).describe('Export format (default pdf)'),
  })
  .meta({ id: 'BookExportDto' });

const BookSlotResponseSchema = z
  .object({
    slot: z.int().min(0).describe('Zero-based slot index'),
    aspectRatio: z.number().describe('Width / height of the slot on the page').meta({ format: 'double' }),
    assetId: z.uuidv4().nullable().describe('Placed asset, null when the slot is empty'),
    crop: NormalizedRectSchema.nullable().describe('Crop of the placed asset'),
    caption: z.string().nullable().describe('Photo caption'),
  })
  .meta({ id: 'BookSlotResponseDto' });

const BookPageResponseSchema = z
  .object({
    id: z.uuidv4().describe('Page ID'),
    position: z.int().min(0).describe('Zero-based position of the page in the book'),
    layout: z.string().describe('Layout ID'),
    sectionTitle: z.string().nullable().describe('Section title'),
    caption: z.string().nullable().describe('Page caption'),
    background: z.string().nullable().describe('Page background color override'),
    map: BookMapSchema.nullable(),
    slots: z.array(BookSlotResponseSchema).describe('Photo slots of the layout'),
    updatedAt: isoDatetimeToDate.describe('Last update date'),
  })
  .meta({ id: 'BookPageResponseDto' });

const BookResponseSchema = z
  .object({
    id: z.uuidv4().describe('Book ID'),
    ownerId: z.uuidv4().describe('Owner user ID'),
    albumId: z.uuidv4().nullable().describe('Album the book is made from'),
    coverAssetId: z.uuidv4().nullable().describe('Cover asset ID'),
    title: z.string().describe('Book title'),
    subtitle: z.string().nullable().describe('Book subtitle'),
    pageWidthMm: z.int().describe('Page width in millimeters'),
    pageHeightMm: z.int().describe('Page height in millimeters'),
    style: BookStyleSchema,
    exportStatus: BookExportStatusSchema.nullable().describe('Status of the PDF export'),
    htmlExportStatus: BookExportStatusSchema.nullable().describe('Status of the single-file HTML export'),
    exportedAt: isoDatetimeToDate.nullable().describe('When the PDF export last completed'),
    htmlExportedAt: isoDatetimeToDate.nullable().describe('When the HTML export last completed'),
    exportStale: z.boolean().describe('Whether the book changed after the PDF was exported'),
    htmlExportStale: z.boolean().describe('Whether the book changed after the HTML file was exported'),
    pageCount: z.int().min(0).describe('Number of pages'),
    firstPageId: z.uuidv4().nullable().describe('ID of the first page, e.g. to show the cover'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    updatedAt: isoDatetimeToDate.describe('Last update date'),
  })
  .meta({ id: 'BookResponseDto' });

const BookDetailResponseSchema = BookResponseSchema.extend({
  pages: z.array(BookPageResponseSchema).describe('Pages in book order'),
}).meta({ id: 'BookDetailResponseDto' });

const BookAutoLayoutResponseSchema = BookDetailResponseSchema.extend({
  warnings: z
    .array(z.string())
    .describe('Problems met while laying out the book, e.g. a map style that is not available'),
}).meta({ id: 'BookAutoLayoutResponseDto' });

export const bookReviewSeverities = ['high', 'medium', 'low'] as const;

export const bookReviewIssueTypes = [
  'duplicate-stack',
  'low-dpi',
  'empty-slot',
  'too-much-artwork',
  'artwork-back-to-back',
  'singles-in-a-row',
  'similar-neighbours',
  'map-style-fallback',
  'person-underrepresented',
  'too-many-pairs',
  'repeated-layout',
  'missing-captions',
  'could-look-better',
] as const;

const BookReviewIssueSchema = z
  .object({
    severity: z.enum(bookReviewSeverities).describe('How much the issue hurts the book'),
    type: z.enum(bookReviewIssueTypes).describe('Kind of issue'),
    message: z.string().describe('What is wrong and how to fix it'),
    pages: z.array(z.int().min(1)).describe('One-based page numbers'),
    slot: z.int().min(1).optional().describe('One-based slot number'),
    assetIds: z.array(z.uuidv4()).optional().describe('Photos involved, or photos to use instead'),
    dpi: z.int().optional().describe('Print resolution of the placement'),
  })
  .meta({ id: 'BookReviewIssueDto' });

const BookReviewSuggestionSchema = z
  .object({
    assetId: z.uuidv4().describe('Photo ID'),
    score: z.number().describe('Quality score, 0..1').meta({ format: 'double' }),
    people: z.array(z.string()).optional().describe('Named people in the photo'),
    city: z.string().optional().describe('Place of the photo'),
  })
  .meta({ id: 'BookReviewSuggestionDto' });

const BookReviewPlacementSchema = z
  .object({
    assetId: z.uuidv4().describe('Photo ID'),
    score: z.number().describe('Quality score, 0..1').meta({ format: 'double' }),
    page: z.int().min(1).describe('One-based page number'),
    slot: z.int().min(1).describe('One-based slot number'),
  })
  .meta({ id: 'BookReviewPlacementDto' });

const BookReviewResponseSchema = z
  .object({
    pageCount: z.int().min(0).describe('Number of pages'),
    counts: z
      .object({ high: z.int().min(0), medium: z.int().min(0), low: z.int().min(0) })
      .describe('Number of issues per severity'),
    issues: z.array(BookReviewIssueSchema).describe('Issues, most severe first'),
    unusedPhotos: z
      .array(BookReviewSuggestionSchema)
      .describe('The best photos of the album that are not in the book, photos of the main people first'),
    weakestPlaced: z.array(BookReviewPlacementSchema).describe('The lowest scoring photos in the book'),
    people: z
      .array(
        z.object({
          personId: z.uuidv4().describe('Person ID'),
          name: z.string().optional().describe('Person name'),
          photos: z.int().min(0).describe('Photos of the person in the album'),
          placed: z.int().min(0).describe('Photos of the person in the book'),
        }),
      )
      .describe('The people who appear most often in the album'),
  })
  .meta({ id: 'BookReviewResponseDto' });

const BookStylePresetResponseSchema = z
  .object({
    id: BookStylePresetSchema,
    name: z.string().describe('Preset name'),
    description: z.string().describe('Preset description'),
    style: BookStyleSchema,
  })
  .meta({ id: 'BookStylePresetResponseDto' });

const LayoutRectSchema = z
  .object({
    x: z.number().describe('Left edge, as a fraction of the layout area').meta({ format: 'double' }),
    y: z.number().describe('Top edge, as a fraction of the layout area').meta({ format: 'double' }),
    width: z.number().describe('Width, as a fraction of the layout area').meta({ format: 'double' }),
    height: z.number().describe('Height, as a fraction of the layout area').meta({ format: 'double' }),
  })
  .meta({ id: 'BookLayoutRect' });

const BookLayoutResponseSchema = z
  .object({
    id: z.string().describe('Layout ID'),
    name: z.string().describe('Layout name'),
    description: z.string().describe('Layout description'),
    orientation: z.enum(['any', 'landscape', 'portrait']).describe('Preferred photo orientation'),
    fullBleed: z.boolean().describe('Whether the layout ignores the page margins'),
    slots: z.array(LayoutRectSchema).describe('Photo slots, relative to the area inside the margins'),
    textAreas: z
      .array(
        LayoutRectSchema.extend({
          kind: z.enum(['title', 'subtitle', 'sectionTitle', 'caption']).describe('Text shown in the area'),
        }),
      )
      .describe('Text areas, relative to the area inside the margins'),
    mapArea: LayoutRectSchema.optional().describe('Area of the page map, relative to the area inside the margins'),
  })
  .meta({ id: 'BookLayoutResponseDto' });

export class BookCreateDto extends createZodDto(BookCreateSchema) {}
export class BookUpdateDto extends createZodDto(BookUpdateSchema) {}
export class BookPageCreateDto extends createZodDto(BookPageCreateSchema) {}
export class BookPageUpdateDto extends createZodDto(BookPageUpdateSchema) {}
export class BookPageMoveDto extends createZodDto(BookPageMoveSchema) {}
export class BookFromAlbumDto extends createZodDto(BookFromAlbumSchema) {}
export class BookAutoLayoutDto extends createZodDto(BookAutoLayoutSchema) {}
export class BookSlotUpdateDto extends createZodDto(BookSlotUpdateSchema) {}
export class BookPageParamDto extends createZodDto(BookPageParamSchema) {}
export class BookSlotPatchDto extends createZodDto(BookSlotPatchSchema) {}
export class BookSlotParamDto extends createZodDto(BookSlotParamSchema) {}
export class BookRenderQueryDto extends createZodDto(BookRenderQuerySchema) {}
export class BookExportDto extends createZodDto(BookExportSchema) {}
export class BookSlotResponseDto extends createZodDto(BookSlotResponseSchema) {}
export class BookPageResponseDto extends createZodDto(BookPageResponseSchema) {}
export class BookResponseDto extends createZodDto(BookResponseSchema) {}
export class BookDetailResponseDto extends createZodDto(BookDetailResponseSchema) {}
export class BookAutoLayoutResponseDto extends createZodDto(BookAutoLayoutResponseSchema) {}
export class BookStylePresetResponseDto extends createZodDto(BookStylePresetResponseSchema) {}
export class BookReviewResponseDto extends createZodDto(BookReviewResponseSchema) {}
export class BookLayoutResponseDto extends createZodDto(BookLayoutResponseSchema) {}

type BookRow = Selectable<BookTable> & { pageCount: number; firstPageId: string | null };

type BookPageRow = Selectable<BookPageTable> & {
  assets: { slot: number; assetId: string; crop: NormalizedRect | null; caption: string | null }[];
};

const isStale = (exportedAt: Date | null, contentUpdatedAt: Date) => !!exportedAt && exportedAt < contentUpdatedAt;

export const mapBook = (book: BookRow): BookResponseDto => ({
  id: book.id,
  ownerId: book.ownerId,
  albumId: book.albumId,
  coverAssetId: book.coverAssetId,
  title: book.title,
  subtitle: book.subtitle,
  pageWidthMm: book.pageWidthMm,
  pageHeightMm: book.pageHeightMm,
  style: resolveBookStyle(book.style),
  exportStatus: book.exportStatus,
  htmlExportStatus: book.htmlExportStatus,
  exportedAt: book.exportedAt,
  htmlExportedAt: book.htmlExportedAt,
  exportStale: isStale(book.exportedAt, book.contentUpdatedAt),
  htmlExportStale: isStale(book.htmlExportedAt, book.contentUpdatedAt),
  pageCount: book.pageCount,
  firstPageId: book.firstPageId,
  createdAt: book.createdAt,
  updatedAt: book.updatedAt,
});

export const mapBookPage = (page: BookPageRow, book: PageSize & { style: BookStyle }): BookPageResponseDto => {
  const layout = getLayout(page.layout);
  const aspectRatios = layout ? getSlotAspectRatios(layout, book, resolveBookStyle(book.style)) : [];
  const placements = new Map(page.assets.map((asset) => [asset.slot, asset]));

  return {
    id: page.id,
    position: page.position,
    layout: page.layout,
    sectionTitle: page.sectionTitle,
    caption: page.caption,
    background: page.background,
    map: page.map ?? null,
    slots: aspectRatios.map((aspectRatio, slot) => {
      const placement = placements.get(slot);
      return {
        slot,
        aspectRatio: Math.round(aspectRatio * 1000) / 1000,
        assetId: placement?.assetId ?? null,
        crop: placement?.crop ?? null,
        caption: placement?.caption ?? null,
      };
    }),
    updatedAt: page.updatedAt,
  };
};

export const mapBookDetail = (book: BookRow, pages: BookPageRow[]): BookDetailResponseDto => ({
  ...mapBook({ ...book, pageCount: pages.length, firstPageId: pages[0]?.id ?? null }),
  pages: pages.map((page) => mapBookPage(page, book)),
});

export const mapBookLayout = (layout: BookLayout): BookLayoutResponseDto => ({
  id: layout.id,
  name: layout.name,
  description: layout.description,
  orientation: layout.orientation,
  fullBleed: !!layout.fullBleed,
  slots: layout.slots.map(({ x, y, width, height }) => ({ x, y, width, height })),
  textAreas: layout.text.map(({ kind, x, y, width, height }) => ({ kind, x, y, width, height })),
  ...(layout.map && {
    mapArea: { x: layout.map.x, y: layout.map.y, width: layout.map.width, height: layout.map.height },
  }),
});

export const mapBookStylePreset = (id: BookStylePreset): BookStylePresetResponseDto => ({
  id,
  ...bookStylePresets[id],
  style: { ...bookStylePresets[id].style },
});

import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import {
  BookCaptionModeSchema,
  BookDetailResponseDto,
  BookMap,
  BookMapStyleOptionSchema,
  BookPageResponseDto,
  BookStylePresetSchema,
  BookStyleUpdateSchema,
  NormalizedRectSchema,
  bookStylePresetIds,
  bookStylePresets,
  defaultBookStyle,
} from 'src/dtos/book.dto.js';
import { BookExportFormat, Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { BookAutoLayoutResult, BookService } from 'src/services/book.service.js';
import { PRIVATE_SOURCE_BLURRED } from 'src/services/collection.service.js';
import { isArtEnabled } from 'src/utils/agent/config.js';
import {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  defineTool,
  toolError,
  toolImage,
  toolJson,
} from 'src/utils/agent/tools.js';
import { bookLayouts, getLayout, getSlotAspectRatios } from 'src/utils/book/layouts.js';
import { BookMapStyleOption, resolveMapStyle } from 'src/utils/book/map-styles.js';
import { BookRenderWarning } from 'src/utils/book/render.js';

/**
 * Books the agent may edit without asking, per assistant session: the ones it created, and the ones the user
 * approved through `edit_existing_book`.
 */
const editableBooks = new Map<string, Set<string>>();
const MAX_TRACKED_SESSIONS = 500;

const sessionKey = (ctx: AgentToolContext) => ctx.sessionId ?? `user:${ctx.auth.user.id}`;

const markEditable = (ctx: AgentToolContext, bookId: string) => {
  const key = sessionKey(ctx);
  const books = editableBooks.get(key) ?? new Set<string>();
  books.add(bookId);
  editableBooks.delete(key);
  editableBooks.set(key, books);
  if (editableBooks.size > MAX_TRACKED_SESSIONS) {
    editableBooks.delete(editableBooks.keys().next().value!);
  }
};

const isEditable = (ctx: AgentToolContext, bookId: string) => editableBooks.get(sessionKey(ctx))?.has(bookId) ?? false;

class ToolInputError extends Error {}

const WORKFLOW =
  'Workflow: start with auto_layout_book (from an album, or a book plus assetIds): it makes the cover, one chapter ' +
  'per event or stop opened by a map (with GPS) or a section title, and sizes the photos by importance while fitting ' +
  'their orientation and print resolution → review_book, and fix what it reports → compare its unusedPhotos with ' +
  'the placed photos (view_photos) and swap in better ones with place_photo, keeping the main people in every ' +
  'chapter → apply_improvements for the photos it reports as improvements → check that no photo appears again as ' +
  'its artwork, crop, enhanced or improved copy (only as a pair on one page) → ' +
  'render_book to look at all spreads → render_page on the weak ones → fix what is weak (a dull or repeated photo: ' +
  'place_photo; a bad crop: place_photo with a crop; a crowded page: set_page_layout; maps: ' +
  'set_page_map/add_map_page/illustrate_map) → set_caption with short captions from facts and what is visible on ' +
  'the rendered page (place, time, people, what they do; never invented light, mood or weather) → suggest a style ' +
  'preset (classic, soft, bold, or food for meals; set_book_style) → render again → export_pdf (print) and/or export_html (a ' +
  'single-file web book). To build a book by hand instead: create_book → add_page for each page (assetIds fill the ' +
  'slots in one call).';

const mapStyle = BookMapStyleOptionSchema.describe(
  'Map style: sketch (offline, hand-drawn look), watercolor, toner or terrain (Stadia Maps tiles; without an API ' +
    'key they are drawn as sketches and the result warns about it), or auto for the server default when it works',
);

const stylePreset = BookStylePresetSchema.describe(
  `Style preset: ${bookStylePresetIds.map((id) => `${id} (${bookStylePresets[id].description})`).join('; ')}`,
);

const mapOptions = {
  style: mapStyle.optional(),
  title: z.string().max(200).optional().describe('Title drawn on the map'),
  assetIds: z
    .array(z.uuidv4())
    .max(2000)
    .optional()
    .describe('Photos whose locations are plotted; default: the photos of the pages that follow, up to the next map'),
  showRoute: z.boolean().optional().describe('Connect the places in time order, default true'),
  labels: z.boolean().optional().describe('Label the places, default true'),
};

const bookId = z.uuidv4().describe('Book ID');
const pageRef = z
  .union([z.int().min(1), z.uuidv4()])
  .describe('Page number (1-based, as shown by get_book) or page ID');
const slotNumber = z.int().min(1).describe('Slot number (1-based); slot 1 is the first (or hero) slot of the layout');
const layoutId = z.string().describe(`Layout ID, one of: ${bookLayouts.map((layout) => layout.id).join(', ')}`);

const round = (value: number) => Math.round(value * 1000) / 1000;

const summarizeMap = (map: BookMap) => ({
  style: map.style,
  ...(map.title && { title: map.title }),
  ...(map.assetIds && { photos: map.assetIds.length }),
  ...(!map.showRoute && { showRoute: false }),
  ...(!map.labels && { labels: false }),
  ...((map.artJobId || map.illustratedAssetId) && { illustrated: map.illustratedAssetId ? 'done' : 'started' }),
});

const summarizePage = (page: BookPageResponseDto) => ({
  page: page.position + 1,
  id: page.id,
  layout: page.layout,
  ...(page.sectionTitle && { sectionTitle: page.sectionTitle }),
  ...(page.caption && { caption: page.caption }),
  ...(page.background && { background: page.background }),
  ...(page.map && { map: summarizeMap(page.map) }),
  slots: page.slots.map((slot) => ({
    slot: slot.slot + 1,
    aspect: slot.aspectRatio,
    assetId: slot.assetId,
    ...(slot.crop && {
      crop: {
        x: round(slot.crop.x),
        y: round(slot.crop.y),
        width: round(slot.crop.width),
        height: round(slot.crop.height),
      },
    }),
    ...(slot.caption && { caption: slot.caption }),
  })),
});

const summarizeBook = (book: BookDetailResponseDto) => ({
  id: book.id,
  title: book.title,
  ...(book.subtitle && { subtitle: book.subtitle }),
  pageSize: `${book.pageWidthMm}×${book.pageHeightMm}mm`,
  style: book.style,
  exportStatus: book.exportStatus,
  htmlExportStatus: book.htmlExportStatus,
  pageCount: book.pages.length,
  pages: book.pages.map((page) => summarizePage(page)),
});

const summarizeWarnings = (warnings: BookRenderWarning[]) => warnings.map((warning) => warning.message);

const countReasons = (reasons: Record<string, string>) => {
  const counts: Record<string, number> = {};
  for (const reason of Object.values(reasons)) {
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
};

/** one line per page, e.g. "3: hero-left-two, 3 photos" */
const summarizeLayout = ({ book, plan, photoCount, warnings, improvements, improved }: BookAutoLayoutResult) => {
  const offset = Math.max(0, book.pages.length - plan.pages.length);
  return {
    bookId: book.id,
    title: book.title,
    pageCount: book.pages.length,
    photos: {
      considered: photoCount,
      placed: plan.usedIds.length,
      leftOut: plan.droppedIds.length,
      ...(plan.droppedIds.length > 0 && { leftOutBecause: countReasons(plan.dropReasons) }),
    },
    ...(plan.people.length > 0 && { mainPeople: plan.people }),
    sections: plan.sections.map((section) => ({
      title: section.title,
      dates: section.dates,
      photos: section.photoIds.length,
      ...(section.place && { place: section.place, pack: section.pack }),
    })),
    pages: plan.pages.map((page, index) => {
      const parts = [page.layout];
      if (page.sectionTitle) {
        parts.push(`"${page.sectionTitle}"`);
      }
      if (page.slots.length > 0) {
        parts.push(`${page.slots.length} photo${page.slots.length === 1 ? '' : 's'}`);
      }
      if (page.map) {
        parts.push(`${page.map.style} map`);
      }
      return `${offset + index + 1}: ${parts.join(', ')}`;
    }),
    ...(warnings.length > 0 && { warnings }),
    ...(improvements.length > 0 && {
      improvements: improvements.map(({ assetId, recipe, gain }) => ({ assetId, recipe, gain })),
    }),
    ...(improved.length > 0 && { improved }),
    next:
      (improvements.length > 0
        ? `${improvements.length} placed photo${improvements.length === 1 ? '' : 's'} would look better ` +
          'straightened or auto-enhanced: call ' +
          'apply_improvements with this bookId to create improved copies (the user approves) and place them. '
        : '') +
      'Call review_book and fix what it reports, then render_book to look at the spreads and render_page on weak ' +
      'pages; swap in better unused photos, write captions for what is visible, and suggest a style preset.',
  };
};

/**
 * Photo book editing, rendering and export.
 *
 * Approval policy: a book is a draft the user asked for, and editing it never changes the library, so edits to
 * books the agent created in the current session are `mutating: false` and run without asking. Editing any other
 * book first needs `edit_existing_book` (mutating, so the user approves it once per book and session). Exporting
 * the print PDF stays mutating as well.
 */
@Injectable()
export class BookAgentTools extends BaseService {
  private bookService?: BookService;

  private get books() {
    this.bookService ??= BaseService.create(BookService, this);
    return this.bookService;
  }

  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'list_layouts',
        title: 'List book layouts',
        description:
          'List the page layouts for photo books with their slot count and the aspect ratio (width/height) of each ' +
          'slot. Pass a bookId to get the aspect ratios for that book’s page size and margins. Pick photos whose ' +
          'orientation matches the slots, and vary layouts across the book. ' +
          WORKFLOW,
        input: z.object({ bookId: bookId.optional() }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => {
            const book = input.bookId ? await this.books.get(ctx.auth, input.bookId) : undefined;
            const size = book ?? { pageWidthMm: 210, pageHeightMm: 210 };
            const style = book?.style ?? defaultBookStyle;
            return toolJson({
              pageSize: `${size.pageWidthMm}×${size.pageHeightMm}mm`,
              layouts: bookLayouts.map((layout) => ({
                id: layout.id,
                description: layout.description,
                slots: layout.slots.length,
                aspects: getSlotAspectRatios(layout, size, style).map((aspect) => round(aspect)),
                orientation: layout.orientation,
                ...(layout.text.length > 0 && { text: layout.text.map((area) => area.kind) }),
                ...(layout.map && { map: true }),
                ...(layout.collection && { collection: true }),
              })),
              stylePresets: bookStylePresetIds.map((id) => ({ id, ...bookStylePresets[id] })),
            });
          }),
      }),

      defineTool({
        name: 'list_books',
        title: 'List books',
        description: 'List the user’s photo books.',
        input: z.object({}),
        mutating: false,
        handler: (ctx) =>
          this.run(async () => {
            const books = await this.books.getAll(ctx.auth);
            return toolJson(
              books.map((book) => ({
                id: book.id,
                title: book.title,
                pageCount: book.pageCount,
                exportStatus: book.exportStatus,
                htmlExportStatus: book.htmlExportStatus,
                updatedAt: book.updatedAt,
              })),
            );
          }),
      }),

      defineTool({
        name: 'create_book',
        title: 'Create a photo book',
        description:
          'Create an empty photo book (a draft the user can review in Immich). Page size defaults to 210×210mm. ' +
          'Start from a stylePreset (classic, soft, bold or food) and/or set style options: marginMm, gutterMm, ' +
          'background, textColor and accentColor (hex), fontFamily, titleSizePt, captionSizePt, theme (plain or ' +
          'food). ' +
          WORKFLOW,
        input: z.object({
          title: z.string().min(1).max(200).describe('Book title, shown on the cover'),
          subtitle: z.string().max(200).optional().describe('Subtitle shown on the cover'),
          albumId: z.uuidv4().optional().describe('Album the book is made from'),
          pageWidthMm: z.int().min(50).max(600).optional().describe('Page width in millimeters'),
          pageHeightMm: z.int().min(50).max(600).optional().describe('Page height in millimeters'),
          stylePreset: stylePreset.optional(),
          style: BookStyleUpdateSchema.optional(),
        }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => {
            const book = await this.books.create(ctx.auth, input);
            markEditable(ctx, book.id);
            return toolJson({
              ...summarizeBook(book),
              next: 'Add the cover with add_page(layout "cover"), then the remaining pages.',
            });
          }),
      }),

      defineTool({
        name: 'auto_layout_book',
        title: 'Lay out a photo book automatically',
        description:
          'Lay out a whole book in one call. Pass albumId (and optionally title/subtitle/page size) to create a new ' +
          'book from an album, or bookId to lay out an existing book again from its album or from assetIds. It ' +
          'picks the best photo of each near-duplicate burst, splits the photos into sections by event, opens ' +
          'every section with a map (when the photos have GPS) or a section title, gives the most important photos ' +
          '(heroAssetIds, favorites, sharp photos with faces) whole pages or hero slots, fits portrait photos in ' +
          'portrait slots without cutting faces, and avoids repeating layouts. It shows one photo per stack (an ' +
          'artwork only next to its original, at most maxStackPairs times), keeps artwork to about one page in ' +
          'five (maxArtworkShare) and never on two pages in a row, never puts a photo in a slot it cannot print ' +
          'at 150 dpi, avoids more than two single-photo pages in a row and similar photos on neighbouring pages, ' +
          'splits a single day into chapters (e.g. the stops of a ride), keeps the main people in every section, ' +
          'and drafts factual captions (captions: none, place, place-time, people or dish; never descriptions of the ' +
          'photos). A food book (stylePreset food, or photos tagged Food/<Restaurant>/<Dish> and ' +
          'Food/<Restaurant>/Menu) gets one chapter per restaurant visit titled "<Restaurant> · <place>, <date>", ' +
          'opened by a menu page with the photo of the menu, and every dish captioned with its name on layouts ' +
          'that leave room for it (captions default to dish there); so does a book of any collection pack (photos ' +
          'tagged by save_entries, or its stylePreset): a chapter per visit of a place, its source page, and the ' +
          'entries captioned. It picks photos on what they can become (considerImprovements, default true): straightening ' +
          'and auto-enhance are simulated on the previews, and it returns improvements [{assetId, recipe, gain}] ' +
          'for the placed photos they help, without creating anything; then call apply_improvements. ' +
          'targetPageCount is approximate: less important photos are left out when there are too many. ' +
          'The pages are replaced unless keepExisting (which appends the photos that are not in the book yet). ' +
          'Only when the user asks for illustrated (AI-drawn) maps and an art profile is configured, pass ' +
          'illustratedMaps=true and then call illustrate_map without a page (the user approves it). Returns a page ' +
          'summary with the photos left out (and why), the main people and warnings (e.g. a map style that is not ' +
          'available). ' +
          WORKFLOW,
        input: z.object({
          albumId: z.uuidv4().optional().describe('Create a new book from this album'),
          bookId: bookId.optional().describe('Lay out this book again'),
          title: z.string().min(1).max(200).optional().describe('Title of a new book (default: the album name)'),
          subtitle: z.string().max(200).optional(),
          pageWidthMm: z.int().min(50).max(600).optional(),
          pageHeightMm: z.int().min(50).max(600).optional(),
          assetIds: z.array(z.uuidv4()).min(1).max(2000).optional().describe('Photos to lay out (default: the album)'),
          heroAssetIds: z.array(z.uuidv4()).max(100).optional().describe('Photos that must get a page of their own'),
          targetPageCount: z.int().min(1).max(200).optional().describe('Default: about one page per 2.5 photos'),
          includeMaps: z.boolean().optional().describe('Open sections with GPS locations with a map, default true'),
          mapStyle: mapStyle.optional(),
          illustratedMaps: z
            .boolean()
            .optional()
            .describe('The user asked for illustrated (AI-drawn) maps; default false'),
          keepExisting: z.boolean().optional(),
          stylePreset: stylePreset.optional(),
          captions: BookCaptionModeSchema.optional(),
          maxArtworkShare: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe('Most pages with artwork, as a share of the pages, default 0.2'),
          maxStackPairs: z
            .int()
            .min(0)
            .max(20)
            .optional()
            .describe('Artworks shown next to their original on one page, default 2'),
          considerImprovements: z
            .boolean()
            .optional()
            .describe('Pick photos on the score after straightening and auto-enhance, default true'),
        }),
        mutating: false,
        handler: (
          ctx,
          { albumId, bookId, title, subtitle, pageWidthMm, pageHeightMm, stylePreset, illustratedMaps, ...options },
        ) => {
          if (!!albumId === !!bookId) {
            return Promise.resolve(toolError('Pass either albumId (to create a book) or bookId (to lay out a book)'));
          }

          if (albumId) {
            return this.run(async () => {
              const result = await this.books.createFromAlbumWithPlan(ctx.auth, {
                albumId,
                title,
                subtitle,
                pageWidthMm,
                pageHeightMm,
                stylePreset,
                targetPageCount: options.targetPageCount,
                includeMaps: options.includeMaps,
                mapStyle: options.mapStyle,
                captions: options.captions,
                maxArtworkShare: options.maxArtworkShare,
                maxStackPairs: options.maxStackPairs,
                considerImprovements: options.considerImprovements,
                improvePhotos: false,
              });
              markEditable(ctx, result.book.id);
              return toolJson(await this.withIllustrationHint(summarizeLayout(result), illustratedMaps));
            });
          }

          return this.edit(ctx, bookId!, async () => {
            if (title !== undefined || subtitle !== undefined || pageWidthMm || pageHeightMm || stylePreset) {
              await this.books.update(ctx.auth, bookId!, { title, subtitle, pageWidthMm, pageHeightMm, stylePreset });
            }
            const result = await this.books.autoLayoutWithPlan(ctx.auth, bookId!, { ...options, improvePhotos: false });
            return toolJson(await this.withIllustrationHint(summarizeLayout(result), illustratedMaps));
          });
        },
      }),

      defineTool({
        name: 'get_book',
        title: 'Get a photo book',
        description:
          'Get a compact summary of a book: pages (1-based numbers), layouts, and for every slot the aspect ' +
          'ratio, the placed assetId (null when empty), crop and caption. Also shows exportStatus (PDF) and htmlExportStatus.',
        input: z.object({ bookId }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => toolJson(summarizeBook(await this.books.get(ctx.auth, input.bookId)))),
      }),

      defineTool({
        name: 'edit_existing_book',
        title: 'Edit an existing photo book',
        description:
          'Ask the user for permission to edit a book that was not created in this conversation. Books you ' +
          'created with create_book can be edited directly.',
        input: z.object({ bookId }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            const book = await this.books.get(ctx.auth, input.bookId);
            await this.requireAccess({ auth: ctx.auth, permission: Permission.BookUpdate, ids: [input.bookId] });
            markEditable(ctx, book.id);
            return toolJson(summarizeBook(book));
          }),
      }),

      defineTool({
        name: 'update_book',
        title: 'Update a photo book',
        description: 'Change the title, subtitle, cover photo (used when the cover slot is empty) or page size.',
        input: z.object({
          bookId,
          title: z.string().min(1).max(200).optional(),
          subtitle: z.string().max(200).nullable().optional(),
          coverAssetId: z.uuidv4().nullable().optional(),
          pageWidthMm: z.int().min(50).max(600).optional(),
          pageHeightMm: z.int().min(50).max(600).optional(),
        }),
        mutating: false,
        handler: (ctx, { bookId, ...dto }) =>
          this.edit(ctx, bookId, async () => toolJson(summarizeBook(await this.books.update(ctx.auth, bookId, dto)))),
      }),

      defineTool({
        name: 'set_book_style',
        title: 'Set the book style',
        description:
          'Change the style of the whole book. A preset (classic, soft, bold or food) replaces the style first; omitted ' +
          'options keep their value. Colors are hex (#rrggbb). Larger margins/gutters give a calmer look; small ' +
          'ones suit dense layouts.',
        input: BookStyleUpdateSchema.extend({ bookId, preset: stylePreset.optional() }),
        mutating: false,
        handler: (ctx, { bookId, preset, ...style }) =>
          this.edit(ctx, bookId, async () => {
            const book = await this.books.update(ctx.auth, bookId, { style, stylePreset: preset });
            return toolJson({ style: book.style });
          }),
      }),

      defineTool({
        name: 'add_page',
        title: 'Add a page',
        description:
          'Add a page with a layout. Pass assetIds to fill the slots in order in the same call (a default crop ' +
          'matching each slot, keeping faces in frame, is chosen). sectionTitle is shown by the "section-opener" ' +
          'and "text" layouts and marks where a section starts. The caption is shown in the caption area or the ' +
          'bottom margin.',
        input: z.object({
          bookId,
          layout: layoutId,
          position: z.int().min(1).optional().describe('Page number the new page gets; appended when omitted'),
          sectionTitle: z.string().max(200).optional(),
          caption: z.string().max(2000).optional(),
          assetIds: z.array(z.uuidv4()).optional().describe('Photos for slots 1, 2, … in order'),
        }),
        mutating: false,
        handler: (ctx, { bookId, layout, position, sectionTitle, caption, assetIds = [] }) =>
          this.edit(ctx, bookId, async () => {
            const definition = getLayout(layout);
            if (definition && assetIds.length > definition.slots.length) {
              throw new ToolInputError(
                `Layout "${layout}" has ${definition.slots.length} slot(s) but ${assetIds.length} assetIds were given`,
              );
            }

            let page = await this.books.addPage(ctx.auth, bookId, {
              layout,
              position: position === undefined ? undefined : position - 1,
              sectionTitle,
              caption,
            });
            for (const [index, assetId] of assetIds.entries()) {
              page = await this.books.setSlot(ctx.auth, bookId, page.id, index, { assetId });
            }

            return toolJson(summarizePage(page));
          }),
      }),

      defineTool({
        name: 'remove_page',
        title: 'Remove a page',
        description: 'Remove a page; the following pages move up by one.',
        input: z.object({ bookId, page: pageRef }),
        mutating: false,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const page = await this.resolvePage(ctx, input.bookId, input.page);
            await this.books.removePage(ctx.auth, input.bookId, page.id);
            return toolJson({ removed: page.position + 1 });
          }),
      }),

      defineTool({
        name: 'move_page',
        title: 'Move a page',
        description: 'Move a page so that it becomes page `toPage`; the pages in between shift by one.',
        input: z.object({ bookId, page: pageRef, toPage: z.int().min(1).describe('New page number (1-based)') }),
        mutating: false,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const page = await this.resolvePage(ctx, input.bookId, input.page);
            const moved = await this.books.movePage(ctx.auth, input.bookId, page.id, { position: input.toPage - 1 });
            return toolJson({ from: page.position + 1, to: moved.position + 1 });
          }),
      }),

      defineTool({
        name: 'set_page_layout',
        title: 'Change a page layout',
        description:
          'Change the layout of a page. Photos stay in the same slot numbers; photos in slots the new layout does ' +
          'not have are removed. Crops keep their values, so re-place photos whose slot shape changed a lot.',
        input: z.object({ bookId, page: pageRef, layout: layoutId }),
        mutating: false,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const current = await this.resolvePage(ctx, input.bookId, input.page);
            const page = await this.books.updatePage(ctx.auth, input.bookId, current.id, { layout: input.layout });
            const removed = current.slots
              .filter((slot) => slot.assetId && slot.slot >= page.slots.length)
              .map((slot) => ({ slot: slot.slot + 1, assetId: slot.assetId }));
            return toolJson({ ...summarizePage(page), ...(removed.length > 0 && { removed }) });
          }),
      }),

      defineTool({
        name: 'add_map_page',
        title: 'Add a map page',
        description:
          'Add a map page: a full-page map ("map" layout), or a map with one photo, the section title and the ' +
          'caption when photoAssetId is given ("map-photo" layout). By default the map plots the photos of the ' +
          'pages that follow it, up to the next map or section opener, so put it at the start of a section. ' +
          'Render it with render_page to check it.',
        input: z.object({
          bookId,
          position: z.int().min(1).optional().describe('Page number the map gets; appended when omitted'),
          photoAssetId: z.uuidv4().optional().describe('Photo shown next to the map'),
          sectionTitle: z.string().max(200).optional(),
          caption: z.string().max(2000).optional(),
          ...mapOptions,
        }),
        mutating: false,
        handler: (ctx, { bookId, position, photoAssetId, sectionTitle, caption, ...options }) =>
          this.edit(ctx, bookId, async () => {
            const { map, warning } = await this.toMap(options);
            let page = await this.books.addPage(ctx.auth, bookId, {
              layout: photoAssetId ? 'map-photo' : 'map',
              position: position === undefined ? undefined : position - 1,
              sectionTitle,
              caption,
              map,
            });
            if (photoAssetId) {
              page = await this.books.setSlot(ctx.auth, bookId, page.id, 0, { assetId: photoAssetId });
            }
            return toolJson({ ...summarizePage(page), ...(warning && { warnings: [warning] }) });
          }),
      }),

      defineTool({
        name: 'set_page_map',
        title: 'Set the map of a page',
        description:
          'Change the map of a page (style, title, plotted photos, route, labels). A page whose layout has no map ' +
          'area is switched to the "map" layout, or to "map-photo" when layout is given. Pass remove=true to ' +
          'remove the map. Changing the map discards an illustration made with illustrate_map.',
        input: z.object({
          bookId,
          page: pageRef,
          layout: z.enum(['map', 'map-photo']).optional(),
          remove: z.boolean().optional(),
          ...mapOptions,
        }),
        mutating: false,
        handler: (ctx, { bookId, page: ref, layout, remove, ...options }) =>
          this.edit(ctx, bookId, async () => {
            const page = await this.resolvePage(ctx, bookId, ref);
            if (remove) {
              return toolJson(summarizePage(await this.books.updatePage(ctx.auth, bookId, page.id, { map: null })));
            }

            const current = page.map;
            const { map, warning } = await this.toMap({
              style: options.style ?? current?.style,
              title: options.title ?? current?.title,
              assetIds: options.assetIds ?? current?.assetIds,
              showRoute: options.showRoute ?? current?.showRoute,
              labels: options.labels ?? current?.labels,
            });
            const target = layout ?? (getLayout(page.layout)?.map ? undefined : 'map');
            const updated = await this.books.updatePage(ctx.auth, bookId, page.id, { map, layout: target });
            return toolJson({ ...summarizePage(updated), ...(warning && { warnings: [warning] }) });
          }),
      }),

      defineTool({
        name: 'illustrate_map',
        title: 'Illustrate a map',
        description:
          'Have the art agent redraw the map of a page as a hand-illustrated watercolor travel map (the rendered map ' +
          'is saved as a photo next to the first photo of the section, and the artwork as another one). It takes a ' +
          'minute or two; render_page shows the plain map until the illustration is done. Without a page, every map ' +
          'page that is not illustrated yet is. Only for photos the user owns, and only when an art agent is ' +
          'configured; use it only when the user asks for illustrated maps.',
        input: z.object({ bookId, page: pageRef.optional() }),
        mutating: true,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const next = 'The illustration takes a minute or two; render_page shows it once it is done.';
            if (input.page !== undefined) {
              const page = await this.resolvePage(ctx, input.bookId, input.page);
              const updated = await this.books.illustratePageMap(ctx.auth, input.bookId, page.id);
              return toolJson({ ...summarizePage(updated), next });
            }

            const book = await this.books.get(ctx.auth, input.bookId);
            const pages = book.pages.filter(
              (page) => getLayout(page.layout)?.map && !page.map?.artJobId && !page.map?.illustratedAssetId,
            );
            if (pages.length === 0) {
              throw new ToolInputError('The book has no map pages to illustrate');
            }
            const started: number[] = [];
            const failed: string[] = [];
            for (const page of pages) {
              try {
                await this.books.illustratePageMap(ctx.auth, input.bookId, page.id);
                started.push(page.position + 1);
              } catch (error: any) {
                failed.push(`page ${page.position + 1}: ${error?.response?.message ?? error?.message ?? error}`);
              }
            }
            return toolJson({ started, ...(failed.length > 0 && { failed }), next });
          }),
      }),

      defineTool({
        name: 'place_photo',
        title: 'Place a photo',
        description:
          'Place a photo in a slot (replacing any photo there). Without a crop, a crop with the slot’s aspect ' +
          'ratio is chosen that keeps faces in frame. A crop is x, y, width, height as fractions (0..1) of the ' +
          'photo; give it the slot’s aspect ratio (in pixels) or it is trimmed around its centre.',
        input: z.object({
          bookId,
          page: pageRef,
          slot: slotNumber,
          assetId: z.uuidv4().describe('Photo to place'),
          crop: NormalizedRectSchema.optional(),
          caption: z.string().max(500).optional().describe('Caption shown over the bottom of the photo'),
        }),
        mutating: false,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const page = await this.resolvePage(ctx, input.bookId, input.page);
            const updated = await this.books.setSlot(ctx.auth, input.bookId, page.id, input.slot - 1, {
              assetId: input.assetId,
              crop: input.crop,
              caption: input.caption,
            });
            return toolJson(summarizePage(updated));
          }),
      }),

      defineTool({
        name: 'clear_slot',
        title: 'Clear a slot',
        description: 'Remove the photo from a slot.',
        input: z.object({ bookId, page: pageRef, slot: slotNumber }),
        mutating: false,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const page = await this.resolvePage(ctx, input.bookId, input.page);
            return toolJson(summarizePage(await this.books.clearSlot(ctx.auth, input.bookId, page.id, input.slot - 1)));
          }),
      }),

      defineTool({
        name: 'set_caption',
        title: 'Set a caption',
        description:
          'Set the caption of a page, or of the photo in a slot when `slot` is given. Also sets the page’s ' +
          'sectionTitle when given. Use null or an empty string to remove a caption. Keep captions short. In a food ' +
          'book the slot caption of a dish is its name (from its Food/<Restaurant>/<Dish> tag), set below the photo ' +
          'on the dish layouts.',
        input: z.object({
          bookId,
          page: pageRef,
          slot: slotNumber.optional(),
          caption: z.string().max(2000).nullable(),
          sectionTitle: z.string().max(200).nullable().optional(),
        }),
        mutating: false,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const page = await this.resolvePage(ctx, input.bookId, input.page);
            const caption = input.caption?.trim() || null;
            const sectionTitle = input.sectionTitle === undefined ? undefined : input.sectionTitle?.trim() || null;
            if (input.slot === undefined) {
              const updated = await this.books.updatePage(ctx.auth, input.bookId, page.id, { caption, sectionTitle });
              return toolJson(summarizePage(updated));
            }

            if (sectionTitle !== undefined) {
              await this.books.updatePage(ctx.auth, input.bookId, page.id, { sectionTitle });
            }
            const updated = await this.books.updateSlot(ctx.auth, input.bookId, page.id, input.slot - 1, { caption });
            return toolJson(summarizePage(updated));
          }),
      }),

      defineTool({
        name: 'render_page',
        title: 'Render a page',
        description:
          'Render a page as an image (~1200px, from previews) to check your work: faces cut by crops, awkward ' +
          'crops, empty slots, text that does not fit, photos that clash. Also returns warnings, including the ' +
          'estimated print resolution of each photo (below 150 dpi prints blurry).',
        input: z.object({ bookId, page: pageRef }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => {
            const page = await this.resolvePage(ctx, input.bookId, input.page);
            // travel documents (and other private sources) on the page are blurred
            const { data, warnings, hidden } = await this.books.renderPage(
              ctx.auth,
              input.bookId,
              page.id,
              {},
              {
                hidePrivate: true,
              },
            );
            return toolImage(data, 'image/jpeg', {
              page: page.position + 1,
              warnings: summarizeWarnings(warnings),
              ...(hidden?.length && { hidden, note: PRIVATE_SOURCE_BLURRED }),
            });
          }),
      }),

      defineTool({
        name: 'apply_improvements',
        title: 'Improve the photos of a book',
        description:
          'Create improved copies (straightened, auto-enhanced; no AI) of the photos in a book that the simulated ' +
          'fixes measurably help, as reported by auto_layout_book (improvements) or review_book (could-look-better), ' +
          'and place the copies instead of the originals, with the crops of their slots recomputed. The originals ' +
          'are never changed: each copy is stacked with its original (one stack, so the book still shows the photo ' +
          'once). Pass assetIds to improve only some photos. Returns {improved: [{sourceId, id, description, pages}], ' +
          'skipped}.',
        input: z.object({
          bookId,
          assetIds: z.array(z.uuidv4()).min(1).max(500).optional().describe('Placed photos to improve; default all'),
        }),
        mutating: true,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const result = await this.books.applyImprovements(ctx.auth, input.bookId, { assetIds: input.assetIds });
            return toolJson({
              improved: result.improved,
              ...(result.skipped.length > 0 && { skipped: result.skipped }),
              next:
                result.improved.length > 0
                  ? 'Look at the changed pages with render_page (the copies get their previews in a moment).'
                  : 'Nothing was improved.',
            });
          }),
      }),

      defineTool({
        name: 'review_book',
        title: 'Review a photo book',
        description:
          'A checklist of what to fix in a book, most severe first (high, medium, low): the same photo stack on ' +
          'more than one page (a photo and its crop, artwork or enhanced copy; an artwork next to its original on ' +
          'one page is a fine pair), placements that print below 150 dpi (page and slot), empty slots, too much ' +
          'artwork or artwork on consecutive pages, more than two single-photo pages in a row, similar photos on ' +
          'neighbouring pages, maps drawn as sketches for lack of a Stadia Maps key, main people with few photos, ' +
          'repeated layouts, pages without captions and placed photos that straightening or auto-enhance would ' +
          'clearly help (could-look-better: call apply_improvements). Also lists unusedPhotos (the best album photos that are ' +
          'not in the book, the main people first) and weakestPlaced (the lowest scoring photos in the book, to ' +
          'compare and swap with place_photo). Read-only.',
        input: z.object({ bookId }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => {
            const review = await this.books.getReview(ctx.auth, input.bookId);
            return toolJson({
              pageCount: review.pageCount,
              counts: review.counts,
              issues: review.issues,
              ...(review.unusedPhotos.length > 0 && { unusedPhotos: review.unusedPhotos }),
              ...(review.weakestPlaced.length > 0 && { weakestPlaced: review.weakestPlaced }),
              ...(review.people.length > 0 && { mainPeople: review.people }),
            });
          }),
      }),

      defineTool({
        name: 'render_book',
        title: 'Render the book overview',
        description:
          'Render small thumbnails of all pages (or pages fromPage..toPage) as two-page spreads with page ' +
          'numbers, like the printed book will open (page 1 alone on the right). Use it to judge pacing and ' +
          'variety; use render_page for details. For long books render ranges of ~16 pages. Call review_book for ' +
          'a checklist of what to fix.',
        input: z.object({
          bookId,
          fromPage: z.int().min(1).optional(),
          toPage: z.int().min(1).optional(),
        }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => {
            const { data, warnings, pages, hidden } = await this.books.renderContactSheet(
              ctx.auth,
              input.bookId,
              { from: input.fromPage, to: input.toPage },
              true,
            );
            return toolImage(data, 'image/jpeg', {
              pages: `${pages[0]}-${pages.at(-1)}`,
              warnings: summarizeWarnings(warnings),
              ...(hidden?.length && { hidden, note: PRIVATE_SOURCE_BLURRED }),
            });
          }),
      }),

      defineTool({
        name: 'export_pdf',
        title: 'Export the book as PDF',
        description:
          'Queue the print-ready PDF export (300 dpi, from the original photos). It runs in the background; poll ' +
          'get_book until exportStatus is "completed" (or "failed"). Only export after reviewing the pages.',
        input: z.object({ bookId }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            const book = await this.books.export(ctx.auth, input.bookId);
            return toolJson({
              queued: true,
              exportStatus: book.exportStatus,
              downloadPath: `/api/books/${book.id}/pdf`,
            });
          }),
      }),

      defineTool({
        name: 'export_html',
        title: 'Export the book as a web page',
        description:
          'Queue the export of a single self-contained HTML file (every photo embedded, no internet needed) that ' +
          'can be opened offline or emailed, with a two-page book view and a scroll view. It runs in the ' +
          'background; poll get_book until htmlExportStatus is "completed" (or "failed").',
        input: z.object({ bookId }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            const book = await this.books.export(ctx.auth, input.bookId, { format: BookExportFormat.Html });
            return toolJson({
              queued: true,
              htmlExportStatus: book.htmlExportStatus,
              downloadPath: `/api/books/${book.id}/html`,
            });
          }),
      }),
    ];
  }

  /** the map, and a warning when its style can't be drawn yet */
  private async toMap(options: {
    style?: BookMapStyleOption;
    title?: string;
    assetIds?: string[];
    showRoute?: boolean;
    labels?: boolean;
  }): Promise<{ map: BookMap; warning?: string }> {
    const { books } = await this.getConfig({ withCache: true });
    const { style, warning } = resolveMapStyle(options.style, books.maps);
    return {
      map: {
        style,
        ...(options.title && { title: options.title }),
        ...(options.assetIds?.length && { assetIds: options.assetIds }),
        showRoute: options.showRoute ?? true,
        labels: options.labels ?? true,
      },
      warning,
    };
  }

  /** after a layout for which the user asked for illustrated maps: how to start them, or why they can't be */
  private async withIllustrationHint<T extends { next: string }>(summary: T, illustratedMaps?: boolean) {
    if (!illustratedMaps) {
      return summary;
    }
    const { agent } = await this.getConfig({ withCache: true });
    if (!isArtEnabled(agent)) {
      return {
        ...summary,
        illustratedMaps: 'Illustrated maps need an art agent profile (Administration → AI assistant)',
      };
    }
    return {
      ...summary,
      next: `Call illustrate_map with this bookId and no page to redraw every map as an illustration. ${summary.next}`,
    };
  }

  private async resolvePage(ctx: AgentToolContext, bookId: string, ref: number | string) {
    const book = await this.books.get(ctx.auth, bookId);
    const page = typeof ref === 'number' ? book.pages[ref - 1] : book.pages.find((candidate) => candidate.id === ref);
    if (!page) {
      throw new ToolInputError(
        typeof ref === 'number'
          ? `Page ${ref} does not exist; the book has ${book.pages.length} page(s)`
          : `Page ${ref} not found`,
      );
    }
    return page;
  }

  private edit(ctx: AgentToolContext, bookId: string, handler: () => Promise<AgentToolResult>) {
    if (!isEditable(ctx, bookId)) {
      return Promise.resolve(
        toolError(
          `Book ${bookId} was not created in this conversation. Call edit_existing_book first so the user can approve editing it.`,
        ),
      );
    }
    return this.run(handler);
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException || error instanceof ToolInputError)) {
        this.logger.error(`Book tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}

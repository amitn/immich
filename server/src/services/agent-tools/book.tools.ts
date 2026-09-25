import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import {
  BookDetailResponseDto,
  BookMap,
  BookMapStyleOptionSchema,
  BookPageResponseDto,
  BookStyleUpdateSchema,
  NormalizedRectSchema,
  defaultBookStyle,
} from 'src/dtos/book.dto.js';
import { BookExportFormat, Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { BookAutoLayoutResult, BookService } from 'src/services/book.service.js';
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
import { BookMapStyleOption } from 'src/utils/book/map-styles.js';
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
  'Workflow: start with auto_layout_book (from an album, or a book plus assetIds): it makes the cover, one section ' +
  'per event opened by a map (with GPS) or a section title, and sizes the photos by importance while fitting their ' +
  'orientation → render_book to look at all spreads → render_page on the weak ones → fix what is weak (a dull or ' +
  'repeated photo: place_photo; a bad crop: place_photo with a crop; a crowded page: set_page_layout; titles and ' +
  'captions: set_caption; maps: set_page_map/add_map_page/illustrate_map) → render again → export_pdf (print) and/or export_html (a single-file web book). To build a ' +
  'book by hand instead: create_book → add_page for each page (assetIds fill the slots in one call).';

const mapStyle = BookMapStyleOptionSchema.describe(
  'Map style: sketch (offline, hand-drawn look), watercolor, toner or terrain (Stadia Maps tiles; they fall back to ' +
    'sketch without an API key), or auto for the server default',
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

/** one line per page, e.g. "3: hero-left-two, 3 photos" */
const summarizeLayout = ({ book, plan, photoCount, warnings }: BookAutoLayoutResult) => {
  const offset = Math.max(0, book.pages.length - plan.pages.length);
  return {
    bookId: book.id,
    title: book.title,
    pageCount: book.pages.length,
    photos: { considered: photoCount, placed: plan.usedIds.length, leftOut: plan.droppedIds.length },
    sections: plan.sections.map((section) => ({
      title: section.title,
      dates: section.dates,
      photos: section.photoIds.length,
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
    next: 'Call render_book to review the spreads, then render_page on pages that look weak and fix them.',
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
              })),
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
          'Style options: marginMm, gutterMm, background and textColor (hex), fontFamily, titleSizePt, captionSizePt. ' +
          WORKFLOW,
        input: z.object({
          title: z.string().min(1).max(200).describe('Book title, shown on the cover'),
          subtitle: z.string().max(200).optional().describe('Subtitle shown on the cover'),
          albumId: z.uuidv4().optional().describe('Album the book is made from'),
          pageWidthMm: z.int().min(50).max(600).optional().describe('Page width in millimeters'),
          pageHeightMm: z.int().min(50).max(600).optional().describe('Page height in millimeters'),
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
          'portrait slots without cutting faces, and avoids repeating layouts. targetPageCount is approximate: ' +
          'less important photos are left out when there are too many. The pages are replaced unless keepExisting ' +
          '(which appends the photos that are not in the book yet). Returns a page summary. ' +
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
          keepExisting: z.boolean().optional(),
        }),
        mutating: false,
        handler: (ctx, { albumId, bookId, title, subtitle, pageWidthMm, pageHeightMm, ...options }) => {
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
                targetPageCount: options.targetPageCount,
                includeMaps: options.includeMaps,
                mapStyle: options.mapStyle,
              });
              markEditable(ctx, result.book.id);
              return toolJson(summarizeLayout(result));
            });
          }

          return this.edit(ctx, bookId!, async () => {
            if (title !== undefined || subtitle !== undefined || pageWidthMm || pageHeightMm) {
              await this.books.update(ctx.auth, bookId!, { title, subtitle, pageWidthMm, pageHeightMm });
            }
            return toolJson(summarizeLayout(await this.books.autoLayoutWithPlan(ctx.auth, bookId!, options)));
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
          'Change the style of the whole book. Omitted options keep their value. Colors are hex (#rrggbb). ' +
          'Larger margins/gutters give a calmer look; small ones suit dense layouts.',
        input: BookStyleUpdateSchema.extend({ bookId }),
        mutating: false,
        handler: (ctx, { bookId, ...style }) =>
          this.edit(ctx, bookId, async () => {
            const book = await this.books.update(ctx.auth, bookId, { style });
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
            const map = await this.toMap(options);
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
            return toolJson(summarizePage(page));
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
            const map = await this.toMap({
              style: options.style ?? current?.style,
              title: options.title ?? current?.title,
              assetIds: options.assetIds ?? current?.assetIds,
              showRoute: options.showRoute ?? current?.showRoute,
              labels: options.labels ?? current?.labels,
            });
            const target = layout ?? (getLayout(page.layout)?.map ? undefined : 'map');
            const updated = await this.books.updatePage(ctx.auth, bookId, page.id, { map, layout: target });
            return toolJson(summarizePage(updated));
          }),
      }),

      defineTool({
        name: 'illustrate_map',
        title: 'Illustrate a map',
        description:
          'Have the art agent redraw the map of a page as a hand-illustrated watercolor travel map (the rendered map ' +
          'is saved as a photo next to the first photo of the section, and the artwork as another one). It takes a ' +
          'minute or two; render_page shows the plain map until the illustration is done. Only for photos the user ' +
          'owns, and only when an art agent is configured.',
        input: z.object({ bookId, page: pageRef }),
        mutating: true,
        handler: (ctx, input) =>
          this.edit(ctx, input.bookId, async () => {
            const page = await this.resolvePage(ctx, input.bookId, input.page);
            const updated = await this.books.illustratePageMap(ctx.auth, input.bookId, page.id);
            return toolJson({
              ...summarizePage(updated),
              next: 'The illustration takes a minute or two; render_page shows it once it is done.',
            });
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
          'sectionTitle when given. Use null or an empty string to remove a caption. Keep captions short.',
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
            const { data, warnings } = await this.books.renderPage(ctx.auth, input.bookId, page.id);
            return toolImage(data, 'image/jpeg', { page: page.position + 1, warnings: summarizeWarnings(warnings) });
          }),
      }),

      defineTool({
        name: 'render_book',
        title: 'Render the book overview',
        description:
          'Render small thumbnails of all pages (or pages fromPage..toPage) as two-page spreads with page ' +
          'numbers, like the printed book will open (page 1 alone on the right). Use it to judge pacing and ' +
          'variety; use render_page for details. For long books render ranges of ~16 pages.',
        input: z.object({
          bookId,
          fromPage: z.int().min(1).optional(),
          toPage: z.int().min(1).optional(),
        }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => {
            const { data, warnings, pages } = await this.books.renderContactSheet(ctx.auth, input.bookId, {
              from: input.fromPage,
              to: input.toPage,
            });
            return toolImage(data, 'image/jpeg', {
              pages: `${pages[0]}-${pages.at(-1)}`,
              warnings: summarizeWarnings(warnings),
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

  private async toMap(options: {
    style?: BookMapStyleOption;
    title?: string;
    assetIds?: string[];
    showRoute?: boolean;
    labels?: boolean;
  }): Promise<BookMap> {
    const { books } = await this.getConfig({ withCache: true });
    const style = !options.style || options.style === 'auto' ? books.maps.defaultStyle : options.style;
    return {
      style,
      ...(options.title && { title: options.title }),
      ...(options.assetIds?.length && { assetIds: options.assetIds }),
      showRoute: options.showRoute ?? true,
      labels: options.labels ?? true,
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

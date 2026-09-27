import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import {
  BookStylePresetSchema,
  BookStyleUpdateSchema,
  bookStylePresetIds,
  bookStylePresets,
  defaultBookStyle,
} from 'src/dtos/book.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { BookStyleService, MAX_PALETTE_PHOTOS, MAX_STYLE_SAMPLE_PHOTOS } from 'src/services/book-style.service.js';
import { BookService } from 'src/services/book.service.js';
import { PRIVATE_SOURCE_BLURRED } from 'src/services/collection.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolImage, toolJson } from 'src/utils/agent/tools.js';
import {
  ACCENT_CONTRAST,
  BOOK_STYLE_FONTS,
  BOOK_STYLE_LIMITS,
  TEXT_CONTRAST,
  checkBookStyle,
} from 'src/utils/book/style-check.js';
import { BUILT_IN_COLLECTION_PACKS } from 'src/utils/collections/registry.js';

/** the themes a style can take, with the look the renderer gives them */
export const getBookStyleThemes = () => [
  { id: 'plain', look: 'plain', summary: 'photos and text only, no ornaments' },
  ...BUILT_IN_COLLECTION_PACKS.flatMap(({ book: { theme } }) =>
    theme ? [{ id: theme.id, look: theme.look, summary: theme.summary }] : [],
  ),
];

const fontList = BOOK_STYLE_FONTS.map(({ fontFamily }) => `"${fontFamily}"`).join(', ');
const limits = Object.entries(BOOK_STYLE_LIMITS)
  .map(([key, { min, max }]) => `${key} ${min}–${max}`)
  .join(', ');

const STYLE_RULES =
  `Styles are checked strictly: fontFamily is one of ${fontList} (list_book_styles says what they look like); ` +
  `colours are opaque hex (#rrggbb); the text needs a contrast of ${TEXT_CONTRAST.min}:1 on the background ` +
  `(${TEXT_CONTRAST.good}:1 reads well) and the accent ${ACCENT_CONTRAST.min}:1; ${limits}, captions smaller than ` +
  'titles; theme is plain or a pack theme (the printed look adds small caps, thin rules and ornaments in the accent ' +
  'colour; the gallery look shows photos whole with museum-label captions). Omitted options take the values of the ' +
  'classic preset.';

const style = BookStyleUpdateSchema.describe(`The proposed style. ${STYLE_RULES}`);
const assetIds = z.array(z.uuidv4()).min(1);

/** Designing book styles with the user: themes and fonts, palettes, previews, saving and applying */
@Injectable()
export class BookStyleAgentTools extends BaseService {
  private bookStyleService?: BookStyleService;

  private bookService?: BookService;

  private get styles() {
    this.bookStyleService ??= BaseService.create(BookStyleService, this);
    return this.bookStyleService;
  }

  private get books() {
    this.bookService ??= BaseService.create(BookService, this);
    return this.bookService;
  }

  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'list_book_styles',
        title: 'List book styles',
        description:
          'List what a book style can be made of: the built-in presets, the styles the user saved (id, name, ' +
          'style), the fonts that render (with what they look like), the themes and their looks, and the limits. ' +
          'Start here when designing a style.',
        input: z.object({}),
        mutating: false,
        handler: (ctx) =>
          this.run(async () => {
            const yourStyles = await this.styles.getAll(ctx.auth);
            return toolJson({
              presets: bookStylePresetIds.map((id) => ({ id, ...bookStylePresets[id] })),
              yourStyles: yourStyles.map(({ id, name, description, style }) => ({ id, name, description, style })),
              fonts: BOOK_STYLE_FONTS,
              themes: getBookStyleThemes(),
              limits: BOOK_STYLE_LIMITS,
              contrast: { text: TEXT_CONTRAST, accent: ACCENT_CONTRAST },
              defaults: defaultBookStyle,
            });
          }),
      }),

      defineTool({
        name: 'get_photo_palette',
        title: 'Get the colours of photos',
        description:
          'Read the colours of some photos, e.g. to match a style to "our wedding colours" or to the photos of a ' +
          'trip: the main colours with their share, the dominant colour, vivid accent colours, and a suggested ' +
          'readable background, text and accent drawn from them. Adjust the suggestion to the mood the user asked ' +
          `for. Up to ${MAX_PALETTE_PHOTOS} photos.`,
        input: z.object({ assetIds: assetIds.max(MAX_PALETTE_PHOTOS).describe('Photos to take the colours from') }),
        mutating: false,
        handler: (ctx, input) => this.run(async () => toolJson(await this.styles.getPalette(ctx.auth, input.assetIds))),
      }),

      defineTool({
        name: 'preview_book_style',
        title: 'Preview a book style',
        description:
          'Render a proposed style, without saving anything: the cover and the first spread of a book (bookId), or ' +
          `of a sample book made of up to ${MAX_STYLE_SAMPLE_PHOTOS} of the user's photos (assetIds; the first is ` +
          'the cover). Returns the image so you can judge it (is the text readable, do the colours suit the photos, ' +
          'does it match the mood?), the checked style, contrast ratios and warnings. Iterate until it looks right, ' +
          'show the user, and only then save_book_style. Fails with the reasons when the style breaks a rule.',
        input: z.object({
          style,
          bookId: z.uuidv4().optional().describe('Book whose first pages are shown in the style'),
          assetIds: assetIds
            .max(MAX_STYLE_SAMPLE_PHOTOS)
            .optional()
            .describe('Photos of a sample book, when there is no book'),
          title: z.string().max(100).optional().describe('Title on the cover of the sample book'),
          sectionTitle: z.string().max(100).optional().describe('Chapter title in the sample book'),
          caption: z.string().max(200).optional().describe('Caption in the sample book'),
        }),
        mutating: false,
        handler: (ctx, input) =>
          this.run(async () => {
            if (!input.bookId && !input.assetIds) {
              return toolError('Pass a bookId, or assetIds of photos for a sample book');
            }
            const result = await this.styles.preview(ctx.auth, input.style, {
              bookId: input.bookId,
              assetIds: input.assetIds,
              text: { title: input.title, sectionTitle: input.sectionTitle, caption: input.caption },
            });
            return toolImage(result.data, 'image/jpeg', {
              pages: result.pages,
              style: result.style,
              contrast: result.check.contrast,
              ...(result.check.warnings.length > 0 && { styleWarnings: result.check.warnings }),
              ...(result.warnings.length > 0 && { warnings: result.warnings }),
              ...(result.hidden?.length && { hidden: result.hidden, note: PRIVATE_SOURCE_BLURRED }),
              next: 'Show the user; save_book_style once they like it',
            });
          }),
      }),

      defineTool({
        name: 'save_book_style',
        title: 'Save a book style',
        description:
          'Save a style the user approved as one of their own styles: it appears with the presets in the Style ' +
          'menu of every book ("Your styles"). Preview it first. Returns its id for apply_book_style. ' +
          STYLE_RULES,
        input: z.object({
          name: z.string().trim().min(1).max(100).describe('Short name, e.g. "Wedding: ivory, sage and gold"'),
          description: z.string().trim().max(500).describe('One sentence on what it looks like'),
          style,
        }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            const saved = await this.styles.create(ctx.auth, input, ctx.activity);
            const { warnings } = checkBookStyle(saved.style);
            return toolJson({
              id: saved.id,
              name: saved.name,
              style: saved.style,
              ...(warnings.length > 0 && { warnings }),
            });
          }),
      }),

      defineTool({
        name: 'apply_book_style',
        title: 'Apply a style to a book',
        description:
          "Replace the style of a book with a copy of one of the user's styles (styleId) or a built-in preset. " +
          'Later changes to the saved style do not change the book. Look at the result with render_book.',
        input: z.object({
          bookId: z.uuidv4().describe('Book ID'),
          styleId: z.uuidv4().optional().describe('ID of a style from save_book_style or list_book_styles'),
          preset: BookStylePresetSchema.optional(),
        }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            if (Boolean(input.styleId) === Boolean(input.preset)) {
              return toolError('Pass either a styleId or a preset');
            }
            const book = await this.books.update(
              ctx.auth,
              input.bookId,
              { styleId: input.styleId, stylePreset: input.preset },
              ctx.activity,
            );
            return toolJson({ bookId: book.id, style: book.style, next: 'render_book to look at the result' });
          }),
      }),
    ];
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`Book style tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}

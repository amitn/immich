import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { BaseService } from 'src/services/base.service.js';
import { BookDraftService } from 'src/services/book-draft.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';

const bookId = z.uuidv4().describe('Book ID of the draft, as list_book_drafts returns it');

/**
 * The books drafted for the user in the background (see `BookDraftService`): listing them is read-only; keeping and
 * discarding one changes the user's books, so the user approves it.
 */
@Injectable()
export class BookDraftAgentTools extends BaseService {
  private draftService?: BookDraftService;

  private get drafts() {
    this.draftService ??= BaseService.create(BookDraftService, this);
    return this.draftService;
  }

  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'list_book_drafts',
        title: 'List suggested books',
        description:
          'List the photo books Immich drafted for the user in the background, waiting for them to keep or discard: ' +
          'a year of a collection ("2026 in food", "Museums we visited in 2025"), a trip, or the year before a ' +
          'birthday. Each has its bookId, title, the reason it was suggested and its page count. Use it when the ' +
          'user asks which books were made for them. get_book, render_book and review_book work on drafts; to ' +
          'improve one, call edit_existing_book first.',
        input: z.object({}),
        mutating: false,
        handler: (ctx) =>
          this.run(async () => {
            const drafts = await this.drafts.getDrafts(ctx.auth);
            return toolJson({
              drafts: drafts.map((draft) => ({
                bookId: draft.book.id,
                title: draft.book.title,
                ...(draft.book.subtitle && { subtitle: draft.book.subtitle }),
                kind: draft.kind,
                reason: draft.reason,
                pageCount: draft.book.pageCount,
                draftedAt: draft.createdAt,
              })),
              ...(drafts.length === 0 && {
                note: 'No suggested books are waiting. They are drafted every night when there is enough material.',
              }),
            });
          }),
      }),

      defineTool({
        name: 'keep_book_draft',
        title: 'Keep a suggested book',
        description:
          'Keep a book drafted for the user: it becomes one of their photo books. Only when the user asks to keep it.',
        input: z.object({ bookId }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            const book = await this.drafts.keep(ctx.auth, input.bookId);
            return toolJson({ bookId: book.id, title: book.title, status: book.status });
          }),
      }),

      defineTool({
        name: 'discard_book_draft',
        title: 'Discard a suggested book',
        description:
          'Discard a book drafted for the user: it is deleted and never suggested again. Only when the user asks to ' +
          'discard it.',
        input: z.object({ bookId }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            await this.drafts.discard(ctx.auth, input.bookId);
            return toolJson({ bookId: input.bookId, discarded: true });
          }),
      }),
    ];
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`Book draft tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}

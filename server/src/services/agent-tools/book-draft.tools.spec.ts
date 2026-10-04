import { BadRequestException } from '@nestjs/common';
import { mapBook } from 'src/dtos/book.dto.js';
import { BookDraftKind, BookStatus } from 'src/enum.js';
import { BookDraftAgentTools } from 'src/services/agent-tools/book-draft.tools.js';
import { BookDraftService } from 'src/services/book-draft.service.js';
import { AgentTool, AgentToolContext } from 'src/utils/agent/tools.js';
import { BookFactory } from 'test/factories/book.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newTestService } from 'test/utils.js';

const text = (result: Awaited<ReturnType<AgentTool['handler']>>) =>
  result.content.find((item) => item.type === 'text')?.text ?? '';

describe(BookDraftAgentTools.name, () => {
  let tools: Map<string, AgentTool>;
  const ctx: AgentToolContext = { auth: authStub.admin, sessionId: 'session-1' };

  const call = (name: string, input: Record<string, unknown> = {}) => tools.get(name)!.handler(ctx, input as never);

  beforeEach(() => {
    const { sut } = newTestService(BookDraftAgentTools);
    tools = new Map(sut.getTools().map((tool) => [tool.name, tool]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should list the drafts read-only, and keep and discard them with approval', () => {
    expect(tools.get('list_book_drafts')?.mutating).toBe(false);
    expect(tools.get('keep_book_draft')?.mutating).toBe(true);
    expect(tools.get('discard_book_draft')?.mutating).toBe(true);
  });

  describe('list_book_drafts', () => {
    it('should list the drafts with the reason they were suggested', async () => {
      const book = BookFactory.create({
        status: BookStatus.Draft,
        title: '2025 in food',
        subtitle: null,
        pageCount: 24,
      });
      const createdAt = new Date('2026-09-27T01:00:00.000Z');
      vi.spyOn(BookDraftService.prototype, 'getDrafts').mockResolvedValue([
        {
          id: 'draft-1',
          key: 'food:2025',
          kind: BookDraftKind.Yearly,
          reason: 'You visited 6 restaurants in 2025 and photographed 54 dishes',
          memoryId: null,
          createdAt,
          book: mapBook(book),
        },
      ]);

      const result = await call('list_book_drafts');

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(text(result))).toEqual({
        drafts: [
          {
            bookId: book.id,
            title: '2025 in food',
            kind: 'yearly',
            reason: 'You visited 6 restaurants in 2025 and photographed 54 dishes',
            pageCount: 24,
            draftedAt: createdAt.toISOString(),
          },
        ],
      });
    });

    it('should say when there are none', async () => {
      vi.spyOn(BookDraftService.prototype, 'getDrafts').mockResolvedValue([]);
      const result = JSON.parse(text(await call('list_book_drafts')));
      expect(result.drafts).toEqual([]);
      expect(result.note).toContain('every night');
    });
  });

  describe('keep_book_draft', () => {
    it('should keep the draft', async () => {
      const book = BookFactory.create({ title: 'Our trip to Rome' });
      const keep = vi.spyOn(BookDraftService.prototype, 'keep').mockResolvedValue(mapBook(book));

      const result = await call('keep_book_draft', { bookId: book.id });

      expect(keep).toHaveBeenCalledWith(ctx.auth, book.id, undefined);
      expect(JSON.parse(text(result))).toEqual({ bookId: book.id, title: 'Our trip to Rome', status: 'active' });
    });

    it('should report a book that is not a draft', async () => {
      vi.spyOn(BookDraftService.prototype, 'keep').mockRejectedValue(
        new BadRequestException('The book is not a draft'),
      );
      const result = await call('keep_book_draft', { bookId: BookFactory.create().id });
      expect(result.isError).toBe(true);
      expect(text(result)).toBe('The book is not a draft');
    });
  });

  describe('discard_book_draft', () => {
    it('should discard the draft', async () => {
      const discard = vi.spyOn(BookDraftService.prototype, 'discard').mockResolvedValue();
      const { id } = BookFactory.create();

      const result = await call('discard_book_draft', { bookId: id });

      expect(discard).toHaveBeenCalledWith(ctx.auth, id, undefined);
      expect(JSON.parse(text(result))).toEqual({ bookId: id, discarded: true });
    });
  });
});

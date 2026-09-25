import { BookAgentTools } from 'src/services/agent-tools/book.tools.js';
import { AgentTool, AgentToolContext } from 'src/utils/agent/tools.js';
import { BookFactory, BookPageFactory } from 'test/factories/book.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const text = (result: Awaited<ReturnType<AgentTool['handler']>>) =>
  result.content.find((item) => item.type === 'text')?.text ?? '';

describe(BookAgentTools.name, () => {
  let sut: BookAgentTools;
  let mocks: ServiceMocks;
  let tools: Map<string, AgentTool>;
  let ctx: AgentToolContext;

  const call = (name: string, input: Record<string, unknown>) => tools.get(name)!.handler(ctx, input as never);

  const setupBook = (pageCount = 2) => {
    const book = BookFactory.create({ ownerId: authStub.admin.user.id, pageCount });
    const pages = Array.from({ length: pageCount }, (_, position) =>
      BookPageFactory.create({ bookId: book.id, position, layout: 'two-vertical' }),
    );
    mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
    mocks.book.get.mockResolvedValue(book);
    mocks.book.getPages.mockResolvedValue(pages);
    mocks.book.getPage.mockImplementation((_, pageId) => Promise.resolve(pages.find((page) => page.id === pageId)));
    return { book, pages };
  };

  const createBook = async () => {
    const { book, pages } = setupBook();
    mocks.book.create.mockResolvedValue(book);
    await call('create_book', { title: book.title });
    return { book, pages };
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BookAgentTools));
    tools = new Map(sut.getTools().map((tool) => [tool.name, tool]));
    ctx = { auth: authStub.admin, sessionId: newUuid() };

    mocks.book.upsertSlot.mockResolvedValue();
    mocks.book.removePage.mockResolvedValue();
    mocks.book.setExportStatus.mockResolvedValue();
  });

  it('should define the book tools', () => {
    expect(tools.keys().toArray()).toEqual(
      expect.arrayContaining([
        'list_layouts',
        'create_book',
        'get_book',
        'add_page',
        'remove_page',
        'move_page',
        'set_page_layout',
        'place_photo',
        'clear_slot',
        'set_caption',
        'set_book_style',
        'update_book',
        'render_page',
        'render_book',
        'export_pdf',
      ]),
    );
  });

  it('should only require approval for exports and for editing books the agent did not create', () => {
    const mutating = tools
      .values()
      .filter((tool) => tool.mutating)
      .map((tool) => tool.name)
      .toArray();
    expect(mutating.toSorted()).toEqual(['edit_existing_book', 'export_pdf']);
  });

  describe('list_layouts', () => {
    it('should return slot aspect ratios', async () => {
      const result = JSON.parse(text(await call('list_layouts', {})));
      expect(result.layouts).toEqual(
        expect.arrayContaining([
          { id: 'four-grid', description: expect.any(String), slots: 4, aspects: [1, 1, 1, 1], orientation: 'any' },
        ]),
      );
    });
  });

  describe('editing', () => {
    it('should refuse to edit books that were not created in the session', async () => {
      const { book } = setupBook();

      const result = await call('add_page', { bookId: book.id, layout: 'single' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('edit_existing_book');
      expect(mocks.book.addPage).not.toHaveBeenCalled();
    });

    it('should allow editing after edit_existing_book', async () => {
      const { book } = setupBook();
      mocks.book.addPage.mockResolvedValue(BookPageFactory.create({ bookId: book.id, layout: 'single' }));

      await call('edit_existing_book', { bookId: book.id });
      const result = await call('add_page', { bookId: book.id, layout: 'single' });

      expect(result.isError).toBeUndefined();
      expect(mocks.book.addPage).toHaveBeenCalled();
    });

    it('should not share approvals between sessions', async () => {
      const { book } = await createBook();

      ctx = { ...ctx, sessionId: newUuid() };
      const result = await call('remove_page', { bookId: book.id, page: 1 });
      expect(result.isError).toBe(true);
    });
  });

  describe('add_page', () => {
    it('should convert the page number and fill the slots', async () => {
      const { book } = await createBook();
      const page = BookPageFactory.create({ bookId: book.id, layout: 'two-vertical', position: 0 });
      const [first, second] = [newUuid(), newUuid()];
      mocks.book.addPage.mockResolvedValue(page);
      mocks.book.getPage.mockResolvedValue(page);
      mocks.access.asset.checkOwnerAccess.mockImplementation((_, ids) => Promise.resolve(new Set(ids)));
      mocks.book.getAssetsForRender.mockImplementation(([id]) =>
        Promise.resolve([{ id, isEdited: false, width: 0, height: 0 } as never]),
      );
      mocks.book.getFaces.mockResolvedValue([]);

      const result = await call('add_page', {
        bookId: book.id,
        layout: 'two-vertical',
        position: 1,
        assetIds: [first, second],
      });

      expect(result.isError).toBeUndefined();
      expect(mocks.book.addPage).toHaveBeenCalledWith(book.id, expect.objectContaining({ layout: 'two-vertical' }), 0);
      // without known dimensions the whole photo is used
      const crop = { x: 0, y: 0, width: 1, height: 1 };
      expect(mocks.book.upsertSlot).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ slot: 0, assetId: first, crop }),
      );
      expect(mocks.book.upsertSlot).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ slot: 1, assetId: second, crop }),
      );
    });

    it('should report missing assets', async () => {
      const { book } = await createBook();
      const assetId = newUuid();
      mocks.book.addPage.mockResolvedValue(BookPageFactory.create({ bookId: book.id, layout: 'single' }));
      mocks.book.getPage.mockResolvedValue(BookPageFactory.create({ bookId: book.id, layout: 'single' }));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.book.getAssetsForRender.mockResolvedValue([]);

      const result = await call('add_page', { bookId: book.id, layout: 'single', assetIds: [assetId] });

      expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Asset not found' }] });
    });

    it('should reject more photos than slots', async () => {
      const { book } = await createBook();
      const result = await call('add_page', { bookId: book.id, layout: 'single', assetIds: [newUuid(), newUuid()] });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('has 1 slot(s)');
      expect(mocks.book.addPage).not.toHaveBeenCalled();
    });
  });

  describe('place_photo', () => {
    it('should resolve 1-based page and slot numbers', async () => {
      const { book, pages } = await createBook();
      const assetId = newUuid();
      const crop = { x: 0, y: 0, width: 1, height: 0.5 };
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      const result = await call('place_photo', { bookId: book.id, page: 2, slot: 2, assetId, crop });

      expect(result.isError).toBeUndefined();
      expect(mocks.book.upsertSlot).toHaveBeenCalledWith(book.id, {
        pageId: pages[1].id,
        slot: 1,
        assetId,
        crop,
        caption: null,
      });
      expect(JSON.parse(text(result))).toEqual(expect.objectContaining({ page: 2, layout: 'two-vertical' }));
    });

    it('should accept a page ID', async () => {
      const { book, pages } = await createBook();
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await call('place_photo', {
        bookId: book.id,
        page: pages[0].id,
        slot: 1,
        assetId,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      });

      expect(mocks.book.upsertSlot).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ pageId: pages[0].id, slot: 0 }),
      );
    });

    it('should report pages that do not exist', async () => {
      const { book } = await createBook();
      const result = await call('place_photo', { bookId: book.id, page: 5, slot: 1, assetId: newUuid() });
      expect(result.isError).toBe(true);
      expect(text(result)).toBe('Page 5 does not exist; the book has 2 page(s)');
    });

    it('should report invalid slots', async () => {
      const { book } = await createBook();
      const assetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      const result = await call('place_photo', { bookId: book.id, page: 1, slot: 3, assetId });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Invalid slot 2');
    });
  });

  describe('move_page', () => {
    it('should convert page numbers', async () => {
      const { book, pages } = await createBook();
      mocks.book.movePage.mockResolvedValue({ ...pages[1], position: 0 });

      const result = await call('move_page', { bookId: book.id, page: 2, toPage: 1 });

      expect(mocks.book.movePage).toHaveBeenCalledWith(book.id, pages[1].id, 0);
      expect(JSON.parse(text(result))).toEqual({ from: 2, to: 1 });
    });
  });

  describe('render_page', () => {
    it('should return the image and the warnings', async () => {
      const { book } = setupBook();
      mocks.media.composeBookPage.mockResolvedValue({ data: Buffer.from('jpeg'), slots: [] });

      const result = await call('render_page', { bookId: book.id, page: 1 });

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('Page 1, slot 1 is empty') },
        { type: 'image', data: Buffer.from('jpeg').toString('base64'), mimeType: 'image/jpeg' },
      ]);
    });
  });

  describe('export_pdf', () => {
    it('should queue the export', async () => {
      const { book } = setupBook();

      const result = JSON.parse(text(await call('export_pdf', { bookId: book.id })));

      expect(result).toEqual({ queued: true, exportStatus: 'pending', downloadPath: `/api/books/${book.id}/pdf` });
    });
  });
});

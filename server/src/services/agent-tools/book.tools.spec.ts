import { BookAgentTools } from 'src/services/agent-tools/book.tools.js';
import { BookAutoLayoutResult, BookService } from 'src/services/book.service.js';
import { AgentTool, AgentToolContext } from 'src/utils/agent/tools.js';
import { clearConfigCache } from 'src/utils/config.js';
import { BookFactory, BookPageFactory } from 'test/factories/book.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const text = (result: Awaited<ReturnType<AgentTool['handler']>>) =>
  result.content.find((item) => item.type === 'text')?.text ?? '';

const layoutResult = (bookId = newUuid()): BookAutoLayoutResult => {
  const [a, b, c, dropped] = [newUuid(), newUuid(), newUuid(), newUuid()];
  const map = { style: 'sketch' as const, showRoute: true, labels: true };
  return {
    book: {
      ...BookFactory.create({ id: bookId, title: 'Italy' }),
      style: { ...BookFactory.create().style } as never,
      pages: [],
    } as never,
    plan: {
      pages: [
        { layout: 'cover', slots: [{ assetId: a, crop: { x: 0, y: 0, width: 1, height: 1 } }] },
        { layout: 'map', slots: [], sectionTitle: 'Rome', map },
        {
          layout: 'two-vertical',
          slots: [b, c].map((assetId) => ({ assetId, crop: { x: 0, y: 0, width: 1, height: 1 } })),
        },
      ],
      sections: [{ title: 'Rome', dates: '1 June 2024', photoIds: [a, b, c], located: true }],
      usedIds: [a, b, c],
      droppedIds: [dropped],
      dropReasons: { [dropped]: 'budget' },
      people: [],
    },
    photoCount: 4,
    warnings: ['a warning'],
  };
};

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
    mocks.book.setHtmlExportStatus.mockResolvedValue();
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
        'export_html',
        'auto_layout_book',
        'add_map_page',
        'set_page_map',
        'illustrate_map',
      ]),
    );
  });

  it('should only require approval for exports and for editing books the agent did not create', () => {
    const mutating = tools
      .values()
      .filter((tool) => tool.mutating)
      .map((tool) => tool.name)
      .toArray();
    expect(mutating.toSorted()).toEqual(['edit_existing_book', 'export_html', 'export_pdf', 'illustrate_map']);
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

  describe('export_html', () => {
    it('should queue the HTML export', async () => {
      const { book } = setupBook();

      const result = JSON.parse(text(await call('export_html', { bookId: book.id })));

      expect(result).toEqual({
        queued: true,
        htmlExportStatus: 'pending',
        downloadPath: `/api/books/${book.id}/html`,
      });
      expect(mocks.book.setHtmlExportStatus).toHaveBeenCalledWith(book.id, 'pending');
      expect(mocks.book.setExportStatus).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: 'BookExportHtml', data: { id: book.id } });
    });
  });

  describe('auto_layout_book', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should need either an album or a book', async () => {
      const result = await call('auto_layout_book', {});
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/albumId.*bookId/);
    });

    it('should create a book from an album and allow editing it', async () => {
      const albumId = newUuid();
      const result = layoutResult();
      const createFromAlbum = vi.spyOn(BookService.prototype, 'createFromAlbumWithPlan').mockResolvedValue(result);

      const summary = JSON.parse(
        text(await call('auto_layout_book', { albumId, targetPageCount: 20, mapStyle: 'toner', heroAssetIds: [] })),
      );

      expect(createFromAlbum).toHaveBeenCalledWith(
        authStub.admin,
        expect.objectContaining({ albumId, targetPageCount: 20, mapStyle: 'toner' }),
      );
      expect(summary).toEqual(
        expect.objectContaining({
          bookId: result.book.id,
          photos: { considered: 4, placed: 3, leftOut: 1, leftOutBecause: { budget: 1 } },
          sections: [{ title: 'Rome', dates: '1 June 2024', photos: 3 }],
          pages: ['1: cover, 1 photo', '2: map, "Rome", sketch map', '3: two-vertical, 2 photos'],
          warnings: ['a warning'],
          next: expect.stringContaining('review_book'),
        }),
      );

      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([result.book.id]));
      mocks.book.get.mockResolvedValue(BookFactory.create({ id: result.book.id }));
      mocks.book.addPage.mockResolvedValue(BookPageFactory.create({ bookId: result.book.id }));
      const added = await call('add_page', { bookId: result.book.id, layout: 'single' });
      expect(added.isError).toBeUndefined();
    });

    it('should not lay out books that were not created in the session', async () => {
      const { book } = setupBook();
      const autoLayout = vi.spyOn(BookService.prototype, 'autoLayoutWithPlan');

      const result = await call('auto_layout_book', { bookId: book.id });
      expect(result.isError).toBe(true);
      expect(autoLayout).not.toHaveBeenCalled();
    });

    it('should lay out a book again with heroes', async () => {
      const { book } = await createBook();
      const hero = newUuid();
      const autoLayout = vi.spyOn(BookService.prototype, 'autoLayoutWithPlan').mockResolvedValue(layoutResult(book.id));

      const result = await call('auto_layout_book', { bookId: book.id, heroAssetIds: [hero], keepExisting: true });

      expect(result.isError).toBeUndefined();
      expect(autoLayout).toHaveBeenCalledWith(authStub.admin, book.id, { heroAssetIds: [hero], keepExisting: true });
    });
  });

  describe('maps', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should add a map page with the default style', async () => {
      const { book } = await createBook();
      mocks.systemMetadata.get.mockResolvedValue({
        books: { maps: { defaultStyle: 'watercolor', stadiaApiKey: 'key' } },
      });
      mocks.book.addPage.mockImplementation((bookId, values) =>
        Promise.resolve(BookPageFactory.create({ bookId, position: 2, layout: values.layout, map: values.map })),
      );

      const result = JSON.parse(text(await call('add_map_page', { bookId: book.id, position: 2, title: 'Rome' })));

      expect(mocks.book.addPage).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({
          layout: 'map',
          map: { style: 'watercolor', title: 'Rome', showRoute: true, labels: true },
        }),
        1,
      );
      expect(result).toEqual(
        expect.objectContaining({ page: 3, layout: 'map', map: { style: 'watercolor', title: 'Rome' } }),
      );
      expect(result.warnings).toBeUndefined();
    });

    it('should pick the sketch style for auto without a Stadia Maps API key', async () => {
      const { book } = await createBook();
      mocks.book.addPage.mockImplementation((bookId, values) =>
        Promise.resolve(BookPageFactory.create({ bookId, layout: values.layout, map: values.map })),
      );

      const result = JSON.parse(text(await call('add_map_page', { bookId: book.id, style: 'auto' })));

      expect(result.map).toEqual({ style: 'sketch' });
      expect(result.warnings).toBeUndefined();
    });

    it('should warn when the map style needs a Stadia Maps API key', async () => {
      const { book, pages } = await createBook();
      mocks.book.addPage.mockImplementation((bookId, values) =>
        Promise.resolve(BookPageFactory.create({ bookId, layout: values.layout, map: values.map })),
      );
      mocks.book.updatePage.mockImplementation((bookId, pageId, values) =>
        Promise.resolve(BookPageFactory.create({ ...pages[0], layout: 'map', map: values.map as never })),
      );
      const warning =
        'Watercolor maps need a Stadia Maps API key (Administration → Settings → Photo books); using the offline sketch style';

      const added = JSON.parse(text(await call('add_map_page', { bookId: book.id, style: 'watercolor' })));
      expect(added.warnings).toEqual([warning]);

      const updated = JSON.parse(text(await call('set_page_map', { bookId: book.id, page: 1, style: 'terrain' })));
      expect(updated.warnings).toEqual([warning.replace('Watercolor', 'Terrain')]);
    });

    it('should add a map with a photo', async () => {
      const { book } = await createBook();
      const photo = newUuid();
      const page = BookPageFactory.create({ bookId: book.id, layout: 'map-photo', position: 2 });
      mocks.book.addPage.mockResolvedValue(page);
      mocks.book.getPage.mockResolvedValue(page);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([photo]));
      mocks.book.getAssetsForRender.mockResolvedValue([{ id: photo, isEdited: false, width: 0, height: 0 } as never]);
      mocks.book.getFaces.mockResolvedValue([]);

      await call('add_map_page', { bookId: book.id, photoAssetId: photo, style: 'sketch', showRoute: false });

      expect(mocks.book.addPage).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ layout: 'map-photo', map: { style: 'sketch', showRoute: false, labels: true } }),
        undefined,
      );
      expect(mocks.book.upsertSlot).toHaveBeenCalledWith(book.id, expect.objectContaining({ slot: 0, assetId: photo }));
    });

    it('should switch a page without a map area to the map layout', async () => {
      const { book, pages } = await createBook();
      mocks.book.updatePage.mockResolvedValue(pages[0]);

      await call('set_page_map', { bookId: book.id, page: 1, style: 'terrain' });

      expect(mocks.book.updatePage).toHaveBeenCalledWith(
        book.id,
        pages[0].id,
        expect.objectContaining({ layout: 'map', map: { style: 'terrain', showRoute: true, labels: true } }),
        0,
      );
    });

    it('should keep the current map options', async () => {
      const { book, pages } = await createBook();
      pages[1].layout = 'map';
      pages[1].map = { style: 'toner', title: 'Old', showRoute: false, labels: true, artJobId: newUuid() };
      mocks.book.updatePage.mockResolvedValue(pages[1]);

      await call('set_page_map', { bookId: book.id, page: 2, title: 'New' });

      expect(mocks.book.updatePage).toHaveBeenCalledWith(
        book.id,
        pages[1].id,
        expect.objectContaining({ map: { style: 'toner', title: 'New', showRoute: false, labels: true } }),
        undefined,
      );
    });

    it('should remove a map', async () => {
      const { book, pages } = await createBook();
      mocks.book.updatePage.mockResolvedValue(pages[0]);

      await call('set_page_map', { bookId: book.id, page: 1, remove: true });
      expect(mocks.book.updatePage).toHaveBeenCalledWith(
        book.id,
        pages[0].id,
        expect.objectContaining({ map: null }),
        undefined,
      );
    });

    it('should start an illustration', async () => {
      const { book, pages } = await createBook();
      const illustrate = vi.spyOn(BookService.prototype, 'illustratePageMap').mockResolvedValue({
        ...pages[0],
        slots: [],
        map: { style: 'sketch', showRoute: true, labels: true, artJobId: newUuid() },
      } as never);

      const result = JSON.parse(text(await call('illustrate_map', { bookId: book.id, page: 1 })));

      expect(illustrate).toHaveBeenCalledWith(authStub.admin, book.id, pages[0].id);
      expect(result.map).toEqual({ style: 'sketch', illustrated: 'started' });
    });

    it('should illustrate every map page that is not illustrated yet', async () => {
      const { book, pages } = await createBook();
      const map = { style: 'sketch' as const, showRoute: true, labels: true };
      const mapPages = [
        BookPageFactory.create({ bookId: book.id, position: 2, layout: 'map', map }),
        BookPageFactory.create({ bookId: book.id, position: 3, layout: 'map-photo', map }),
        BookPageFactory.create({ bookId: book.id, position: 4, layout: 'map', map: { ...map, artJobId: newUuid() } }),
      ];
      mocks.book.getPages.mockResolvedValue([...pages, ...mapPages]);
      const illustrate = vi.spyOn(BookService.prototype, 'illustratePageMap').mockResolvedValue({} as never);

      const result = JSON.parse(text(await call('illustrate_map', { bookId: book.id })));

      expect(illustrate.mock.calls.map((args) => args[2])).toEqual([mapPages[0].id, mapPages[1].id]);
      expect(result.started).toEqual([3, 4]);
    });
  });

  describe('style presets and layout options', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      clearConfigCache();
    });

    it('should apply a style preset', async () => {
      const { book } = await createBook();
      const update = vi.spyOn(BookService.prototype, 'update').mockResolvedValue({ style: {} } as never);

      await call('set_book_style', { bookId: book.id, preset: 'soft', captionSizePt: 11 });

      expect(update).toHaveBeenCalledWith(authStub.admin, book.id, {
        style: { captionSizePt: 11 },
        stylePreset: 'soft',
      });
    });

    it('should pass the preset and the layout options to the automatic layout', async () => {
      const albumId = newUuid();
      const createFromAlbum = vi
        .spyOn(BookService.prototype, 'createFromAlbumWithPlan')
        .mockResolvedValue(layoutResult());

      await call('auto_layout_book', {
        albumId,
        stylePreset: 'bold',
        captions: 'people',
        maxArtworkShare: 0.1,
        maxStackPairs: 1,
      });

      expect(createFromAlbum).toHaveBeenCalledWith(
        authStub.admin,
        expect.objectContaining({
          albumId,
          stylePreset: 'bold',
          captions: 'people',
          maxArtworkShare: 0.1,
          maxStackPairs: 1,
        }),
      );
    });

    it('should explain how to start illustrated maps', async () => {
      clearConfigCache();
      vi.spyOn(BookService.prototype, 'createFromAlbumWithPlan').mockResolvedValue(layoutResult());
      const without = JSON.parse(text(await call('auto_layout_book', { albumId: newUuid(), illustratedMaps: true })));
      expect(without.illustratedMaps).toMatch(/art agent profile/);

      mocks.systemMetadata.get.mockResolvedValue({
        agent: { enabled: true, artProfile: 'codex', profiles: [{ name: 'codex', command: 'codex-acp' }] },
      });
      clearConfigCache();
      const summary = JSON.parse(text(await call('auto_layout_book', { albumId: newUuid(), illustratedMaps: true })));
      expect(summary.next).toMatch(/^Call illustrate_map/);
    });

    it('should list the style presets with the layouts', async () => {
      const result = JSON.parse(text(await call('list_layouts', {})));
      expect(result.stylePresets.map(({ id }: { id: string }) => id)).toEqual(['classic', 'soft', 'bold']);
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import {
  AssetFileType,
  AssetType,
  BookExportFormat,
  BookExportStatus,
  JobName,
  JobStatus,
  NotificationType,
} from 'src/enum.js';
import { BookService, getBookHtmlPath, getBookPdfPath } from 'src/services/book.service.js';
import { ImmichFileResponse } from 'src/utils/file.js';
import { BookFactory, BookPageFactory } from 'test/factories/book.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { userStub } from 'test/fixtures/user.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const renderAsset = (dto: Record<string, unknown> = {}) => ({
  id: newUuid(),
  type: AssetType.Image,
  originalPath: '/data/library/photo.jpg',
  originalFileName: 'photo.jpg',
  isEdited: false,
  localDateTime: new Date('2025-06-01T10:00:00.000Z'),
  width: 3000,
  height: 2000,
  exifImageWidth: 3000,
  exifImageHeight: 2000,
  orientation: null,
  files: [
    { type: AssetFileType.Preview, path: '/data/thumbs/preview.jpeg', isEdited: false },
    { type: AssetFileType.Thumbnail, path: '/data/thumbs/thumbnail.webp', isEdited: false },
  ],
  ...dto,
});

describe(BookService.name, () => {
  let sut: BookService;
  let mocks: ServiceMocks;
  const auth = authStub.admin;

  const allowBook = (id: string) => mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([id]));
  const allowAssets = (...ids: string[]) => mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(ids));
  const written = () => ({ html: (mocks.storage.createOrOverwriteFile.mock.calls[0][1] as Buffer).toString() });

  const setupSlot = (layout = 'four-grid') => {
    const book = BookFactory.create();
    const page = BookPageFactory.create({ bookId: book.id, layout });
    const asset = renderAsset();
    allowBook(book.id);
    allowAssets(asset.id);
    mocks.book.get.mockResolvedValue(book);
    mocks.book.getPage.mockResolvedValue(page);
    mocks.book.getAssetsForRender.mockResolvedValue([asset]);
    mocks.book.getFaces.mockResolvedValue([]);
    return { book, page, asset };
  };

  const setupExport = async () => {
    const asset = renderAsset();
    const book = BookFactory.create({ ownerId: userStub.admin.id, pageCount: 2 });
    const pages = [
      BookPageFactory.create({
        bookId: book.id,
        position: 0,
        assets: [BookPageFactory.placement({ slot: 0, assetId: asset.id })],
      }),
      BookPageFactory.create({ bookId: book.id, position: 1 }),
    ];
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff0000' } })
      .jpeg()
      .toBuffer();

    mocks.book.get.mockResolvedValue(book);
    mocks.book.getPages.mockResolvedValue(pages);
    mocks.user.get.mockResolvedValue(userStub.admin);
    allowAssets(asset.id);
    mocks.book.getAssetsForRender.mockResolvedValue([asset]);
    mocks.media.composeBookPage.mockResolvedValue({ data: jpeg, slots: [{ width: 3000, height: 2000 }] });
    mocks.notification.create.mockResolvedValue({ id: newUuid() } as never);
    return { book, asset };
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BookService));

    mocks.book.update.mockResolvedValue();
    mocks.book.delete.mockResolvedValue();
    mocks.book.removePage.mockResolvedValue();
    mocks.book.upsertSlot.mockResolvedValue();
    mocks.book.updateSlot.mockResolvedValue(true);
    mocks.book.deleteSlot.mockResolvedValue();
    mocks.book.setExportStatus.mockResolvedValue();
    mocks.book.setHtmlExportStatus.mockResolvedValue();
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getLayouts', () => {
    it('should list the layouts', () => {
      expect(sut.getLayouts()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'four-grid', slots: expect.any(Array) })]),
      );
    });
  });

  describe('getAll', () => {
    it('should list the books of the user', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id, pageCount: 3 });
      mocks.book.getAll.mockResolvedValue([book]);

      await expect(sut.getAll(auth)).resolves.toEqual([expect.objectContaining({ id: book.id, pageCount: 3 })]);
      expect(mocks.book.getAll).toHaveBeenCalledWith(auth.user.id);
    });
  });

  describe('get', () => {
    it('should require access', async () => {
      await expect(sut.get(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.get).not.toHaveBeenCalled();
    });

    it('should return the pages with their slots', async () => {
      const book = BookFactory.create();
      const assetId = newUuid();
      const page = BookPageFactory.create({
        bookId: book.id,
        layout: 'two-vertical',
        assets: [BookPageFactory.placement({ slot: 1, assetId })],
      });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([page]);

      const result = await sut.get(auth, book.id);
      expect(result.pageCount).toBe(1);
      expect(result.firstPageId).toBe(page.id);
      expect(result.pages[0].slots).toEqual([
        { slot: 0, aspectRatio: expect.any(Number), assetId: null, crop: null, caption: null },
        { slot: 1, aspectRatio: expect.any(Number), assetId, crop: null, caption: null },
      ]);
    });
  });

  describe('create', () => {
    it('should create a book with the default size and style', async () => {
      mocks.book.create.mockImplementation((book) =>
        Promise.resolve(BookFactory.create({ ...(book as object), id: newUuid() } as never)),
      );

      await sut.create(auth, { title: 'Italy' });

      expect(mocks.book.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: auth.user.id,
          title: 'Italy',
          pageWidthMm: 210,
          pageHeightMm: 210,
          style: expect.objectContaining({ marginMm: 12, gutterMm: 4, titleSizePt: 28 }),
        }),
      );
    });

    it('should require access to the album', async () => {
      await expect(sut.create(auth, { title: 'Italy', albumId: newUuid() })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.book.create).not.toHaveBeenCalled();
    });

    it('should reject margins that do not fit the page', async () => {
      await expect(
        sut.create(auth, { title: 'Tiny', pageWidthMm: 60, pageHeightMm: 60, style: { marginMm: 25 } }),
      ).rejects.toThrow(/too large/);
    });
  });

  describe('update', () => {
    it('should merge the style', async () => {
      const book = BookFactory.create();
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([]);

      await sut.update(auth, book.id, { style: { gutterMm: 1 } });

      expect(mocks.book.update).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ style: expect.objectContaining({ gutterMm: 1, marginMm: 12 }) }),
      );
    });

    it('should require access to the cover asset', async () => {
      const book = BookFactory.create();
      allowBook(book.id);

      await expect(sut.update(auth, book.id, { coverAssetId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete the book and its exported files', async () => {
      const book = BookFactory.create({
        exportPath: '/data/thumbs/owner/books/old.pdf',
        htmlExportPath: '/data/thumbs/owner/books/old.html',
      });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await sut.delete(auth, book.id);

      expect(mocks.book.delete).toHaveBeenCalledWith(book.id);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: {
          files: [
            getBookPdfPath(book),
            '/data/thumbs/owner/books/old.pdf',
            getBookHtmlPath(book),
            '/data/thumbs/owner/books/old.html',
          ],
        },
      });
    });

    it('should require access', async () => {
      await expect(sut.delete(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.delete).not.toHaveBeenCalled();
    });
  });

  describe('addPage', () => {
    it('should reject unknown layouts', async () => {
      const book = BookFactory.create();
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.addPage(auth, book.id, { layout: 'nope' })).rejects.toThrow(/Unknown layout/);
      expect(mocks.book.addPage).not.toHaveBeenCalled();
    });

    it('should insert the page at the position', async () => {
      const book = BookFactory.create();
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.addPage.mockResolvedValue(BookPageFactory.create({ bookId: book.id, layout: 'four-grid' }));

      const page = await sut.addPage(auth, book.id, { layout: 'four-grid', position: 2, caption: 'Hi' });

      expect(page.slots).toHaveLength(4);
      expect(mocks.book.addPage).toHaveBeenCalledWith(
        book.id,
        { layout: 'four-grid', sectionTitle: null, caption: 'Hi', background: null },
        2,
      );
    });
  });

  describe('updatePage', () => {
    it('should drop the slots the new layout does not have', async () => {
      const book = BookFactory.create();
      const page = BookPageFactory.create({ bookId: book.id, layout: 'four-grid' });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPage.mockResolvedValue(page);
      mocks.book.updatePage.mockResolvedValue({ ...page, layout: 'two-vertical' });

      await sut.updatePage(auth, book.id, page.id, { layout: 'two-vertical' });

      expect(mocks.book.updatePage).toHaveBeenCalledWith(
        book.id,
        page.id,
        expect.objectContaining({ layout: 'two-vertical' }),
        2,
      );
    });

    it('should keep the slots when the layout does not change', async () => {
      const book = BookFactory.create();
      const page = BookPageFactory.create({ bookId: book.id, layout: 'four-grid' });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPage.mockResolvedValue(page);
      mocks.book.updatePage.mockResolvedValue(page);

      await sut.updatePage(auth, book.id, page.id, { caption: 'New' });

      expect(mocks.book.updatePage).toHaveBeenCalledWith(
        book.id,
        page.id,
        expect.objectContaining({ caption: 'New' }),
        undefined,
      );
    });

    it('should reject pages of another book', async () => {
      const book = BookFactory.create();
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPage.mockResolvedValue(undefined);

      await expect(sut.updatePage(auth, book.id, newUuid(), { caption: 'x' })).rejects.toThrow('Page not found');
    });
  });

  describe('movePage', () => {
    it('should move the page', async () => {
      const book = BookFactory.create();
      const page = BookPageFactory.create({ bookId: book.id, position: 3 });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.movePage.mockResolvedValue({ ...page, position: 0 });

      await expect(sut.movePage(auth, book.id, page.id, { position: 0 })).resolves.toEqual(
        expect.objectContaining({ id: page.id, position: 0 }),
      );
      expect(mocks.book.movePage).toHaveBeenCalledWith(book.id, page.id, 0);
    });

    it('should require access', async () => {
      await expect(sut.movePage(auth, newUuid(), newUuid(), { position: 0 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.book.movePage).not.toHaveBeenCalled();
    });
  });

  describe('removePage', () => {
    it('should remove the page', async () => {
      const book = BookFactory.create();
      const page = BookPageFactory.create({ bookId: book.id });
      allowBook(book.id);
      mocks.book.getPage.mockResolvedValue(page);

      await sut.removePage(auth, book.id, page.id);
      expect(mocks.book.removePage).toHaveBeenCalledWith(book.id, page.id);
    });
  });

  describe('setSlot', () => {
    it('should require access to the asset', async () => {
      const { book, page } = setupSlot();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.setSlot(auth, book.id, page.id, 0, { assetId: newUuid() })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.book.upsertSlot).not.toHaveBeenCalled();
    });

    it('should reject slots the layout does not have', async () => {
      const { book, page, asset } = setupSlot('two-vertical');

      await expect(sut.setSlot(auth, book.id, page.id, 2, { assetId: asset.id })).rejects.toThrow(
        'Invalid slot 2 for layout "two-vertical", which has 2 slot(s) (0-1)',
      );
      expect(mocks.book.upsertSlot).not.toHaveBeenCalled();
    });

    it('should reject layouts without slots', async () => {
      const { book, page, asset } = setupSlot('text');

      await expect(sut.setSlot(auth, book.id, page.id, 0, { assetId: asset.id })).rejects.toThrow(
        'Layout "text" has no photo slots',
      );
    });

    it('should choose a default crop for the slot', async () => {
      const { book, page, asset } = setupSlot('four-grid');

      await sut.setSlot(auth, book.id, page.id, 1, { assetId: asset.id });

      // a 3:2 photo in a square slot
      expect(mocks.book.upsertSlot).toHaveBeenCalledWith(book.id, {
        pageId: page.id,
        slot: 1,
        assetId: asset.id,
        crop: { x: 0.1667, y: 0, width: 0.6667, height: 1 },
        caption: null,
      });
    });

    it('should keep the faces in the default crop', async () => {
      const { book, page, asset } = setupSlot('four-grid');
      mocks.book.getFaces.mockResolvedValue([
        {
          assetId: asset.id,
          imageWidth: 1500,
          imageHeight: 1000,
          boundingBoxX1: 1300,
          boundingBoxY1: 300,
          boundingBoxX2: 1450,
          boundingBoxY2: 500,
        },
      ]);

      await sut.setSlot(auth, book.id, page.id, 0, { assetId: asset.id });

      const { crop } = mocks.book.upsertSlot.mock.calls[0][1];
      expect(crop).toEqual({ x: 0.3333, y: 0, width: 0.6667, height: 1 });
    });

    it('should use the given crop', async () => {
      const { book, page, asset } = setupSlot('four-grid');
      const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };

      await sut.setSlot(auth, book.id, page.id, 3, { assetId: asset.id, crop, caption: 'Hello' });

      expect(mocks.book.upsertSlot).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ slot: 3, crop, caption: 'Hello' }),
      );
      expect(mocks.book.getAssetsForRender).not.toHaveBeenCalled();
    });
  });

  describe('updateSlot', () => {
    it('should reject empty slots', async () => {
      const book = BookFactory.create();
      const page = BookPageFactory.create({ bookId: book.id, layout: 'single' });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPage.mockResolvedValue(page);

      await expect(sut.updateSlot(auth, book.id, page.id, 0, { caption: 'x' })).rejects.toThrow('Slot 0 is empty');
    });

    it('should update the caption', async () => {
      const book = BookFactory.create();
      const page = BookPageFactory.create({
        bookId: book.id,
        layout: 'single',
        assets: [BookPageFactory.placement({ slot: 0 })],
      });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPage.mockResolvedValue(page);

      await sut.updateSlot(auth, book.id, page.id, 0, { caption: 'x' });
      expect(mocks.book.updateSlot).toHaveBeenCalledWith(book.id, page.id, 0, { crop: undefined, caption: 'x' });
    });
  });

  describe('clearSlot', () => {
    it('should validate the slot', async () => {
      const book = BookFactory.create();
      const page = BookPageFactory.create({ bookId: book.id, layout: 'single' });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPage.mockResolvedValue(page);

      await expect(sut.clearSlot(auth, book.id, page.id, 1)).rejects.toBeInstanceOf(BadRequestException);
      await sut.clearSlot(auth, book.id, page.id, 0);
      expect(mocks.book.deleteSlot).toHaveBeenCalledWith(book.id, page.id, 0);
    });
  });

  describe('renderPage', () => {
    it('should render from the preview files and skip inaccessible assets', async () => {
      const book = BookFactory.create();
      const visible = renderAsset();
      const hidden = newUuid();
      const page = BookPageFactory.create({
        bookId: book.id,
        layout: 'two-vertical',
        assets: [
          BookPageFactory.placement({ slot: 0, assetId: visible.id }),
          BookPageFactory.placement({ slot: 1, assetId: hidden }),
        ],
      });
      allowBook(book.id);
      allowAssets(visible.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([page]);
      mocks.book.getAssetsForRender.mockResolvedValue([visible]);
      mocks.media.composeBookPage.mockResolvedValue({ data: Buffer.from('jpeg'), slots: [] });

      const { data, warnings } = await sut.renderPage(auth, book.id, page.id, { size: 1200 });

      expect(data).toEqual(Buffer.from('jpeg'));
      expect(mocks.book.getAssetsForRender).toHaveBeenCalledWith([visible.id]);
      const spec = mocks.media.composeBookPage.mock.calls[0][0];
      expect(spec.width).toBe(1200);
      expect(spec.slots[0]).toEqual(expect.objectContaining({ input: '/data/thumbs/preview.jpeg' }));
      expect(spec.slots[1]).toBeNull();
      expect(warnings).toEqual([expect.objectContaining({ page: 1, slot: 2, type: 'missing-asset' })]);
    });

    it('should require access', async () => {
      await expect(sut.renderPage(auth, newUuid(), newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.media.composeBookPage).not.toHaveBeenCalled();
    });
  });

  describe('renderContactSheet', () => {
    it('should render every page and compose a sheet', async () => {
      const book = BookFactory.create();
      const pages = [0, 1, 2].map((position) => BookPageFactory.create({ bookId: book.id, position }));
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue(pages);
      mocks.media.composeBookPage.mockResolvedValue({ data: Buffer.from('jpeg'), slots: [] });

      const result = await sut.renderContactSheet(auth, book.id, { from: 2 });

      expect(result.pages).toEqual([2, 3]);
      expect(mocks.media.composeBookPage).toHaveBeenCalledTimes(3);
      expect(result.warnings).toEqual([
        expect.objectContaining({ page: 2, type: 'empty-slot' }),
        expect.objectContaining({ page: 3, type: 'empty-slot' }),
      ]);
    });
  });

  describe('export', () => {
    it('should queue the export', async () => {
      const book = BookFactory.create({ pageCount: 2 });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.export(auth, book.id)).resolves.toEqual(
        expect.objectContaining({ exportStatus: BookExportStatus.Pending }),
      );
      expect(mocks.book.setExportStatus).toHaveBeenCalledWith(book.id, BookExportStatus.Pending);
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.BookExport, data: { id: book.id } });
    });

    it('should not queue twice', async () => {
      const book = BookFactory.create({ pageCount: 2, exportStatus: BookExportStatus.Pending });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await sut.export(auth, book.id);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should reject empty books', async () => {
      const book = BookFactory.create({ pageCount: 0 });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.export(auth, book.id)).rejects.toThrow('The book has no pages');
      await expect(sut.export(auth, book.id, { format: BookExportFormat.Html })).rejects.toThrow(
        'The book has no pages',
      );
    });

    it('should queue the HTML export separately from the PDF', async () => {
      const book = BookFactory.create({ pageCount: 2, exportStatus: BookExportStatus.Pending });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.export(auth, book.id, { format: BookExportFormat.Html })).resolves.toEqual(
        expect.objectContaining({ exportStatus: BookExportStatus.Pending, htmlExportStatus: BookExportStatus.Pending }),
      );
      expect(mocks.book.setHtmlExportStatus).toHaveBeenCalledWith(book.id, BookExportStatus.Pending);
      expect(mocks.book.setExportStatus).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.BookExportHtml, data: { id: book.id } });
    });

    it('should not queue the HTML export twice', async () => {
      const book = BookFactory.create({ pageCount: 2, htmlExportStatus: BookExportStatus.Pending });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await sut.export(auth, book.id, { format: BookExportFormat.Html });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should require download access', async () => {
      await expect(sut.export(auth, newUuid(), { format: BookExportFormat.Html })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('downloadHtml', () => {
    it('should reject books that were not exported as HTML', async () => {
      const book = BookFactory.create({ exportPath: '/data/thumbs/books/book.pdf' });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.downloadHtml(auth, book.id)).rejects.toThrow('The book has not been exported as HTML yet');
    });

    it('should return the HTML file as an attachment', async () => {
      const book = BookFactory.create({ title: 'Été à Rome / 2025', htmlExportPath: '/data/thumbs/books/book.html' });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.downloadHtml(auth, book.id)).resolves.toEqual(
        new ImmichFileResponse({
          path: '/data/thumbs/books/book.html',
          contentType: 'text/html',
          cacheControl: 'private_without_cache' as never,
          fileName: 'ete-a-rome-2025.html',
          disposition: 'attachment',
        }),
      );
    });
  });

  describe('downloadPdf', () => {
    it('should reject books that were not exported', async () => {
      const book = BookFactory.create();
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.downloadPdf(auth, book.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should return the PDF', async () => {
      const book = BookFactory.create({ title: 'Rome/Florence', exportPath: '/data/thumbs/books/book.pdf' });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.downloadPdf(auth, book.id)).resolves.toEqual(
        new ImmichFileResponse({
          path: '/data/thumbs/books/book.pdf',
          contentType: 'application/pdf',
          cacheControl: 'private_without_cache' as never,
          fileName: 'Rome_Florence.pdf',
        }),
      );
    });
  });

  describe('handleBookExport', () => {
    it('should write the PDF and notify the owner', async () => {
      const { book } = await setupExport();
      const path = getBookPdfPath(book);

      await expect(sut.handleBookExport({ id: book.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.book.setExportStatus).toHaveBeenNthCalledWith(1, book.id, BookExportStatus.Running);
      expect(mocks.book.setExportStatus).toHaveBeenNthCalledWith(2, book.id, BookExportStatus.Completed, path);
      expect(mocks.media.composeBookPage).toHaveBeenCalledTimes(2);
      const spec = mocks.media.composeBookPage.mock.calls[0][0];
      expect(spec.width).toBe(2480);
      // the original is web-supported, so it is printed from the original
      expect(spec.slots[0]).toEqual(expect.objectContaining({ input: '/data/library/photo.jpg' }));
      expect(mocks.storage.createOrOverwriteFile).toHaveBeenCalledWith(`${path}.tmp`, expect.any(Buffer));
      expect(mocks.storage.rename).toHaveBeenCalledWith(`${path}.tmp`, path);
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: book.ownerId, type: NotificationType.Custom }),
      );
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith('on_notification', book.ownerId, expect.anything());
    });

    it('should print RAW files from the fullsize image', async () => {
      const { book, asset } = await setupExport();
      mocks.book.getAssetsForRender.mockResolvedValue([
        {
          ...asset,
          originalFileName: 'photo.cr2',
          files: [
            ...asset.files,
            { type: AssetFileType.FullSize, path: '/data/thumbs/fullsize.jpeg', isEdited: false },
          ],
        },
      ]);

      await sut.handleBookExport({ id: book.id });

      const spec = mocks.media.composeBookPage.mock.calls[0][0];
      expect(spec.slots[0]).toEqual(expect.objectContaining({ input: '/data/thumbs/fullsize.jpeg' }));
    });

    it('should mark the export as failed', async () => {
      const { book } = await setupExport();
      mocks.media.composeBookPage.mockRejectedValue(new Error('boom'));

      await expect(sut.handleBookExport({ id: book.id })).resolves.toBe(JobStatus.Failed);
      expect(mocks.book.setExportStatus).toHaveBeenLastCalledWith(book.id, BookExportStatus.Failed);
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it('should skip deleted books', async () => {
      mocks.book.get.mockResolvedValue(undefined);
      await expect(sut.handleBookExport({ id: newUuid() })).resolves.toBe(JobStatus.Skipped);
    });
  });

  describe('handleBookExportHtml', () => {
    it('should write the HTML file and notify the owner', async () => {
      const { book } = await setupExport();
      const path = getBookHtmlPath(book);

      await expect(sut.handleBookExportHtml({ id: book.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.book.setHtmlExportStatus).toHaveBeenNthCalledWith(1, book.id, BookExportStatus.Running);
      expect(mocks.book.setHtmlExportStatus).toHaveBeenNthCalledWith(2, book.id, BookExportStatus.Completed, path);
      expect(mocks.book.setExportStatus).not.toHaveBeenCalled();
      expect(mocks.storage.rename).toHaveBeenCalledWith(`${path}.tmp`, path);

      const { html } = written();
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('data:image/jpeg;base64,');
      expect(html.match(/<section class="page"/g)).toHaveLength(2);
      expect(html).toContain('June 1, 2025');
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: book.ownerId, type: NotificationType.Custom, title: 'Web photo book ready' }),
      );
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith('on_notification', book.ownerId, expect.anything());
    });

    it('should embed a screen-sized image of the visible crop', async () => {
      const { book } = await setupExport();

      await sut.handleBookExportHtml({ id: book.id });

      // one embedded photo, and nothing rendered for the empty page
      expect(mocks.media.composeBookPage).toHaveBeenCalledTimes(1);
      const spec = mocks.media.composeBookPage.mock.calls[0][0];
      // a 3:2 photo in the square content box of a single layout: the centre 2/3 of the width is visible
      expect(spec.slots[0]!.crop).toEqual({
        x: expect.closeTo(1 / 6, 6),
        y: 0,
        width: expect.closeTo(2 / 3, 6),
        height: 1,
      });
      // 2× the CSS size of the slot (186 of 210mm, on a 1000px page) is more than the 1440px preview has
      expect(spec.slots[0]).toEqual(expect.objectContaining({ input: '/data/library/photo.jpg' }));
      expect(spec.width).toBe(1771);
      expect(spec.height).toBe(1771);
      expect(spec.quality).toBe(82);
    });

    it('should use the preview for smaller slots', async () => {
      const { book, asset } = await setupExport();
      mocks.book.getPages.mockResolvedValue([
        BookPageFactory.create({
          bookId: book.id,
          layout: 'four-grid',
          assets: [BookPageFactory.placement({ slot: 0, assetId: asset.id })],
        }),
      ]);

      await sut.handleBookExportHtml({ id: book.id });

      const spec = mocks.media.composeBookPage.mock.calls[0][0];
      expect(spec.slots[0]).toEqual(expect.objectContaining({ input: '/data/thumbs/preview.jpeg' }));
      // a 91mm slot: 2 × 91/210 × 1000px
      expect(spec.width).toBe(867);
      expect(spec.height).toBe(867);
    });

    it('should use the original when a photo is shown larger than its preview', async () => {
      const { book, asset } = await setupExport();
      mocks.book.getAssetsForRender.mockResolvedValue([{ ...asset, width: 8000, height: 1000 }]);
      mocks.book.getPages.mockResolvedValue([
        BookPageFactory.create({
          bookId: book.id,
          layout: 'full-bleed',
          assets: [
            BookPageFactory.placement({ slot: 0, assetId: asset.id, crop: { x: 0, y: 0, width: 0.125, height: 1 } }),
          ],
        }),
      ]);

      await sut.handleBookExportHtml({ id: book.id });

      const spec = mocks.media.composeBookPage.mock.calls[0][0];
      expect(spec.slots[0]).toEqual(expect.objectContaining({ input: '/data/library/photo.jpg' }));
      expect(spec.width).toBe(1000);
      expect(spec.height).toBe(1000);
    });

    it('should render map pages as one image', async () => {
      const { book, asset } = await setupExport();
      mocks.book.getPages.mockResolvedValue([
        BookPageFactory.create({ bookId: book.id, layout: 'map', sectionTitle: 'Our route' }),
        BookPageFactory.create({
          bookId: book.id,
          position: 1,
          assets: [BookPageFactory.placement({ slot: 0, assetId: asset.id })],
        }),
      ]);

      await sut.handleBookExportHtml({ id: book.id });

      expect(mocks.media.composeBookPage).toHaveBeenCalledTimes(2);
      expect(mocks.media.composeBookPage.mock.calls.map(([spec]) => spec.width)).toContain(2000);
      expect(written().html).toContain('class="page-image"');
      expect(written().html).toContain('alt="Our route"');
    });

    it('should skip photos the owner can no longer access', async () => {
      const { book } = await setupExport();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.book.getAssetsForRender.mockResolvedValue([]);

      await expect(sut.handleBookExportHtml({ id: book.id })).resolves.toBe(JobStatus.Success);
      expect(mocks.book.getAssetsForRender).toHaveBeenCalledWith([]);
      expect(mocks.media.composeBookPage).not.toHaveBeenCalled();
      expect(written().html).not.toContain('data:image/jpeg');
    });

    it('should mark the export as failed', async () => {
      const { book } = await setupExport();
      mocks.media.composeBookPage.mockRejectedValue(new Error('boom'));

      await expect(sut.handleBookExportHtml({ id: book.id })).resolves.toBe(JobStatus.Failed);
      expect(mocks.book.setHtmlExportStatus).toHaveBeenLastCalledWith(book.id, BookExportStatus.Failed);
      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Photo book export failed' }),
      );
    });

    it('should skip deleted books', async () => {
      mocks.book.get.mockResolvedValue(undefined);
      await expect(sut.handleBookExportHtml({ id: newUuid() })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.book.setHtmlExportStatus).not.toHaveBeenCalled();
    });
  });
});

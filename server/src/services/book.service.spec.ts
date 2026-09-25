import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { BookMap, BookStyleSchema } from 'src/dtos/book.dto.js';
import {
  ArtJobStatus,
  AssetFileType,
  AssetType,
  BookExportFormat,
  BookExportStatus,
  JobName,
  JobStatus,
  NotificationType,
} from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { ArtService } from 'src/services/art.service.js';
import { BookService, getBookHtmlPath, getBookPdfPath } from 'src/services/book.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { validatePageStyle } from 'src/utils/book/layouts.js';
import { ImmichFileResponse } from 'src/utils/file.js';
import { BookFactory, BookPageFactory } from 'test/factories/book.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { userStub } from 'test/fixtures/user.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

type AgentAsset = Awaited<ReturnType<AssetJobRepository['getForAgent']>>[number];

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

const agentAsset = (overrides: Partial<AgentAsset> = {}): AgentAsset => {
  const time = overrides.localDateTime ?? new Date('2024-06-01T10:00:00.000Z');
  return {
    id: newUuid(),
    type: AssetType.Image,
    localDateTime: time,
    fileCreatedAt: time,
    isFavorite: false,
    width: 3000,
    height: 2000,
    checksum: Buffer.from(newUuid()),
    updatedAt: time,
    exifImageWidth: 3000,
    exifImageHeight: 2000,
    make: null,
    model: null,
    lensModel: null,
    fNumber: null,
    exposureTime: null,
    iso: null,
    focalLength: null,
    latitude: null,
    longitude: null,
    city: null,
    state: null,
    country: null,
    description: null,
    rating: null,
    timeZone: null,
    previewPath: null,
    faces: [],
    ...overrides,
  };
};

/** a day in Rome and a day in Florence */
const trip = () => [
  ...Array.from({ length: 10 }, (_, i) =>
    agentAsset({
      localDateTime: new Date(Date.UTC(2024, 5, 1, 9, i * 10)),
      latitude: 41.9,
      longitude: 12.5,
      city: 'Rome',
      isFavorite: i === 3,
    }),
  ),
  ...Array.from({ length: 10 }, (_, i) =>
    agentAsset({
      localDateTime: new Date(Date.UTC(2024, 5, 2, 9, i * 10)),
      latitude: 43.77,
      longitude: 11.25,
      city: 'Florence',
    }),
  ),
];

const textPage = (bookId: string) => BookPageFactory.create({ bookId, layout: 'text', caption: 'Hello <world>' });

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

  const setupPhotos = (rows: AgentAsset[]) => {
    mocks.assetJob.getForAgentEvents.mockResolvedValue(
      rows.map((row) => ({
        id: row.id,
        localDateTime: row.localDateTime,
        latitude: row.latitude,
        longitude: row.longitude,
        city: row.city,
        country: row.country,
        people: [],
      })),
    );
    mocks.assetJob.getForAgent.mockResolvedValue(rows);
    mocks.book.getAssetsForRender.mockResolvedValue(
      rows.map((row) => renderAsset({ id: row.id, width: row.width, height: row.height })),
    );
    mocks.search.getEmbeddings.mockResolvedValue([]);
    mocks.book.getStackInfo.mockResolvedValue([]);
    mocks.book.replacePages.mockResolvedValue();
  };

  const plannedPages = () => mocks.book.replacePages.mock.calls[0][1];

  const setupAlbum = (rows: AgentAsset[], albumName = 'Italy 2024') => {
    const albumId = newUuid();
    const book = BookFactory.create({ ownerId: auth.user.id, albumId, title: albumName });
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.album.getById.mockResolvedValue({ id: albumId, albumName } as never);
    mocks.book.create.mockResolvedValue(book);
    mocks.book.get.mockResolvedValue(book);
    mocks.book.getPages.mockResolvedValue([]);
    setupPhotos(rows);
    return { albumId, book };
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

  describe('getStylePresets', () => {
    it('should list the presets with valid styles', () => {
      const presets = sut.getStylePresets();
      expect(presets.map(({ id }) => id)).toEqual(['classic', 'soft', 'bold']);
      expect(presets[0].style).toEqual(
        expect.objectContaining({ marginMm: 12, background: '#ffffff', fontFamily: 'serif' }),
      );
      expect(presets[1].style).toEqual(
        expect.objectContaining({ marginMm: 18, background: '#f6f1e7', textColor: '#5b4636', fontFamily: 'serif' }),
      );
      expect(presets[2].style.gutterMm).toBeGreaterThanOrEqual(2);
      expect(presets[2].style.gutterMm).toBeLessThanOrEqual(3);
      expect(presets[2].style.fontFamily).toBe('sans-serif');
      for (const { style } of presets) {
        expect(BookStyleSchema.parse(style)).toEqual(style);
        expect(validatePageStyle({ pageWidthMm: 150, pageHeightMm: 150 }, style)).toBeNull();
      }
    });
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

    it('should start from a style preset and apply the style on top', async () => {
      mocks.book.create.mockImplementation((book) =>
        Promise.resolve(BookFactory.create({ ...(book as object), id: newUuid() } as never)),
      );

      await sut.create(auth, { title: 'Ride', stylePreset: 'soft', style: { captionSizePt: 11 } });

      expect(mocks.book.create).toHaveBeenCalledWith(
        expect.objectContaining({
          style: {
            marginMm: 18,
            gutterMm: 5,
            background: '#f6f1e7',
            textColor: '#5b4636',
            fontFamily: 'serif',
            titleSizePt: 28,
            captionSizePt: 11,
          },
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

    it('should replace the style with a preset', async () => {
      const book = BookFactory.create({ style: { marginMm: 20, background: '#000000' } as never });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([]);

      await sut.update(auth, book.id, { stylePreset: 'bold' });

      expect(mocks.book.update).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({
          style: expect.objectContaining({
            marginMm: 6,
            gutterMm: 2.5,
            background: '#ffffff',
            fontFamily: 'sans-serif',
          }),
        }),
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
        { layout: 'four-grid', sectionTitle: null, caption: 'Hi', background: null, map: null },
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

    it('should queue a pending export again, so a lost job cannot block the book', async () => {
      const book = BookFactory.create({ pageCount: 2, exportStatus: BookExportStatus.Pending });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await sut.export(auth, book.id);
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.BookExport, data: { id: book.id } });
    });

    it('should report exports that are older than the last change', async () => {
      const exportedAt = new Date('2026-01-01T10:00:00Z');
      const book = BookFactory.create({
        pageCount: 2,
        exportStatus: BookExportStatus.Completed,
        exportedAt,
        htmlExportStatus: BookExportStatus.Completed,
        htmlExportedAt: new Date('2026-01-01T12:00:00Z'),
        contentUpdatedAt: new Date('2026-01-01T11:00:00Z'),
      });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([]);

      await expect(sut.get(auth, book.id)).resolves.toMatchObject({
        exportedAt,
        exportStale: true,
        htmlExportStale: false,
      });
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

    it('should queue a pending HTML export again', async () => {
      const book = BookFactory.create({ pageCount: 2, htmlExportStatus: BookExportStatus.Pending });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await sut.export(auth, book.id, { format: BookExportFormat.Html });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.BookExportHtml, data: { id: book.id } });
    });

    it('should require download access', async () => {
      await expect(sut.export(auth, newUuid(), { format: BookExportFormat.Html })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('previewHtml', () => {
    it('should require access to the book', async () => {
      await expect(sut.previewHtml(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.getPages).not.toHaveBeenCalled();
    });

    it('should reject books without pages', async () => {
      const book = BookFactory.create({ pageCount: 0 });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(sut.previewHtml(auth, book.id)).rejects.toThrow('The book has no pages');
    });

    it('should build the HTML book and reuse it until the content changes', async () => {
      const book = BookFactory.create({ pageCount: 1, contentUpdatedAt: new Date('2026-01-01T10:00:00Z') });
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([textPage(book.id)]);
      mocks.book.getAssetsForRender.mockResolvedValue([]);

      const html = await sut.previewHtml(auth, book.id);
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toContain('Hello &lt;world&gt;');

      await expect(sut.previewHtml(auth, book.id)).resolves.toBe(html);
      expect(mocks.book.getPages).toHaveBeenCalledTimes(1);

      mocks.book.get.mockResolvedValue({ ...book, contentUpdatedAt: new Date('2026-01-01T11:00:00Z') });
      await sut.previewHtml(auth, book.id);
      expect(mocks.book.getPages).toHaveBeenCalledTimes(2);
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

  describe('auto layout', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('createFromAlbum', () => {
      it('should require access to the album', async () => {
        await expect(sut.createFromAlbum(auth, { albumId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.book.create).not.toHaveBeenCalled();
      });

      it('should create a book named after the album and lay out its photos', async () => {
        const rows = trip();
        const video = agentAsset({ type: AssetType.Video });
        const { albumId, book } = setupAlbum([...rows, video]);

        const result = await sut.createFromAlbum(auth, { albumId, mapStyle: 'sketch', targetPageCount: 8 });

        expect(result.id).toBe(book.id);
        expect(mocks.book.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Italy 2024', albumId }));
        expect(mocks.assetJob.getForAgentEvents).toHaveBeenCalledWith(
          expect.objectContaining({ albumId, viewingUserId: auth.user.id }),
        );
        expect(mocks.book.replacePages).toHaveBeenCalledWith(book.id, expect.any(Array), { keepExisting: undefined });

        const pages = plannedPages();
        expect(pages[0]).toEqual(expect.objectContaining({ layout: 'cover', map: null }));
        expect(pages.filter((page) => page.map)).toEqual([
          expect.objectContaining({ sectionTitle: 'Rome', map: expect.objectContaining({ style: 'sketch' }) }),
          expect.objectContaining({ sectionTitle: 'Florence', map: expect.objectContaining({ style: 'sketch' }) }),
        ]);
        const placed = pages.flatMap((page) => page.assets.map((asset) => asset.assetId));
        expect(placed).not.toContain(video.id);
        expect(new Set(placed).size).toBe(placed.length);
        for (const page of pages) {
          expect(page.assets.map((asset) => asset.slot)).toEqual(page.assets.map((_, index) => index));
          for (const asset of page.assets) {
            expect(asset.crop).toEqual(expect.objectContaining({ x: expect.any(Number), width: expect.any(Number) }));
          }
        }
      });

      it('should use the title from the request and the default map style from the config', async () => {
        const { albumId } = setupAlbum(trip());
        mocks.systemMetadata.get.mockResolvedValue({ books: { maps: { defaultStyle: 'toner', stadiaApiKey: 'key' } } });

        await sut.createFromAlbum(auth, { albumId, title: 'Our trip' });

        expect(mocks.book.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Our trip' }));
        const styles = plannedPages()
          .filter((page) => page.map)
          .map((page) => page.map!.style);
        expect(styles.length).toBeGreaterThan(0);
        expect(new Set(styles)).toEqual(new Set(['toner']));
      });

      it('should warn when the map style needs a Stadia Maps API key', async () => {
        const { albumId } = setupAlbum(trip());

        const result = await sut.createFromAlbum(auth, { albumId, mapStyle: 'watercolor' });

        expect(result.warnings).toEqual([
          'Watercolor maps need a Stadia Maps API key (Administration → Settings → Photo books); using the offline sketch style',
        ]);
        expect(plannedPages().find((page) => page.map)?.map?.style).toBe('watercolor');
      });

      it('should pick a map style that works for auto', async () => {
        const { albumId } = setupAlbum(trip());

        const result = await sut.createFromAlbum(auth, { albumId, mapStyle: 'auto' });

        expect(result.warnings).toEqual([]);
        const styles = plannedPages()
          .filter((page) => page.map)
          .map((page) => page.map!.style);
        expect(new Set(styles)).toEqual(new Set(['sketch']));
      });

      it('should not add maps when they are turned off', async () => {
        const { albumId } = setupAlbum(trip());
        await sut.createFromAlbum(auth, { albumId, includeMaps: false });
        expect(plannedPages().some((page) => page.map)).toBe(false);
      });

      it('should score the photos from their previews and cache the analysis', async () => {
        const rows = trip().map((row) => ({ ...row, previewPath: `/data/thumbs/${row.id}.jpeg` }));
        const { albumId } = setupAlbum(rows);
        mocks.media.analyzeImage.mockResolvedValue({
          width: 512,
          height: 341,
          laplacianVariance: 800,
          meanLuma: 0.5,
          shadowClip: 0,
          highlightClip: 0,
          colorfulness: 40,
          contrast: 0.2,
          saturation: 0.3,
          focusX: 0.4,
          focusY: 0.4,
        });

        await sut.createFromAlbum(auth, { albumId });
        expect(mocks.media.analyzeImage).toHaveBeenCalledTimes(rows.length);

        await sut.createFromAlbum(auth, { albumId });
        expect(mocks.media.analyzeImage).toHaveBeenCalledTimes(rows.length);
      });

      it('should place one photo per stack, pairing an artwork with its original', async () => {
        const rows = trip();
        const [original, crop, artwork] = [rows[4], rows[5], rows[6]];
        const { albumId } = setupAlbum(rows);
        mocks.book.getStackInfo.mockResolvedValue([
          { id: original.id, stackId: 'stack', isPrimary: true, isArtwork: false, originalFileName: 'IMG_1.jpg' },
          { id: crop.id, stackId: 'stack', isPrimary: false, isArtwork: false, originalFileName: 'IMG_1-crop.jpg' },
          { id: artwork.id, stackId: 'stack', isPrimary: false, isArtwork: true, originalFileName: 'IMG_1-art.png' },
        ]);

        const { plan } = await sut.createFromAlbumWithPlan(auth, { albumId });
        expect(plan.dropReasons).toEqual({ [crop.id]: 'stack' });

        expect(mocks.book.getStackInfo).toHaveBeenCalledWith(expect.arrayContaining([original.id, artwork.id]));
        const pages = plannedPages();
        const placed = pages.flatMap((page) => page.assets.map((asset) => asset.assetId));
        expect(placed).not.toContain(crop.id);
        const pair = pages.find((page) => page.assets.some((asset) => asset.assetId === artwork.id))!;
        expect(pair.assets.map((asset) => asset.assetId).toSorted()).toEqual([original.id, artwork.id].toSorted());
      });

      it('should delete the book when there is nothing to lay out', async () => {
        const { albumId, book } = setupAlbum([agentAsset({ type: AssetType.Video })]);

        await expect(sut.createFromAlbum(auth, { albumId })).rejects.toThrow('There are no photos to lay out');
        expect(mocks.book.delete).toHaveBeenCalledWith(book.id);
        expect(mocks.book.replacePages).not.toHaveBeenCalled();
      });

      it('should reject an empty album', async () => {
        const { albumId } = setupAlbum([]);
        await expect(sut.createFromAlbum(auth, { albumId })).rejects.toThrow('The album has no photos');
        expect(mocks.book.create).not.toHaveBeenCalled();
      });
    });

    describe('autoLayout', () => {
      it('should require access to the book', async () => {
        await expect(sut.autoLayout(auth, newUuid(), {})).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.book.replacePages).not.toHaveBeenCalled();
      });

      it('should need photos when the book has no album', async () => {
        const book = BookFactory.create();
        allowBook(book.id);
        mocks.book.get.mockResolvedValue(book);

        await expect(sut.autoLayout(auth, book.id, {})).rejects.toThrow(/assetIds/);
      });

      it('should require access to the photos', async () => {
        const book = BookFactory.create();
        allowBook(book.id);
        mocks.book.get.mockResolvedValue(book);

        await expect(sut.autoLayout(auth, book.id, { assetIds: [newUuid()] })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });

      it('should lay out the album of the book again', async () => {
        const rows = trip();
        const { book } = setupAlbum(rows);
        allowBook(book.id);
        const hero = rows[12];
        allowAssets(hero.id);

        await sut.autoLayout(auth, book.id, { heroAssetIds: [hero.id], targetPageCount: 8 });

        expect(mocks.book.replacePages).toHaveBeenCalledWith(book.id, expect.any(Array), { keepExisting: undefined });
        const heroPage = plannedPages().find((page) => page.assets.some((asset) => asset.assetId === hero.id))!;
        expect(heroPage.assets).toHaveLength(1);
      });

      it('should append the photos that are not in the book yet without a cover', async () => {
        const rows = trip();
        const book = BookFactory.create();
        allowBook(book.id);
        allowAssets(...rows.map(({ id }) => id));
        mocks.book.get.mockResolvedValue(book);
        mocks.book.getPages.mockResolvedValue([
          BookPageFactory.create({
            bookId: book.id,
            layout: 'cover',
            assets: [BookPageFactory.placement({ assetId: rows[0].id })],
          }),
        ]);
        setupPhotos(rows);

        await sut.autoLayout(auth, book.id, { assetIds: rows.map(({ id }) => id), keepExisting: true });

        expect(mocks.book.replacePages).toHaveBeenCalledWith(book.id, expect.any(Array), { keepExisting: true });
        expect(mocks.assetJob.getForAgent).toHaveBeenCalledWith(
          rows.slice(1).map(({ id }) => id),
          auth.user.id,
        );
        expect(plannedPages()[0].layout).not.toBe('cover');
      });

      it('should skip illustrated maps without an art profile', async () => {
        const { book } = setupAlbum(trip());
        allowBook(book.id);

        const { warnings } = await sut.autoLayoutWithPlan(auth, book.id, { illustratedMaps: true, mapStyle: 'sketch' });

        expect(warnings).toEqual([expect.stringMatching(/art agent profile/)]);
        expect(plannedPages().every((page) => !page.map?.artJobId)).toBe(true);
      });

      it('should start an art job for every map', async () => {
        const rows = trip();
        const { book } = setupAlbum(rows);
        allowBook(book.id);
        mocks.systemMetadata.get.mockResolvedValue({ agent: { enabled: true, artProfile: 'codex' } });
        const derived = vi
          .spyOn(DerivedAssetService.prototype, 'createDerivedAsset')
          .mockResolvedValue({ id: newUuid(), duplicate: false });
        const jobIds = [newUuid(), newUuid()];
        const createJob = vi
          .spyOn(ArtService.prototype, 'createJob')
          .mockResolvedValueOnce({ id: jobIds[0] } as never)
          .mockResolvedValueOnce({ id: jobIds[1] } as never);

        const { warnings } = await sut.autoLayoutWithPlan(auth, book.id, {
          illustratedMaps: true,
          mapStyle: 'sketch',
          targetPageCount: 8,
        });

        expect(warnings).toEqual([]);
        expect(derived).toHaveBeenCalledTimes(2);
        expect(derived).toHaveBeenCalledWith(
          auth,
          expect.any(String),
          { buffer: expect.any(Buffer), extension: 'png' },
          expect.objectContaining({ stack: false }),
        );
        // the map is saved next to the first photo of its section
        expect(rows.slice(0, 10).map(({ id }) => id)).toContain(derived.mock.calls[0][1]);
        expect(createJob).toHaveBeenCalledWith(auth, {
          assetId: expect.any(String),
          prompt: expect.stringContaining('Keep the geography, the route line, the pins and the place names'),
        });
        expect(
          plannedPages()
            .filter((page) => page.map)
            .map((page) => page.map!.artJobId),
        ).toEqual(jobIds);
      });
    });
  });

  describe('maps', () => {
    const setupMapPage = (map: BookMap | null, layout = 'map') => {
      const book = BookFactory.create();
      const photo = renderAsset();
      const mapPage = BookPageFactory.create({ bookId: book.id, layout, map, position: 0 });
      const next = BookPageFactory.create({
        bookId: book.id,
        layout: 'single',
        position: 1,
        assets: [BookPageFactory.placement({ assetId: photo.id })],
      });
      const opener = BookPageFactory.create({
        bookId: book.id,
        layout: 'section-opener',
        position: 2,
        assets: [BookPageFactory.placement({ assetId: newUuid() })],
      });
      allowBook(book.id);
      allowAssets(photo.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([mapPage, next, opener]);
      mocks.book.getAssetsForRender.mockResolvedValue([photo]);
      mocks.book.getAssetLocations.mockResolvedValue([
        { id: photo.id, localDateTime: new Date(), latitude: 41.9, longitude: 12.5, city: 'Rome', country: 'Italy' },
      ]);
      mocks.book.getCountryOutlines.mockResolvedValue([]);
      mocks.media.composeBookPage.mockResolvedValue({ data: Buffer.from('jpeg'), slots: [] });
      return { book, mapPage, photo };
    };

    const sketch: BookMap = { style: 'sketch', showRoute: true, labels: true, title: 'Rome' };

    it('should draw the map of the following section in the map area', async () => {
      const { book, mapPage, photo } = setupMapPage(sketch);

      const { warnings } = await sut.renderPage(auth, book.id, mapPage.id, { size: 600 });

      expect(warnings).toEqual([]);
      expect(mocks.book.getAssetLocations).toHaveBeenCalledWith([photo.id]);
      const spec = mocks.media.composeBookPage.mock.calls[0][0];
      const layer = spec.slots.at(-1)!;
      expect(layer).toEqual(expect.objectContaining({ input: expect.any(Buffer), left: expect.any(Number) }));
      await expect(sharp(layer.input as Buffer).metadata()).resolves.toEqual(
        expect.objectContaining({ width: layer.width, height: layer.height }),
      );
    });

    it('should plot the photos chosen for the map', async () => {
      const chosen = newUuid();
      const { book, mapPage } = setupMapPage({ ...sketch, assetIds: [chosen] });
      allowAssets(chosen);

      await sut.renderPage(auth, book.id, mapPage.id, { size: 400 });
      expect(mocks.book.getAssetLocations).toHaveBeenCalledWith([chosen]);
    });

    it('should draw a sketch and warn without a Stadia API key', async () => {
      const { book, mapPage } = setupMapPage({ ...sketch, style: 'watercolor' });

      const { warnings } = await sut.renderPage(auth, book.id, mapPage.id, { size: 400 });
      expect(warnings).toEqual([
        expect.objectContaining({ page: 1, type: 'map', message: expect.stringMatching(/Stadia Maps API key/) }),
      ]);
    });

    it('should warn about a map on a layout without a map area', async () => {
      const { book, mapPage } = setupMapPage(sketch, 'single');

      const { warnings } = await sut.renderPage(auth, book.id, mapPage.id, { size: 400 });
      expect(warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'map', message: expect.stringMatching(/no map area/) }),
        ]),
      );
      expect(mocks.book.getAssetLocations).not.toHaveBeenCalled();
    });

    it('should use the illustrated map once its art job completed', async () => {
      const artJobId = newUuid();
      const dir = await mkdtemp(join(tmpdir(), 'book-map-'));
      const path = join(dir, 'map-art.png');
      await writeFile(
        path,
        await sharp({ create: { width: 30, height: 20, channels: 3, background: '#ff0000' } })
          .png()
          .toBuffer(),
      );
      const illustrated = renderAsset({ originalPath: path, files: [] });
      const { book, mapPage, photo } = setupMapPage({ ...sketch, artJobId });
      allowAssets(photo.id, illustrated.id);
      mocks.access.artJob.checkOwnerAccess.mockResolvedValue(new Set([artJobId]));
      mocks.artJob.get.mockResolvedValue({
        id: artJobId,
        status: ArtJobStatus.Completed,
        resultAssetId: illustrated.id,
      } as never);
      mocks.book.getAssetsForRender.mockResolvedValue([illustrated]);
      mocks.book.updatePage.mockResolvedValue(mapPage);

      try {
        const result = await sut.renderPageMap(auth, book, mapPage, { width: 60, height: 40 });

        expect(result).toEqual({ data: expect.any(Buffer), source: 'illustrated', warnings: [] });
        const { data } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
        expect(data[0]).toBeGreaterThan(240);
        expect(mocks.book.getAssetLocations).not.toHaveBeenCalled();
        expect(mocks.book.updatePage).toHaveBeenCalledWith(book.id, mapPage.id, {
          map: { ...sketch, artJobId, illustratedAssetId: illustrated.id },
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should render the map while the illustration is running', async () => {
      const artJobId = newUuid();
      const { book, mapPage } = setupMapPage({ ...sketch, artJobId });
      mocks.access.artJob.checkOwnerAccess.mockResolvedValue(new Set([artJobId]));
      mocks.artJob.get.mockResolvedValue({ id: artJobId, status: ArtJobStatus.Running } as never);

      const result = await sut.renderPageMap(auth, book, mapPage, { width: 60, height: 40 });
      expect(result.source).toBe('sketch');
      expect(result.warnings).toEqual([expect.stringMatching(/still being drawn/)]);
      expect(mocks.book.updatePage).not.toHaveBeenCalled();
    });

    it('should check access to the map photos when a page is added', async () => {
      const book = BookFactory.create();
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);

      await expect(
        sut.addPage(auth, book.id, { layout: 'map', map: { ...sketch, assetIds: [newUuid()] } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.addPage).not.toHaveBeenCalled();
    });

    it('should save the map of a new page', async () => {
      const book = BookFactory.create();
      allowBook(book.id);
      mocks.book.get.mockResolvedValue(book);
      mocks.book.addPage.mockResolvedValue(BookPageFactory.create({ bookId: book.id, layout: 'map', map: sketch }));

      const page = await sut.addPage(auth, book.id, { layout: 'map', map: sketch });

      expect(page.map).toEqual(sketch);
      expect(mocks.book.addPage).toHaveBeenCalledWith(book.id, expect.objectContaining({ map: sketch }), undefined);
    });

    it('should list the map layouts with their map area', () => {
      expect(sut.getLayouts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'map', slots: [], mapArea: { x: 0, y: 0, width: 1, height: 1 } }),
          expect.objectContaining({ id: 'map-photo', slots: [expect.any(Object)] }),
        ]),
      );
    });
  });
});

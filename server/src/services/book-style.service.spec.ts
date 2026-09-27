import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { bookStylePresets, defaultBookStyle } from 'src/dtos/book.dto.js';
import { AssetFileType, AssetType } from 'src/enum.js';
import { BookStyleService, planSamplePages } from 'src/services/book-style.service.js';
import { BookService } from 'src/services/book.service.js';
import { BookFactory, BookPageFactory } from 'test/factories/book.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newDate, newUuid, newUuidV7 } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const styleRow = (dto: Record<string, unknown> = {}) => ({
  id: newUuid(),
  ownerId: authStub.admin.user.id,
  name: 'Wedding',
  description: 'Ivory, sage and gold',
  style: { ...defaultBookStyle, background: '#f7f3e8', textColor: '#34402f', accentColor: '#a8862f' },
  createdAt: newDate(),
  updatedAt: newDate(),
  updateId: newUuidV7(),
  ...dto,
});

const renderAsset = (id = newUuid()) => ({
  id,
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
    { type: AssetFileType.Preview, path: `/data/thumbs/${id}-preview.jpeg`, isEdited: false },
    { type: AssetFileType.Thumbnail, path: `/data/thumbs/${id}-thumbnail.webp`, isEdited: false },
  ],
});

describe(BookStyleService.name, () => {
  let sut: BookStyleService;
  let mocks: ServiceMocks;
  const auth = authStub.admin;

  const allowStyle = (id: string) => mocks.access.bookStyle.checkOwnerAccess.mockResolvedValue(new Set([id]));
  const allowAssets = (...ids: string[]) => mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(ids));

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BookStyleService));
    // no travel documents
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.tag.getAssetTagValues.mockResolvedValue([]);
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getAll', () => {
    it('should list the styles of the user', async () => {
      mocks.book.getStyles.mockResolvedValue([styleRow()]);
      await expect(sut.getAll(auth)).resolves.toEqual([
        expect.objectContaining({ name: 'Wedding', style: expect.objectContaining({ background: '#f7f3e8' }) }),
      ]);
      expect(mocks.book.getStyles).toHaveBeenCalledWith(auth.user.id);
    });
  });

  describe('create', () => {
    it('should save the style over the classic preset', async () => {
      mocks.book.createStyle.mockImplementation((values) => Promise.resolve(styleRow(values as never)));

      await sut.create(auth, {
        name: 'Night',
        style: { background: '#1b1b1f', textColor: '#f2efe8', accentColor: '#c9a24a' },
      });

      expect(mocks.book.createStyle).toHaveBeenCalledWith({
        ownerId: auth.user.id,
        name: 'Night',
        description: '',
        style: { ...defaultBookStyle, background: '#1b1b1f', textColor: '#f2efe8', accentColor: '#c9a24a' },
      });
    });

    it('should refuse an unreadable style', async () => {
      await expect(
        sut.create(auth, { name: 'Grey', style: { background: '#777777', textColor: '#888888' } }),
      ).rejects.toThrow("can't be read");
      expect(mocks.book.createStyle).not.toHaveBeenCalled();
    });

    it('should refuse a font that does not render', async () => {
      await expect(sut.create(auth, { name: 'Fancy', style: { fontFamily: 'Papyrus' } })).rejects.toThrow(
        'not available',
      );
    });
  });

  describe('update', () => {
    it('should require ownership', async () => {
      await expect(sut.update(auth, newUuid(), { name: 'Mine now' })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.updateStyle).not.toHaveBeenCalled();
    });

    it('should rename a style without touching it', async () => {
      const row = styleRow();
      allowStyle(row.id);
      mocks.book.getStyle.mockResolvedValue(row);
      mocks.book.updateStyle.mockResolvedValue({ ...row, name: 'Our wedding' });

      await sut.update(auth, row.id, { name: 'Our wedding' });

      expect(mocks.book.updateStyle).toHaveBeenCalledWith(row.id, {
        name: 'Our wedding',
        description: undefined,
        style: undefined,
      });
    });

    it('should merge and check style changes', async () => {
      const row = styleRow();
      allowStyle(row.id);
      mocks.book.getStyle.mockResolvedValue(row);
      mocks.book.updateStyle.mockResolvedValue(row);

      await sut.update(auth, row.id, { style: { marginMm: 20 } });
      expect(mocks.book.updateStyle).toHaveBeenCalledWith(
        row.id,
        expect.objectContaining({ style: { ...row.style, marginMm: 20 } }),
      );

      await expect(sut.update(auth, row.id, { style: { textColor: '#f7f3e8' } })).rejects.toThrow("can't be read");
    });
  });

  describe('delete', () => {
    it('should require ownership', async () => {
      await expect(sut.delete(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.book.deleteStyle).not.toHaveBeenCalled();
    });

    it('should delete an own style', async () => {
      const id = newUuid();
      allowStyle(id);
      mocks.book.deleteStyle.mockResolvedValue();
      await sut.delete(auth, id);
      expect(mocks.book.deleteStyle).toHaveBeenCalledWith(id);
    });
  });

  describe('preview', () => {
    beforeEach(async () => {
      const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } })
        .jpeg()
        .toBuffer();
      mocks.media.composeBookPage.mockResolvedValue({ data: jpeg, slots: [] });
    });

    it('should render a sample book of the photos in the style', async () => {
      const assets = [renderAsset(), renderAsset(), renderAsset(), renderAsset(), renderAsset()];
      allowAssets(...assets.map(({ id }) => id));
      mocks.book.getAssetsForRender.mockResolvedValue(assets);

      const result = await sut.preview(
        auth,
        { background: '#f7f3e8', textColor: '#34402f', fontFamily: 'FreeSerif, serif' },
        { assetIds: assets.map(({ id }) => id), text: { title: 'Anna & Tom' } },
      );

      expect(result.pages).toEqual([1, 2, 3]);
      expect(result.style).toEqual(expect.objectContaining({ background: '#f7f3e8', marginMm: 12 }));
      // three pages, then the sheet of spreads
      const specs = mocks.media.composeBookPage.mock.calls.map(([spec]) => spec);
      expect(specs).toHaveLength(4);
      expect(specs[0].background).toBe('#f7f3e8');
      expect(specs[0].overlay).toContain('Anna &amp; Tom');
      expect(specs[0].overlay).toContain('FreeSerif');
      expect(specs[2].slots.filter(Boolean)).toHaveLength(3);
      expect(specs[3].slots).toHaveLength(3);
    });

    it('should render the first pages of a book in the style without changing it', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id });
      const pages = [0, 1, 2, 3].map((position) => BookPageFactory.create({ bookId: book.id, position }));
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue(pages);
      mocks.book.getAssetsForRender.mockResolvedValue([]);

      const result = await sut.preview(auth, bookStylePresets.soft.style, { bookId: book.id });

      expect(result.pages).toEqual([1, 2, 3]);
      expect(mocks.media.composeBookPage.mock.calls[0][0].background).toBe(bookStylePresets.soft.style.background);
      expect(mocks.book.update).not.toHaveBeenCalled();
    });

    it('should refuse a style with errors', async () => {
      const asset = renderAsset();
      allowAssets(asset.id);
      await expect(
        sut.preview(auth, { background: '#ffffff', textColor: '#fefefe' }, { assetIds: [asset.id] }),
      ).rejects.toThrow("can't be read");
      expect(mocks.media.composeBookPage).not.toHaveBeenCalled();
    });

    it('should require photos or a book, and access to them', async () => {
      await expect(sut.preview(auth, {}, {})).rejects.toThrow('Pass a bookId or some assetIds');
      await expect(sut.preview(auth, {}, { assetIds: [newUuid()] })).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.preview(auth, {}, { bookId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('planSamplePages', () => {
    const text = { title: 'T', subtitle: 'S', sectionTitle: 'Chapter', caption: 'Caption' };

    it('should make a cover, a chapter opener and a page of photos', () => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      const pages = planSamplePages(ids, text);
      expect(pages.map((page) => page.layout)).toEqual(['cover', 'section-opener', 'hero-top-two']);
      expect(pages[1].sectionTitle).toBe('Chapter');
      expect(pages[2].assets.map(({ assetId }) => assetId)).toEqual(['c', 'd', 'e']);
      expect(pages[2].assets[0].caption).toBe('Caption');
    });

    it('should reuse the photos when there are few', () => {
      const pages = planSamplePages(['a'], text);
      expect(pages.map((page) => page.layout)).toEqual(['cover', 'section-opener', 'single']);
      expect(pages.flatMap((page) => page.assets.map(({ assetId }) => assetId))).toEqual(['a', 'a', 'a']);
      expect(pages[2].caption).toBe('Caption');
    });
  });

  describe('getPalette', () => {
    it('should read the colours of the thumbnails', async () => {
      const asset = renderAsset();
      allowAssets(asset.id);
      mocks.book.getAssetsForRender.mockResolvedValue([asset]);
      const { data, info } = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#8a9a7b' } })
        .raw()
        .toBuffer({ resolveWithObject: true });
      mocks.media.getSmallRgb.mockResolvedValue({ data, info: info as never });

      const palette = await sut.getPalette(auth, [asset.id, asset.id]);

      expect(mocks.media.getSmallRgb).toHaveBeenCalledWith(`/data/thumbs/${asset.id}-thumbnail.webp`, 96);
      expect(palette.dominant.hex).toBe('#8a9a7b');
      expect(palette.assetIds).toEqual([asset.id]);
    });

    it('should require access to the photos', async () => {
      await expect(sut.getPalette(auth, [newUuid()])).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('BookService.update with a style of your own', () => {
  let sut: BookService;
  let mocks: ServiceMocks;
  const auth = authStub.admin;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BookService));
    mocks.book.update.mockResolvedValue();
  });

  it('should copy the style into the book', async () => {
    const book = BookFactory.create({ ownerId: auth.user.id });
    const row = styleRow();
    mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
    mocks.access.bookStyle.checkOwnerAccess.mockResolvedValue(new Set([row.id]));
    mocks.book.get.mockResolvedValue(book);
    mocks.book.getPages.mockResolvedValue([]);
    mocks.book.getStyle.mockResolvedValue(row);

    await sut.update(auth, book.id, { styleId: row.id, style: { marginMm: 15 } });

    expect(mocks.book.update).toHaveBeenCalledWith(
      book.id,
      expect.objectContaining({ style: { ...row.style, marginMm: 15 } }),
    );
  });

  it('should not apply the style of another user', async () => {
    const book = BookFactory.create({ ownerId: auth.user.id });
    mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));

    await expect(sut.update(auth, book.id, { styleId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.book.update).not.toHaveBeenCalled();
  });
});

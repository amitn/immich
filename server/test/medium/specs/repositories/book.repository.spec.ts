import { Kysely } from 'kysely';
import { defaultBookStyle } from 'src/dtos/book.dto.js';
import { AssetFileType, BookExportStatus } from 'src/enum.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(BookRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const newBook = async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const book = await sut.create({
    ownerId: user.id,
    title: 'Book',
    pageWidthMm: 210,
    pageHeightMm: 210,
    style: { ...defaultBookStyle },
  });
  return { ctx, sut, user, book };
};

const addPages = async (sut: BookRepository, bookId: string, count: number) => {
  const pages = [];
  for (let i = 0; i < count; i++) {
    pages.push(await sut.addPage(bookId, { layout: 'single', caption: `page ${i}` }));
  }
  return pages;
};

const getOrder = async (sut: BookRepository, bookId: string) => {
  const pages = await sut.getPages(bookId);
  return pages.map((page) => ({ caption: page.caption, position: page.position }));
};

describe(BookRepository.name, () => {
  it('should create and count pages', async () => {
    const { sut, book } = await newBook();
    expect(book).toEqual(expect.objectContaining({ pageCount: 0, firstPageId: null }));

    const [first] = await addPages(sut, book.id, 2);
    await expect(sut.get(book.id)).resolves.toEqual(expect.objectContaining({ pageCount: 2, firstPageId: first.id }));
  });

  it('should insert pages at a position', async () => {
    const { sut, book } = await newBook();
    await addPages(sut, book.id, 2);

    await sut.addPage(book.id, { layout: 'single', caption: 'inserted' }, 1);
    await sut.addPage(book.id, { layout: 'single', caption: 'first' }, 0);
    await sut.addPage(book.id, { layout: 'single', caption: 'last' }, 99);

    await expect(getOrder(sut, book.id)).resolves.toEqual([
      { caption: 'first', position: 0 },
      { caption: 'page 0', position: 1 },
      { caption: 'inserted', position: 2 },
      { caption: 'page 1', position: 3 },
      { caption: 'last', position: 4 },
    ]);
  });

  it('should move pages and keep the positions dense', async () => {
    const { sut, book } = await newBook();
    const pages = await addPages(sut, book.id, 4);

    await expect(sut.movePage(book.id, pages[3].id, 0)).resolves.toEqual(
      expect.objectContaining({ id: pages[3].id, position: 0 }),
    );
    await sut.movePage(book.id, pages[0].id, 10);

    await expect(getOrder(sut, book.id)).resolves.toEqual([
      { caption: 'page 3', position: 0 },
      { caption: 'page 1', position: 1 },
      { caption: 'page 2', position: 2 },
      { caption: 'page 0', position: 3 },
    ]);
  });

  it('should serialize concurrent reorders', async () => {
    const { sut, book } = await newBook();
    const pages = await addPages(sut, book.id, 6);

    await Promise.all([
      sut.movePage(book.id, pages[5].id, 0),
      sut.movePage(book.id, pages[0].id, 5),
      sut.removePage(book.id, pages[2].id),
      sut.addPage(book.id, { layout: 'single', caption: 'new' }, 1),
      sut.movePage(book.id, pages[3].id, 2),
    ]);

    const order = await getOrder(sut, book.id);
    expect(order).toHaveLength(6);
    expect(order.map((page) => page.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('should compact the positions when removing a page', async () => {
    const { sut, book } = await newBook();
    const pages = await addPages(sut, book.id, 3);

    await sut.removePage(book.id, pages[1].id);

    await expect(getOrder(sut, book.id)).resolves.toEqual([
      { caption: 'page 0', position: 0 },
      { caption: 'page 2', position: 1 },
    ]);
  });

  it('should not move or remove pages of another book', async () => {
    const { sut, book } = await newBook();
    const other = await newBook();
    const [page] = await addPages(sut, other.book.id, 1);

    await expect(sut.movePage(book.id, page.id, 0)).resolves.toBeUndefined();
    await sut.removePage(book.id, page.id);
    await expect(sut.getPages(other.book.id)).resolves.toHaveLength(1);
  });

  it('should place photos and drop the slots a new layout does not have', async () => {
    const { ctx, sut, user, book } = await newBook();
    const { asset: first } = await ctx.newAsset({ ownerId: user.id });
    const { asset: second } = await ctx.newAsset({ ownerId: user.id });
    const page = await sut.addPage(book.id, { layout: 'four-grid' });
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };

    await sut.upsertSlot(book.id, { pageId: page.id, slot: 0, assetId: first.id, crop, caption: 'one' });
    await sut.upsertSlot(book.id, { pageId: page.id, slot: 3, assetId: first.id, crop: null, caption: null });
    await sut.upsertSlot(book.id, { pageId: page.id, slot: 0, assetId: second.id, crop, caption: 'replaced' });

    await expect(sut.getPage(book.id, page.id)).resolves.toEqual(
      expect.objectContaining({
        assets: [
          { slot: 0, assetId: second.id, crop, caption: 'replaced' },
          { slot: 3, assetId: first.id, crop: null, caption: null },
        ],
      }),
    );

    await sut.updateSlot(book.id, page.id, 0, { caption: 'updated' });
    const updated = await sut.updatePage(book.id, page.id, { layout: 'two-vertical' }, 2);
    expect(updated).toEqual(
      expect.objectContaining({
        layout: 'two-vertical',
        assets: [{ slot: 0, assetId: second.id, crop, caption: 'updated' }],
      }),
    );

    await sut.deleteSlot(book.id, page.id, 0);
    await expect(sut.getPage(book.id, page.id)).resolves.toEqual(expect.objectContaining({ assets: [] }));
  });

  it('should set the export status', async () => {
    const { sut, book } = await newBook();

    await sut.setExportStatus(book.id, BookExportStatus.Completed, '/path/book.pdf');
    await sut.setExportStatus(book.id, BookExportStatus.Pending);

    await expect(sut.get(book.id)).resolves.toEqual(
      expect.objectContaining({ exportStatus: BookExportStatus.Pending, exportPath: '/path/book.pdf' }),
    );
  });

  it('should load assets and faces for rendering', async () => {
    const { ctx, sut, user } = await newBook();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: '/preview.jpeg' });
    await ctx.newAssetFace({
      assetId: asset.id,
      imageWidth: 100,
      imageHeight: 100,
      boundingBoxX1: 10,
      boundingBoxY1: 10,
      boundingBoxX2: 20,
      boundingBoxY2: 20,
    });

    const assets = await sut.getAssetsForRender([asset.id, trashed.id]);
    expect(assets).toEqual([
      expect.objectContaining({
        id: asset.id,
        files: [{ type: AssetFileType.Preview, path: '/preview.jpeg', isEdited: false }],
      }),
    ]);

    await expect(sut.getFaces([asset.id])).resolves.toEqual([
      expect.objectContaining({ assetId: asset.id, boundingBoxX1: 10, imageWidth: 100 }),
    ]);
  });

  it('should delete the pages with the book', async () => {
    const { ctx, sut, book } = await newBook();
    await addPages(sut, book.id, 2);

    await sut.delete(book.id);

    await expect(sut.get(book.id)).resolves.toBeUndefined();
    await expect(ctx.database.selectFrom('book_page').where('bookId', '=', book.id).execute()).resolves.toEqual([]);
  });
});

import { Injectable } from '@nestjs/common';
import { type Insertable, type Kysely, type Transaction, type Updateable, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { BookExportStatus } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { BookPageAssetTable } from 'src/schema/tables/book-page-asset.table.js';
import { BookPageTable } from 'src/schema/tables/book-page.table.js';
import { BookTable } from 'src/schema/tables/book.table.js';

const omitUndefined = <T extends object>(values: T) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as T;

export type BookPageValues = Omit<Insertable<BookPageTable>, 'bookId' | 'position'>;

export type BookPagePlacement = Omit<Insertable<BookPageAssetTable>, 'pageId'>;

export type BookPageWithPlacements = BookPageValues & { assets: BookPagePlacement[] };

@Injectable()
export class BookRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, title: DummyValue.STRING }] })
  create(book: Insertable<BookTable>) {
    return this.db
      .insertInto('book')
      .values(book)
      .returningAll()
      .returning([sql<number>`0`.as('pageCount'), sql<string | null>`null`.as('firstPageId')])
      .executeTakeFirstOrThrow();
  }

  private selectBooks() {
    return this.db
      .selectFrom('book')
      .selectAll('book')
      .select((eb) =>
        eb
          .selectFrom('book_page')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .whereRef('book_page.bookId', '=', 'book.id')
          .as('pageCount'),
      )
      .select((eb) =>
        eb
          .selectFrom('book_page')
          .select('book_page.id')
          .whereRef('book_page.bookId', '=', 'book.id')
          .orderBy('book_page.position', 'asc')
          .limit(1)
          .as('firstPageId'),
      );
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async get(id: string) {
    const book = await this.selectBooks().where('book.id', '=', id).executeTakeFirst();
    return book ? { ...book, pageCount: Number(book.pageCount ?? 0) } : undefined;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getAll(ownerId: string) {
    const books = await this.selectBooks()
      .where('book.ownerId', '=', ownerId)
      .orderBy('book.updatedAt', 'desc')
      .execute();
    return books.map((book) => ({ ...book, pageCount: Number(book.pageCount ?? 0) }));
  }

  @GenerateSql({ params: [DummyValue.UUID, { title: DummyValue.STRING }] })
  async update(id: string, book: Updateable<BookTable>): Promise<void> {
    const values = omitUndefined(book);
    if (Object.keys(values).length > 0) {
      await this.db.updateTable('book').set(values).where('book.id', '=', id).execute();
    }
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('book').where('book.id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, BookExportStatus.Running] })
  async setExportStatus(id: string, exportStatus: BookExportStatus | null, exportPath?: string | null): Promise<void> {
    await this.db
      .updateTable('book')
      .set({ exportStatus, ...(exportPath !== undefined && { exportPath }) })
      .where('book.id', '=', id)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, BookExportStatus.Running] })
  async setHtmlExportStatus(
    id: string,
    htmlExportStatus: BookExportStatus | null,
    htmlExportPath?: string | null,
  ): Promise<void> {
    await this.db
      .updateTable('book')
      .set({ htmlExportStatus, ...(htmlExportPath !== undefined && { htmlExportPath }) })
      .where('book.id', '=', id)
      .execute();
  }

  private selectPages(db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .selectFrom('book_page')
      .selectAll('book_page')
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('book_page_asset')
            .select([
              'book_page_asset.slot',
              'book_page_asset.assetId',
              'book_page_asset.crop',
              'book_page_asset.caption',
            ])
            .whereRef('book_page_asset.pageId', '=', 'book_page.id')
            .orderBy('book_page_asset.slot', 'asc'),
        ).as('assets'),
      );
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getPages(bookId: string) {
    return this.selectPages().where('book_page.bookId', '=', bookId).orderBy('book_page.position', 'asc').execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getPage(bookId: string, pageId: string) {
    return this.selectPages()
      .where('book_page.bookId', '=', bookId)
      .where('book_page.id', '=', pageId)
      .executeTakeFirst();
  }

  /** Locks the book row for the rest of the transaction and bumps its updatedAt, so page operations serialize */
  private async lockBook(trx: Transaction<DB>, bookId: string) {
    await trx
      .updateTable('book')
      .set({ updatedAt: sql`clock_timestamp()` })
      .where('book.id', '=', bookId)
      .execute();
  }

  private async compactPositions(trx: Transaction<DB>, bookId: string) {
    await sql`
      update "book_page"
      set "position" = "ordered"."newPosition"
      from (
        select "id", (row_number() over (order by "position", "createdAt") - 1)::integer as "newPosition"
        from "book_page"
        where "bookId" = ${bookId}
      ) as "ordered"
      where "book_page"."id" = "ordered"."id" and "book_page"."position" != "ordered"."newPosition"
    `.execute(trx);
  }

  @GenerateSql({ params: [DummyValue.UUID, { layout: 'single' }, 0] })
  addPage(bookId: string, values: BookPageValues, position?: number) {
    return this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);

      const { count } = await trx
        .selectFrom('book_page')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('book_page.bookId', '=', bookId)
        .executeTakeFirstOrThrow();

      const target = Math.min(Math.max(position ?? Number(count), 0), Number(count));
      await trx
        .updateTable('book_page')
        .set((eb) => ({ position: eb('position', '+', 1) }))
        .where('book_page.bookId', '=', bookId)
        .where('book_page.position', '>=', target)
        .execute();

      const { id } = await trx
        .insertInto('book_page')
        .values({ ...values, bookId, position: target })
        .returning('id')
        .executeTakeFirstOrThrow();

      return this.selectPages(trx).where('book_page.id', '=', id).executeTakeFirstOrThrow();
    });
  }

  /** Updates a page; when `slotCount` is given, placements in slots at or beyond it are removed */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { layout: 'single' }, 1] })
  updatePage(bookId: string, pageId: string, values: Updateable<BookPageTable>, slotCount?: number) {
    return this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);

      const changes = omitUndefined(values);
      if (Object.keys(changes).length > 0) {
        await trx
          .updateTable('book_page')
          .set(changes)
          .where('book_page.id', '=', pageId)
          .where('book_page.bookId', '=', bookId)
          .execute();
      }

      if (slotCount !== undefined) {
        await trx
          .deleteFrom('book_page_asset')
          .where('book_page_asset.pageId', '=', pageId)
          .where('book_page_asset.slot', '>=', slotCount)
          .execute();
      }

      return this.selectPages(trx)
        .where('book_page.id', '=', pageId)
        .where('book_page.bookId', '=', bookId)
        .executeTakeFirst();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  removePage(bookId: string, pageId: string): Promise<void> {
    return this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);
      await trx
        .deleteFrom('book_page')
        .where('book_page.id', '=', pageId)
        .where('book_page.bookId', '=', bookId)
        .execute();
      await this.compactPositions(trx, bookId);
    });
  }

  /** Moves a page to a zero-based position, keeping the positions of all pages dense */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, 0] })
  movePage(bookId: string, pageId: string, position: number) {
    return this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);

      const pages = await trx
        .selectFrom('book_page')
        .select(['book_page.id', 'book_page.position'])
        .where('book_page.bookId', '=', bookId)
        .orderBy('book_page.position', 'asc')
        .orderBy('book_page.createdAt', 'asc')
        .execute();

      const ids = pages.map((page) => page.id);
      const from = ids.indexOf(pageId);
      if (from === -1) {
        return;
      }

      ids.splice(from, 1);
      ids.splice(Math.min(Math.max(position, 0), ids.length), 0, pageId);

      const current = new Map(pages.map((page) => [page.id, page.position]));
      for (const [index, id] of ids.entries()) {
        if (current.get(id) !== index) {
          await trx.updateTable('book_page').set({ position: index }).where('book_page.id', '=', id).execute();
        }
      }

      return this.selectPages(trx).where('book_page.id', '=', pageId).executeTakeFirstOrThrow();
    });
  }

  /** Replaces all pages of a book (or appends to them with `keepExisting`) in one transaction */
  @GenerateSql({ params: [DummyValue.UUID, [{ layout: 'single', assets: [{ slot: 0, assetId: DummyValue.UUID }] }]] })
  replacePages(bookId: string, pages: BookPageWithPlacements[], options: { keepExisting?: boolean } = {}) {
    return this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);

      let offset = 0;
      if (options.keepExisting) {
        const { count } = await trx
          .selectFrom('book_page')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('book_page.bookId', '=', bookId)
          .executeTakeFirstOrThrow();
        offset = Number(count);
      } else {
        await trx.deleteFrom('book_page').where('book_page.bookId', '=', bookId).execute();
      }

      if (pages.length === 0) {
        return;
      }

      const inserted = await trx
        .insertInto('book_page')
        .values(pages.map(({ assets: _, ...values }, index) => ({ ...values, bookId, position: offset + index })))
        .returning(['book_page.id', 'book_page.position'])
        .execute();

      const ids = new Map(inserted.map(({ id, position }) => [position, id]));
      const placements = pages.flatMap((page, index) =>
        page.assets.map((asset) => ({ ...asset, pageId: ids.get(offset + index)! })),
      );
      if (placements.length > 0) {
        await trx.insertInto('book_page_asset').values(placements).execute();
      }
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, { pageId: DummyValue.UUID, slot: 0, assetId: DummyValue.UUID }] })
  async upsertSlot(bookId: string, placement: Insertable<BookPageAssetTable>): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);
      await trx
        .insertInto('book_page_asset')
        .values(placement)
        .onConflict((oc) =>
          oc.columns(['pageId', 'slot']).doUpdateSet((eb) => ({
            assetId: eb.ref('excluded.assetId'),
            crop: eb.ref('excluded.crop'),
            caption: eb.ref('excluded.caption'),
          })),
        )
        .execute();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, 0, { caption: DummyValue.STRING }] })
  async updateSlot(
    bookId: string,
    pageId: string,
    slot: number,
    values: Updateable<BookPageAssetTable>,
  ): Promise<boolean> {
    const changes = omitUndefined(values);
    if (Object.keys(changes).length === 0) {
      return true;
    }

    return this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);
      const result = await trx
        .updateTable('book_page_asset')
        .set(changes)
        .where('book_page_asset.pageId', '=', pageId)
        .where('book_page_asset.slot', '=', slot)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, 0] })
  async deleteSlot(bookId: string, pageId: string, slot: number): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.lockBook(trx, bookId);
      await trx
        .deleteFrom('book_page_asset')
        .where('book_page_asset.pageId', '=', pageId)
        .where('book_page_asset.slot', '=', slot)
        .execute();
    });
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  getAssetsForRender(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.type',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.isEdited',
        'asset.localDateTime',
        'asset.width',
        'asset.height',
        'asset_exif.exifImageWidth',
        'asset_exif.exifImageHeight',
        'asset_exif.orientation',
      ])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset_file')
            .select(['asset_file.type', 'asset_file.path', 'asset_file.isEdited'])
            .whereRef('asset_file.assetId', '=', 'asset.id'),
        ).as('files'),
      )
      .where('asset.id', 'in', ids)
      .where('asset.deletedAt', 'is', null)
      .execute();
  }

  /** capture time and GPS location of assets, for maps */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getAssetLocations(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.city',
        'asset_exif.country',
      ])
      .where('asset.id', 'in', ids)
      .where('asset.deletedAt', 'is', null)
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .orderBy('asset.localDateTime', 'asc')
      .orderBy('asset.id', 'asc')
      .execute();
  }

  /** outlines of the countries that overlap a longitude/latitude box, as Postgres polygons */
  @GenerateSql({ params: [{ west: -10, south: 35, east: 20, north: 50 }] })
  getCountryOutlines(bounds: { west: number; south: number; east: number; north: number }) {
    return this.db
      .selectFrom('naturalearth_countries')
      .select(['naturalearth_countries.admin', sql<string>`"coordinates"::text`.as('coordinates')])
      .where(
        sql<boolean>`"coordinates" && polygon(box(point(${bounds.west}, ${bounds.south}), point(${bounds.east}, ${bounds.north})))`,
      )
      .limit(500)
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  getFaces(assetIds: string[]) {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset_face')
      .select([
        'asset_face.assetId',
        'asset_face.imageWidth',
        'asset_face.imageHeight',
        'asset_face.boundingBoxX1',
        'asset_face.boundingBoxY1',
        'asset_face.boundingBoxX2',
        'asset_face.boundingBoxY2',
      ])
      .where('asset_face.assetId', 'in', assetIds)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .execute();
  }
}

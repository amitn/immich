import { Selectable } from 'kysely';
import { NormalizedRect, defaultBookStyle } from 'src/dtos/book.dto.js';
import { BookPageTable } from 'src/schema/tables/book-page.table.js';
import { BookTable } from 'src/schema/tables/book.table.js';
import { newDate, newUuid, newUuidV7 } from 'test/small.factory.js';

type BookRow = Selectable<BookTable> & { pageCount: number; firstPageId: string | null };
type BookPlacement = { slot: number; assetId: string; crop: NormalizedRect | null; caption: string | null };
type BookPageRow = Selectable<BookPageTable> & { assets: BookPlacement[] };

export const BookFactory = {
  create(dto: Partial<BookRow> = {}): BookRow {
    return {
      id: newUuid(),
      ownerId: newUuid(),
      albumId: null,
      coverAssetId: null,
      title: 'My book',
      subtitle: null,
      pageWidthMm: 210,
      pageHeightMm: 210,
      style: { ...defaultBookStyle },
      exportStatus: null,
      exportPath: null,
      pageCount: 0,
      firstPageId: null,
      createdAt: newDate(),
      updatedAt: newDate(),
      updateId: newUuidV7(),
      ...dto,
    };
  },
};

export const BookPageFactory = {
  create(dto: Partial<BookPageRow> = {}): BookPageRow {
    return {
      id: newUuid(),
      bookId: newUuid(),
      position: 0,
      layout: 'single',
      sectionTitle: null,
      caption: null,
      background: null,
      assets: [],
      createdAt: newDate(),
      updatedAt: newDate(),
      updateId: newUuidV7(),
      ...dto,
    };
  },

  placement(dto: Partial<BookPlacement> = {}): BookPlacement {
    return { slot: 0, assetId: newUuid(), crop: null, caption: null, ...dto };
  },
};

import { Column, ForeignKeyColumn, PrimaryColumn, Table } from '@immich/sql-tools';
import type { NormalizedRect } from 'src/dtos/book.dto.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { BookPageTable } from 'src/schema/tables/book-page.table.js';

@Table('book_page_asset')
export class BookPageAssetTable {
  @ForeignKeyColumn(() => BookPageTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  pageId!: string;

  @PrimaryColumn({ type: 'integer' })
  slot!: number;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  assetId!: string;

  /** crop of the (orientation-corrected) source image, normalized to 0..1 */
  @Column({ type: 'jsonb', nullable: true })
  crop!: NormalizedRect | null;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;
}

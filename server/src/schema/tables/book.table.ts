import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import type { BookStyle } from 'src/dtos/book.dto.js';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { BookExportStatus } from 'src/enum.js';
import { AlbumTable } from 'src/schema/tables/album.table.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

@Table('book')
@UpdatedAtTrigger('book_updatedAt')
export class BookTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  ownerId!: string;

  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  albumId!: string | null;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  coverAssetId!: string | null;

  @Column()
  title!: string;

  @Column({ nullable: true })
  subtitle!: string | null;

  @Column({ type: 'integer' })
  pageWidthMm!: number;

  @Column({ type: 'integer' })
  pageHeightMm!: number;

  @Column({ type: 'jsonb' })
  style!: BookStyle;

  @Column({ nullable: true })
  exportStatus!: BookExportStatus | null;

  @Column({ nullable: true })
  exportPath!: string | null;

  @Column({ nullable: true })
  htmlExportStatus!: BookExportStatus | null;

  @Column({ nullable: true })
  htmlExportPath!: string | null;

  /** when the PDF export last completed */
  @Column({ type: 'timestamp with time zone', nullable: true })
  exportedAt!: Timestamp | null;

  /** when the HTML export last completed */
  @Column({ type: 'timestamp with time zone', nullable: true })
  htmlExportedAt!: Timestamp | null;

  /** last change to what the book looks like (pages, slots, style, title); exports older than this are stale */
  @CreateDateColumn({ default: () => 'now()' })
  contentUpdatedAt!: Generated<Timestamp>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn()
  updateId!: Generated<string>;
}

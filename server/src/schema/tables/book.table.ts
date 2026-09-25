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
import { UpdatedAtTrigger } from 'src/decorators.js';
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

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}

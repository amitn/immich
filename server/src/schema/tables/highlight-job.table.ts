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
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { HighlightJobStatus } from 'src/enum.js';
import { AlbumTable } from 'src/schema/tables/album.table.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { BookTable } from 'src/schema/tables/book.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** what a highlight video is made of and how, as it was asked for */
export type HighlightJobOptions = {
  /** the photos and videos of a selection; an album or a book gives its own */
  assetIds?: string[];
  durationSeconds: number;
  /** a book style preset, or auto: the book's style, or the preset of the collection of the photos */
  style: string;
  includeMaps: boolean;
  captions: boolean;
  /** the video is added to the album it was made from */
  addToAlbum: boolean;
  /** landscape (16:9) or vertical (9:16); videos made before the option are landscape */
  format?: 'landscape' | 'vertical';
};

@Table('highlight_job')
@UpdatedAtTrigger('highlight_job_updatedAt')
export class HighlightJobTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  ownerId!: string;

  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  albumId!: string | null;

  @ForeignKeyColumn(() => BookTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  bookId!: string | null;

  /** the audio asset played under the film */
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  musicAssetId!: string | null;

  @Column()
  title!: string;

  @Column({ type: 'jsonb' })
  options!: HighlightJobOptions;

  @Column({ default: HighlightJobStatus.Pending })
  status!: Generated<HighlightJobStatus>;

  /** 0..1 */
  @Column({ type: 'real', default: 0 })
  progress!: Generated<number>;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /** what was left out or could not be done, e.g. photos too small for 1080p */
  @Column({ type: 'jsonb', nullable: true })
  warnings!: string[] | null;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  resultAssetId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn()
  updateId!: Generated<string>;
}

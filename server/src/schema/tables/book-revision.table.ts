import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
} from '@immich/sql-tools';
import { BookTable } from 'src/schema/tables/book.table.js';
import type { BookSnapshot } from 'src/utils/activity-log.js';

/** A copy of a book (its settings, pages and slots) taken before a change, which undoing the change restores */
@Table('book_revision')
export class BookRevisionTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => BookTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  bookId!: string;

  @Column({ type: 'jsonb' })
  snapshot!: BookSnapshot;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

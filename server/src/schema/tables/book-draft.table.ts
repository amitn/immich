import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { BookDraftKind, BookDraftState } from 'src/enum.js';
import { BookTable } from 'src/schema/tables/book.table.js';
import { MemoryTable } from 'src/schema/tables/memory.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
 * A book suggested to a user, by its stable key (e.g. `food:2026`, `trip:Travel/Crete, October 2016`,
 * `birthday:<personId>:7`): a key is suggested once, and a discarded suggestion stays gone, even after its book is
 * deleted.
 */
@Table('book_draft')
@UpdatedAtTrigger('book_draft_updatedAt')
@Unique({ columns: ['ownerId', 'key'] })
export class BookDraftTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, index: false })
  ownerId!: string;

  @Column()
  key!: string;

  @Column()
  kind!: BookDraftKind;

  @Column({ default: BookDraftState.Drafted })
  state!: Generated<BookDraftState>;

  /** the book laid out for the suggestion; null once it is deleted */
  @ForeignKeyColumn(() => BookTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  bookId!: string | null;

  /**
   * the memory of the rule engine the suggestion is based on, e.g. the `recent_trip` or `birthday` memory whose window
   * it covers (#5); null for the other suggestions, and once the memory is deleted
   */
  @ForeignKeyColumn(() => MemoryTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  memoryId!: string | null;

  @Column()
  title!: string;

  /** why the book is suggested, e.g. "You visited 6 restaurants in 2026" */
  @Column({ type: 'text' })
  reason!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn()
  updateId!: Generated<string>;
}

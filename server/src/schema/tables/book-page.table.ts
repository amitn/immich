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
import { UpdatedAtTrigger } from 'src/decorators.js';
import { BookTable } from 'src/schema/tables/book.table.js';

@Table('book_page')
@UpdatedAtTrigger('book_page_updatedAt')
export class BookPageTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => BookTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  bookId!: string;

  /** zero-based order of the page within the book */
  @Column({ type: 'integer' })
  position!: number;

  @Column()
  layout!: string;

  @Column({ nullable: true })
  sectionTitle!: string | null;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  @Column({ nullable: true })
  background!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}

import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  type Timestamp,
  Unique,
} from '@immich/sql-tools';
import { NotificationTable } from 'src/schema/tables/notification.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
 * What the memory notifier sent a user (#6): the notification of the day — a memory (`memory`, by its id) or a
 * suggested photo book waiting for them (`draft`, by the id of the draft) — and the weekly email digest (`digest`, by
 * its ISO week, e.g. `2026-W40`). Each is sent once (`userId`, `kind`, `refId`), and a user gets at most one
 * notification of the day per day, in their time zone (`day`).
 */
@Table('memory_notice')
@Unique({ columns: ['userId', 'kind', 'refId'] })
@Check({ name: 'memory_notice_kind_chk', expression: `"kind" IN ('memory', 'draft', 'digest')` })
@Index({
  name: 'memory_notice_userId_day_key',
  columns: ['userId', 'day'],
  unique: true,
  where: `"kind" IN ('memory', 'draft')`,
})
export class MemoryNoticeTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, index: false })
  userId!: string;

  /** memory, draft or digest */
  @Column()
  kind!: string;

  /** the memory, the book draft, or the ISO week of the digest */
  @Column()
  refId!: string;

  /** the day it was sent, in the user's time zone */
  @Column({ type: 'date' })
  day!: string;

  /** the notification; null for the digest, and once the user deletes it */
  @ForeignKeyColumn(() => NotificationTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  notificationId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  PrimaryGeneratedColumn,
  Table,
  type Timestamp,
  Unique,
} from '@immich/sql-tools';
import { NotificationTable } from 'src/schema/tables/notification.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
 * A "new collection found" notification sent to a user: a new visit of a collection pack (a meal, a museum visit) whose
 * photos nobody named yet, by its key (e.g. `food:2026-09-26:Dinner:Taormina`) and its photos. A visit is notified
 * once: its key, or any of its photos, is never notified again, even after the notification is dismissed or deleted.
 */
@Table('collection_notice')
@Unique({ columns: ['userId', 'pack', 'key'] })
export class CollectionNoticeTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, index: false })
  userId!: string;

  /** the id of the collection pack, e.g. food */
  @Column()
  pack!: string;

  @Column()
  key!: string;

  /** the photos of the visit that the notification opens the naming dialog on */
  @Column({ type: 'uuid', array: true })
  assetIds!: string[];

  /** the notification; null once the user deletes it */
  @ForeignKeyColumn(() => NotificationTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  notificationId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

/** when the uploads of a user were last checked for new collections */
@Table('collection_notice_check')
export class CollectionNoticeCheckTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  userId!: string;

  @Column({ type: 'timestamp with time zone' })
  checkedAt!: Timestamp;
}

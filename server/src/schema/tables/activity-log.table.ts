import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
} from '@immich/sql-tools';
import type { ActivityUndoData } from 'src/utils/activity-log.js';
import { ActivityLogAction, ActivityLogSource } from 'src/enum.js';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
 * One change to the library made by the assistant, or with one of the assistant's features in the web app (an album
 * filled, a copy made, photos named, a book edited...), with what undoing it needs. Not to be confused with the
 * `activity` table, which holds the comments and likes of shared albums.
 */
@Table('activity_log')
@Index({ columns: ['userId', 'createdAt'] })
export class ActivityLogTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, index: false })
  userId!: string;

  @Column()
  source!: ActivityLogSource;

  /** the assistant chat of the change; kept (as null) when the chat is deleted, so the change can still be undone */
  @ForeignKeyColumn(() => AgentSessionTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  sessionId!: string | null;

  /** the assistant tool that made the change */
  @Column({ nullable: true })
  toolName!: string | null;

  @Column()
  action!: ActivityLogAction;

  /** e.g. "Added 12 photos to “Sicily 2009”" */
  @Column({ type: 'text' })
  summary!: string;

  /** the album, book, style, shared link or highlight video that was changed or created */
  @Column({ type: 'uuid', nullable: true })
  targetId!: string | null;

  /** the photos and videos that were changed or created */
  @Column({ type: 'uuid', array: true, default: '{}' })
  assetIds!: Generated<string[]>;

  /** what undoing the change needs (see `ActivityUndoData`); null when it can't be undone */
  @Column({ type: 'jsonb', nullable: true })
  undo!: ActivityUndoData | null;

  /** the changes of one chat turn (or of one request in the web app) share a group, which is undone as a whole */
  @Column({ type: 'uuid', index: true })
  groupId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  undoneAt!: Timestamp | null;

  /** who undid the change */
  @Column({ nullable: true })
  undoneBy!: ActivityLogSource | null;
}

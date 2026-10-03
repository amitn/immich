import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  type Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import type { RoutineLimits, RoutineRunContext, RoutineScope, RoutineTrigger } from 'src/utils/routines.js';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { RoutineApprovalMode, RoutineApprovalStatus, RoutineRunStatus } from 'src/enum.js';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
 * An assistant routine (#15): an instruction in plain words that the assistant runs on its own, on a schedule or after
 * an event, with an approval mode that decides what happens to the changes it makes.
 */
@Table('assistant_routine')
@UpdatedAtTrigger('assistant_routine_updatedAt')
export class AssistantRoutineTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  ownerId!: string;

  @Column()
  name!: string;

  /** what to do, in plain words */
  @Column({ type: 'text' })
  instruction!: string;

  /** a schedule (cron), an event (with its filter), or manual (see `RoutineTrigger`) */
  @Column({ type: 'jsonb' })
  trigger!: RoutineTrigger;

  /** the albums, people, tags or journal and the date window the run is pointed at (see `RoutineScope`) */
  @Column({ type: 'jsonb', default: '{}' })
  scope!: Generated<RoutineScope>;

  @Column({ default: RoutineApprovalMode.Ask })
  approvalMode!: Generated<RoutineApprovalMode>;

  /** runs per day, minutes and tool calls per run */
  @Column({ type: 'jsonb' })
  limits!: RoutineLimits;

  /** the agent profile of the runs; null for the chat profile */
  @Column({ nullable: true })
  profile!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: Generated<boolean>;

  /** set when the routine was paused after repeated failures; it runs again once the user resumes it */
  @Column({ type: 'timestamp with time zone', nullable: true })
  pausedAt!: Timestamp | null;

  @Column({ type: 'integer', default: 0 })
  consecutiveFailures!: Generated<number>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastRunAt!: Timestamp | null;

  /** when a scheduled routine runs next */
  @Column({ type: 'timestamp with time zone', nullable: true, index: true })
  nextRunAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn()
  updateId!: Generated<string>;
}

/**
 * An event that waits for the next run of a routine: photos of an upload, a new journal visit, a tag, a trip, a book
 * draft, or photos sent by a Workflow. The events of a routine are taken together by its next run (batched), which
 * deletes them.
 */
@Table('assistant_routine_event')
export class AssistantRoutineEventTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssistantRoutineTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  routineId!: string;

  /** the `RoutineEvent` */
  @Column()
  kind!: string;

  @Column({ type: 'uuid', array: true, default: '{}' })
  assetIds!: Generated<string[]>;

  /** what the run is told about the event, e.g. the journal and the title of a visit */
  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

/** One run of a routine: an assistant session without a chat window, its transcript, what it changed and asks */
@Table('assistant_routine_run')
@Index({ columns: ['ownerId', 'createdAt'] })
export class AssistantRoutineRunTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssistantRoutineTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  routineId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, index: false })
  ownerId!: string;

  /** the transcript: the messages of this session, shown like a chat */
  @ForeignKeyColumn(() => AgentSessionTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  sessionId!: string | null;

  /** what started the run: manual, schedule or event */
  @Column()
  trigger!: string;

  /** the approval mode of this run (a dry run of an Ask me routine is a dry run) */
  @Column()
  approvalMode!: RoutineApprovalMode;

  @Column({ default: RoutineRunStatus.Queued })
  status!: Generated<RoutineRunStatus>;

  /** the photos and events the run was started with */
  @Column({ type: 'jsonb', default: '{}' })
  context!: Generated<RoutineRunContext>;

  /** the limits of this run */
  @Column({ type: 'jsonb' })
  limits!: RoutineLimits;

  /** the agent's own summary, its last message */
  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'integer', default: 0 })
  toolCalls!: Generated<number>;

  /** changes made by the run itself (not counting the approvals applied later) */
  @Column({ type: 'integer', default: 0 })
  changes!: Generated<number>;

  /** the sha256 of the MCP token of the running agent; null once the run ended */
  @Column({ nullable: true, index: true })
  tokenHash!: string | null;

  /** the user asked to stop the run */
  @Column({ type: 'boolean', default: false })
  cancelRequested!: Generated<boolean>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  startedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  finishedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

/**
 * A change a routine run wanted to make (a mutating tool call) that waits for the user, or was decided: approving it
 * makes the recorded tool call again, exactly as the agent made it. Queued changes expire.
 */
@Table('assistant_routine_approval')
@Index({ columns: ['ownerId', 'status'] })
export class AssistantRoutineApprovalTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssistantRoutineRunTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  runId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, index: false })
  ownerId!: string;

  @Column()
  toolName!: string;

  /** the title of the tool, e.g. "Add to album" */
  @Column()
  title!: string;

  /** a short summary of the arguments */
  @Column({ type: 'text' })
  summary!: string;

  /** the arguments of the tool call, applied as they are */
  @Column({ type: 'jsonb' })
  input!: Record<string, unknown>;

  @Column({ default: RoutineApprovalStatus.Pending })
  status!: Generated<RoutineApprovalStatus>;

  /** what applying it returned, or why it failed */
  @Column({ type: 'text', nullable: true })
  result!: string | null;

  /** the activity log entries of the change, once applied */
  @Column({ type: 'uuid', array: true, default: '{}' })
  activityIds!: Generated<string[]>;

  @Column({ type: 'timestamp with time zone' })
  expiresAt!: Timestamp;

  @Column({ type: 'timestamp with time zone', nullable: true })
  decidedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

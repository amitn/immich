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
import { AgentMessageKind, AgentMessageRole } from 'src/enum.js';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table.js';

@Table('agent_message')
@Index({ columns: ['sessionId', 'createdAt'] })
export class AgentMessageTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  sessionId!: string;

  @Column()
  role!: AgentMessageRole;

  @Column()
  kind!: AgentMessageKind;

  /** stable id used to update a message in place, e.g. an ACP tool call id */
  @Column({ nullable: true })
  externalId!: string | null;

  @Column({ type: 'jsonb' })
  content!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

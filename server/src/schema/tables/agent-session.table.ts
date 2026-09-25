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
import { AgentSessionStatus } from 'src/enum.js';
import { UserTable } from 'src/schema/tables/user.table.js';

@Table('agent_session')
@UpdatedAtTrigger('agent_session_updatedAt')
export class AgentSessionTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  userId!: string;

  @Column({ nullable: true })
  title!: string | null;

  @Column()
  profile!: string;

  @Column({ nullable: true })
  acpSessionId!: string | null;

  @Column({ default: AgentSessionStatus.Idle })
  status!: Generated<AgentSessionStatus>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}

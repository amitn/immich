import { Injectable } from '@nestjs/common';
import { type Insertable, Kysely, type Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AgentMessageKind, AgentSessionStatus } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { AgentMessageTable } from 'src/schema/tables/agent-message.table.js';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table.js';

@Injectable()
export class AgentRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [{ userId: DummyValue.UUID, profile: 'claude' }] })
  createSession(session: Insertable<AgentSessionTable>) {
    return this.db.insertInto('agent_session').values(session).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSession(id: string) {
    return this.db.selectFrom('agent_session').selectAll().where('agent_session.id', '=', id).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSessions(userId: string) {
    return this.db
      .selectFrom('agent_session')
      .selectAll()
      .where('agent_session.userId', '=', userId)
      .orderBy('agent_session.updatedAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { status: AgentSessionStatus.Running }] })
  updateSession(id: string, session: Updateable<AgentSessionTable>) {
    return this.db
      .updateTable('agent_session')
      .set(session)
      .where('agent_session.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteSession(id: string) {
    await this.db.deleteFrom('agent_session').where('agent_session.id', '=', id).execute();
  }

  /** Sessions can't be running after a restart, since their agent processes are gone. */
  @GenerateSql()
  async resetRunningSessions() {
    await this.db
      .updateTable('agent_session')
      .set({ status: AgentSessionStatus.Idle })
      .where('agent_session.status', '=', AgentSessionStatus.Running)
      .execute();
  }

  @GenerateSql({ params: [{ sessionId: DummyValue.UUID, role: 'agent', kind: 'text', content: {} }] })
  createMessage(message: Insertable<AgentMessageTable>) {
    return this.db.insertInto('agent_message').values(message).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, {}] })
  updateMessage(id: string, content: Record<string, unknown>) {
    return this.db
      .updateTable('agent_message')
      .set({ content })
      .where('agent_message.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getMessages(sessionId: string) {
    return this.db
      .selectFrom('agent_message')
      .selectAll()
      .where('agent_message.sessionId', '=', sessionId)
      .orderBy('agent_message.createdAt', 'asc')
      .orderBy('agent_message.id', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  getMessageByExternalId(sessionId: string, externalId: string) {
    return this.db
      .selectFrom('agent_message')
      .selectAll()
      .where('agent_message.sessionId', '=', sessionId)
      .where('agent_message.externalId', '=', externalId)
      .orderBy('agent_message.createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /** The most recent text messages, newest first */
  @GenerateSql({ params: [DummyValue.UUID, 20] })
  getRecentTextMessages(sessionId: string, limit: number) {
    return this.db
      .selectFrom('agent_message')
      .selectAll()
      .where('agent_message.sessionId', '=', sessionId)
      .where('agent_message.kind', '=', AgentMessageKind.Text)
      .orderBy('agent_message.createdAt', 'desc')
      .limit(limit)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAuthUser(userId: string) {
    return this.db
      .selectFrom('user')
      .select(columns.authUser)
      .where('user.id', '=', userId)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirst();
  }
}

import { Injectable } from '@nestjs/common';
import { type Insertable, type Kysely, type Updateable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { RoutineApprovalStatus, RoutineRunStatus, RoutineTriggerType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import {
  AssistantRoutineApprovalTable,
  AssistantRoutineEventTable,
  AssistantRoutineRunTable,
  AssistantRoutineTable,
} from 'src/schema/tables/assistant-routine.table.js';

/** The assistant routines (#15): the routines, the events that wait for their next run, their runs and approvals */
@Injectable()
export class RoutineRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({
    params: [
      { ownerId: DummyValue.UUID, name: 'Name dishes', instruction: '', trigger: { type: 'manual' }, limits: {} },
    ],
  })
  create(values: Insertable<AssistantRoutineTable>) {
    return this.db.insertInto('assistant_routine').values(values).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.db
      .selectFrom('assistant_routine')
      .selectAll()
      .where('assistant_routine.id', '=', id)
      .executeTakeFirst();
  }

  /** the routines of a user, the newest first */
  @GenerateSql({ params: [DummyValue.UUID] })
  getByOwner(ownerId: string) {
    return this.db
      .selectFrom('assistant_routine')
      .selectAll()
      .where('assistant_routine.ownerId', '=', ownerId)
      .orderBy('assistant_routine.createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async countByOwner(ownerId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom('assistant_routine')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('assistant_routine.ownerId', '=', ownerId)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  @GenerateSql({ params: [DummyValue.UUID, { name: 'Name dishes' }] })
  update(id: string, values: Updateable<AssistantRoutineTable>) {
    return this.db
      .updateTable('assistant_routine')
      .set(values)
      .where('assistant_routine.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** deletes a routine with its runs, approvals and events, and the transcripts of its runs */
  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const sessions = await trx
        .selectFrom('assistant_routine_run')
        .select('assistant_routine_run.sessionId')
        .where('assistant_routine_run.routineId', '=', id)
        .where('assistant_routine_run.sessionId', 'is not', null)
        .execute();
      await trx.deleteFrom('assistant_routine').where('assistant_routine.id', '=', id).execute();
      const ids = sessions.map(({ sessionId }) => sessionId!);
      if (ids.length > 0) {
        await trx.deleteFrom('agent_session').where('agent_session.id', 'in', ids).execute();
      }
    });
  }

  /** the user's enabled, unpaused routines that run after the event */
  @GenerateSql({ params: [DummyValue.UUID, 'upload'] })
  getEventRoutines(ownerId: string, event: string) {
    return this.db
      .selectFrom('assistant_routine')
      .selectAll()
      .where('assistant_routine.ownerId', '=', ownerId)
      .where('assistant_routine.enabled', '=', true)
      .where('assistant_routine.pausedAt', 'is', null)
      .where(sql<string>`"assistant_routine"."trigger"->>'type'`, '=', RoutineTriggerType.Event)
      .where(sql<string>`"assistant_routine"."trigger"->>'event'`, '=', event)
      .execute();
  }

  /** the users that have an enabled routine for the event, to skip the others cheaply */
  @GenerateSql({ params: ['upload'] })
  async getEventOwners(event: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('assistant_routine')
      .select('assistant_routine.ownerId')
      .distinct()
      .where('assistant_routine.enabled', '=', true)
      .where('assistant_routine.pausedAt', 'is', null)
      .where(sql<string>`"assistant_routine"."trigger"->>'type'`, '=', RoutineTriggerType.Event)
      .where(sql<string>`"assistant_routine"."trigger"->>'event'`, '=', event)
      .execute();
    return rows.map(({ ownerId }) => ownerId);
  }

  @GenerateSql({ params: [[{ routineId: DummyValue.UUID, kind: 'upload', assetIds: [DummyValue.UUID] }]] })
  async addEvents(values: Insertable<AssistantRoutineEventTable>[]): Promise<void> {
    if (values.length === 0) {
      return;
    }
    await this.db.insertInto('assistant_routine_event').values(values).execute();
  }

  /**
   * The event routines whose events settled: no new event since `settledBefore` (the upload is over), or the oldest
   * waiting since before `maxWaitBefore` (a long upload still gets a run now and then)
   */
  @GenerateSql({ params: [DummyValue.DATE, DummyValue.DATE] })
  async getSettledRoutineIds(settledBefore: Date, maxWaitBefore: Date): Promise<string[]> {
    const rows = await this.db
      .selectFrom('assistant_routine_event')
      .innerJoin('assistant_routine', 'assistant_routine.id', 'assistant_routine_event.routineId')
      .select('assistant_routine_event.routineId')
      .where('assistant_routine.enabled', '=', true)
      .where('assistant_routine.pausedAt', 'is', null)
      .where(sql<string>`"assistant_routine"."trigger"->>'type'`, '=', RoutineTriggerType.Event)
      .groupBy('assistant_routine_event.routineId')
      .having((eb) =>
        eb.or([
          eb(eb.fn.max('assistant_routine_event.createdAt'), '<=', settledBefore),
          eb(eb.fn.min('assistant_routine_event.createdAt'), '<=', maxWaitBefore),
        ]),
      )
      .execute();
    return rows.map(({ routineId }) => routineId);
  }

  /** the scheduled routines that are due */
  @GenerateSql({ params: [DummyValue.DATE] })
  getDueRoutines(now: Date) {
    return this.db
      .selectFrom('assistant_routine')
      .selectAll()
      .where('assistant_routine.enabled', '=', true)
      .where('assistant_routine.pausedAt', 'is', null)
      .where('assistant_routine.nextRunAt', '<=', now)
      .orderBy('assistant_routine.nextRunAt')
      .execute();
  }

  /** moves a due routine to its next run; false when another worker did it first */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE, DummyValue.DATE] })
  async claimSchedule(id: string, due: Date, nextRunAt: Date | null): Promise<boolean> {
    const row = await this.db
      .updateTable('assistant_routine')
      .set({ nextRunAt })
      .where('assistant_routine.id', '=', id)
      .where('assistant_routine.nextRunAt', '=', due)
      .returning('assistant_routine.id')
      .executeTakeFirst();
    return !!row;
  }

  /** takes (and deletes) the events that wait for the routine: they go to the run that takes them */
  @GenerateSql({ params: [DummyValue.UUID] })
  takeEvents(routineId: string) {
    return this.db
      .deleteFrom('assistant_routine_event')
      .where('assistant_routine_event.routineId', '=', routineId)
      .returningAll()
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async countEvents(routineId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom('assistant_routine_event')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('assistant_routine_event.routineId', '=', routineId)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  @GenerateSql({
    params: [
      {
        routineId: DummyValue.UUID,
        ownerId: DummyValue.UUID,
        trigger: 'manual',
        approvalMode: 'ask',
        limits: {},
      },
    ],
  })
  createRun(values: Insertable<AssistantRoutineRunTable>) {
    return this.db.insertInto('assistant_routine_run').values(values).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getRun(id: string) {
    return this.db
      .selectFrom('assistant_routine_run')
      .selectAll()
      .where('assistant_routine_run.id', '=', id)
      .executeTakeFirst();
  }

  /** the runs of a routine, the newest first, with the number of their changes that wait for approval */
  @GenerateSql({ params: [DummyValue.UUID, 50] })
  getRuns(routineId: string, limit: number) {
    return this.db
      .selectFrom('assistant_routine_run')
      .selectAll('assistant_routine_run')
      .select((eb) =>
        eb
          .selectFrom('assistant_routine_approval')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .whereRef('assistant_routine_approval.runId', '=', 'assistant_routine_run.id')
          .where('assistant_routine_approval.status', '=', RoutineApprovalStatus.Pending)
          .as('pending'),
      )
      .where('assistant_routine_run.routineId', '=', routineId)
      .orderBy('assistant_routine_run.createdAt', 'desc')
      .limit(limit)
      .execute();
  }

  /** the latest run of each of the routines */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getLatestRuns(routineIds: string[]) {
    if (routineIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .selectFrom('assistant_routine_run')
      .selectAll()
      .distinctOn('assistant_routine_run.routineId')
      .where('assistant_routine_run.routineId', 'in', routineIds)
      .orderBy('assistant_routine_run.routineId')
      .orderBy('assistant_routine_run.createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { status: 'running' }] })
  updateRun(id: string, values: Updateable<AssistantRoutineRunTable>) {
    return this.db
      .updateTable('assistant_routine_run')
      .set(values)
      .where('assistant_routine_run.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** starts a queued run; undefined when it is not queued any more (cancelled, or started by another worker) */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  claimRun(id: string, tokenHash: string) {
    return this.db
      .updateTable('assistant_routine_run')
      .set({ status: RoutineRunStatus.Running, tokenHash, startedAt: new Date() })
      .where('assistant_routine_run.id', '=', id)
      .where('assistant_routine_run.status', '=', RoutineRunStatus.Queued)
      .returningAll()
      .executeTakeFirst();
  }

  /** the running run of an MCP token */
  @GenerateSql({ params: [DummyValue.STRING] })
  getRunByTokenHash(tokenHash: string) {
    return this.db
      .selectFrom('assistant_routine_run')
      .selectAll()
      .where('assistant_routine_run.tokenHash', '=', tokenHash)
      .where('assistant_routine_run.status', '=', RoutineRunStatus.Running)
      .executeTakeFirst();
  }

  /** counts a tool call of a running run, and returns the run as it is after it */
  @GenerateSql({ params: [DummyValue.UUID] })
  countToolCall(id: string) {
    return this.db
      .updateTable('assistant_routine_run')
      .set((eb) => ({ toolCalls: eb('assistant_routine_run.toolCalls', '+', 1) }))
      .where('assistant_routine_run.id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, 1] })
  async countChanges(id: string, count: number): Promise<void> {
    await this.db
      .updateTable('assistant_routine_run')
      .set((eb) => ({ changes: eb('assistant_routine_run.changes', '+', count) }))
      .where('assistant_routine_run.id', '=', id)
      .execute();
  }

  /** the runs of a routine since a time, the ones that were skipped left out */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
  async countRoutineRuns(routineId: string, since: Date): Promise<number> {
    const { count } = await this.db
      .selectFrom('assistant_routine_run')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('assistant_routine_run.routineId', '=', routineId)
      .where('assistant_routine_run.createdAt', '>=', since)
      .where('assistant_routine_run.status', '!=', RoutineRunStatus.Skipped)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  /** the runs of all the routines of a user since a time, the ones that were skipped left out */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
  async countOwnerRuns(ownerId: string, since: Date): Promise<number> {
    const { count } = await this.db
      .selectFrom('assistant_routine_run')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('assistant_routine_run.ownerId', '=', ownerId)
      .where('assistant_routine_run.createdAt', '>=', since)
      .where('assistant_routine_run.status', '!=', RoutineRunStatus.Skipped)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  @GenerateSql()
  async countRunning(): Promise<number> {
    const { count } = await this.db
      .selectFrom('assistant_routine_run')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('assistant_routine_run.status', '=', RoutineRunStatus.Running)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  /** fails the runs that were running when the server stopped */
  @GenerateSql({ params: [DummyValue.STRING] })
  failRunning(error: string) {
    return this.db
      .updateTable('assistant_routine_run')
      .set({ status: RoutineRunStatus.Failed, error, tokenHash: null, finishedAt: new Date() })
      .where('assistant_routine_run.status', '=', RoutineRunStatus.Running)
      .returning(['assistant_routine_run.id', 'assistant_routine_run.routineId'])
      .execute();
  }

  /**
   * The photos the user's routine runs changed or made since a time (their activity log entries): an event about them
   * (a copy uploaded, a tag added) does not start a routine again, so that routines can't trigger themselves
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
  async getRunAssetIds(ownerId: string, since: Date): Promise<string[]> {
    const rows = await this.db
      .selectFrom('activity_log')
      .select(sql<string>`unnest("activity_log"."assetIds")`.as('assetId'))
      .where('activity_log.userId', '=', ownerId)
      .where('activity_log.createdAt', '>=', since)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('assistant_routine_run')
            .select('assistant_routine_run.id')
            .whereRef('assistant_routine_run.id', '=', 'activity_log.groupId'),
        ),
      )
      .execute();
    return rows.map(({ assetId }) => assetId);
  }

  @GenerateSql({
    params: [
      {
        runId: DummyValue.UUID,
        ownerId: DummyValue.UUID,
        toolName: 'create_album',
        title: 'Create album',
        summary: '',
        input: {},
        expiresAt: DummyValue.DATE,
      },
    ],
  })
  createApproval(values: Insertable<AssistantRoutineApprovalTable>) {
    return this.db.insertInto('assistant_routine_approval').values(values).returningAll().executeTakeFirstOrThrow();
  }

  /** the changes of a run, in the order it made them */
  @GenerateSql({ params: [DummyValue.UUID] })
  getApprovals(runId: string) {
    return this.db
      .selectFrom('assistant_routine_approval')
      .selectAll()
      .where('assistant_routine_approval.runId', '=', runId)
      .orderBy('assistant_routine_approval.createdAt')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  getApprovalsByIds(ownerId: string, ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .selectFrom('assistant_routine_approval')
      .selectAll()
      .where('assistant_routine_approval.ownerId', '=', ownerId)
      .where('assistant_routine_approval.id', 'in', ids)
      .orderBy('assistant_routine_approval.createdAt')
      .execute();
  }

  /** the Routines inbox: the changes that wait for the user, with their routine and run, the oldest first */
  @GenerateSql({ params: [DummyValue.UUID] })
  getPendingApprovals(ownerId: string) {
    return this.db
      .selectFrom('assistant_routine_approval')
      .innerJoin('assistant_routine_run', 'assistant_routine_run.id', 'assistant_routine_approval.runId')
      .innerJoin('assistant_routine', 'assistant_routine.id', 'assistant_routine_run.routineId')
      .selectAll('assistant_routine_approval')
      .select(['assistant_routine.id as routineId', 'assistant_routine.name as routineName'])
      .where('assistant_routine_approval.ownerId', '=', ownerId)
      .where('assistant_routine_approval.status', '=', RoutineApprovalStatus.Pending)
      .orderBy('assistant_routine_approval.createdAt')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async countPendingApprovals(ownerId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom('assistant_routine_approval')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('assistant_routine_approval.ownerId', '=', ownerId)
      .where('assistant_routine_approval.status', '=', RoutineApprovalStatus.Pending)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  /**
   * Moves pending changes that did not expire to `status` (applying them, or denying them); returns the ones moved, so
   * that two clicks can't apply a change twice
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID], 'applying', DummyValue.DATE] })
  claimApprovals(ownerId: string, ids: string[], status: RoutineApprovalStatus, now: Date) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .updateTable('assistant_routine_approval')
      .set({ status, decidedAt: now })
      .where('assistant_routine_approval.ownerId', '=', ownerId)
      .where('assistant_routine_approval.id', 'in', ids)
      .where('assistant_routine_approval.status', '=', RoutineApprovalStatus.Pending)
      .where('assistant_routine_approval.expiresAt', '>', now)
      .returningAll()
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { status: 'applied' }] })
  updateApproval(id: string, values: Updateable<AssistantRoutineApprovalTable>) {
    return this.db
      .updateTable('assistant_routine_approval')
      .set(values)
      .where('assistant_routine_approval.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** expires the queued changes nobody decided in time */
  @GenerateSql({ params: [DummyValue.DATE] })
  async expireApprovals(now: Date): Promise<number> {
    const rows = await this.db
      .updateTable('assistant_routine_approval')
      .set({ status: RoutineApprovalStatus.Expired, decidedAt: now })
      .where('assistant_routine_approval.status', '=', RoutineApprovalStatus.Pending)
      .where('assistant_routine_approval.expiresAt', '<=', now)
      .returning('assistant_routine_approval.id')
      .execute();
    return rows.length;
  }
}

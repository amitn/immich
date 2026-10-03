import { BadRequestException, Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { ArgOf } from 'src/repositories/event.repository.js';
import type { JobOf } from 'src/types.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { ActivityUndoResponseDto } from 'src/dtos/activity-log.dto.js';
import { mapAgentMessage } from 'src/dtos/agent.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  RoutineApprovalDecisionDto,
  RoutineApprovalDecisionResponseDto,
  RoutineApprovalResponseDto,
  RoutineConfigResponseDto,
  RoutineCreateDto,
  RoutineResponseDto,
  RoutineRunCreateDto,
  RoutineRunDetailResponseDto,
  RoutineRunResponseDto,
  RoutineTriggerDto,
  RoutineUpdateDto,
  mapRoutine,
  mapRoutineApproval,
  mapRoutineRun,
  toRoutineTrigger,
} from 'src/dtos/routine.dto.js';
import {
  ActivityLogAction,
  ImmichWorker,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
  QueueName,
  RoutineApprovalMode,
  RoutineApprovalStatus,
  RoutineEvent,
  RoutineRunStatus,
  RoutineTriggerType,
} from 'src/enum.js';
import {
  AssistantRoutineApprovalTable,
  AssistantRoutineEventTable,
  AssistantRoutineRunTable,
  AssistantRoutineTable,
} from 'src/schema/tables/assistant-routine.table.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { AgentToolService } from 'src/services/agent-tool.service.js';
import { AgentService, HeadlessRunResult } from 'src/services/agent.service.js';
import { BaseService } from 'src/services/base.service.js';
import { ActivityRecorder, quote, recordActivity } from 'src/utils/activity-log.js';
import { AgentConfig, getAgentProfile, isRoutinesEnabled } from 'src/utils/agent/config.js';
import { getToolCallResult, truncateText } from 'src/utils/agent/session-updates.js';
import { handlePromiseError } from 'src/utils/misc.js';
import {
  ROUTINE_MAX_CONTEXT_ASSETS,
  ROUTINE_SAFE_TOOLS,
  RoutineLimits,
  RoutineRunContext,
  RoutineRunEvent,
  RoutineTrigger,
  buildRoutinePrompt,
  describeRunOutcome,
  getNextRunAt,
  hashRoutineToken,
  isTagUnder,
  validateCron,
} from 'src/utils/routines.js';

type Routine = Selectable<AssistantRoutineTable>;
type Run = Selectable<AssistantRoutineRunTable>;
type RoutineEventRow = Selectable<AssistantRoutineEventTable>;
type Approval = Selectable<AssistantRoutineApprovalTable>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** a run that can't start because too many run is started again after this delay */
export const ROUTINE_RETRY_DELAY_MS = 60_000;
/** the activity of the routine runs of the last days is not an event for routines (see `getRunAssetIds`) */
const LOOP_GUARD_DAYS = 7;
/** how long the list of users with an event routine is cached, so uploads don't query it photo by photo */
const EVENT_OWNERS_TTL_MS = 60_000;
/** the default limits of a new routine, under the server's caps */
const DEFAULT_LIMITS: RoutineLimits = { runsPerDay: 4, minutes: 15, toolCalls: 100 };
/** the kinds of event whose photos are what matters, told to the run as a count rather than one by one */
const PHOTO_EVENTS = new Set<string>([RoutineEvent.Upload, RoutineEvent.Workflow, RoutineEvent.Tag]);

const eventOwners = new Map<string, { at: number; owners: Set<string> }>();

/** the routine limits, capped by the server's */
export const capLimits = (
  limits: Partial<RoutineLimits> | undefined,
  config: AgentConfig['routines'],
): RoutineLimits => ({
  runsPerDay: Math.min(limits?.runsPerDay ?? DEFAULT_LIMITS.runsPerDay, config.maxRunsPerDay),
  minutes: Math.min(limits?.minutes ?? DEFAULT_LIMITS.minutes, config.maxRunMinutes),
  toolCalls: Math.min(limits?.toolCalls ?? DEFAULT_LIMITS.toolCalls, config.maxToolCalls),
});

/**
 * Assistant routines (#15): instructions in plain words that the assistant runs on its own, on a schedule or after an
 * event (uploads once they settle, a new journal visit, a tag, a trip, a book draft, photos sent by a Workflow).
 *
 * - Events wait in `assistant_routine_event`; every minute a tick starts the routines that are due and those whose
 *   events settled, taking their events as one batch.
 * - A run is a `RoutineRun` job: a headless assistant session (`AgentService.runHeadless`) with the instruction and the
 *   scope, and the same tools and access checks as the chat. Its approval mode decides, for each change, whether it is
 *   made, queued in the Routines inbox, or only reported (a dry run).
 * - Approving a queued change makes the recorded tool call again (it does not resume the session), before it expires.
 * - Every change is recorded in the activity log, grouped by the run (undo per run); a notification tells the result.
 */
@Injectable()
export class RoutineService extends BaseService {
  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  onConfigInit() {
    this.cronRepository.create({
      name: 'routineTick',
      expression: '* * * * *',
      onTick: () => handlePromiseError(this.jobRepository.queue({ name: JobName.RoutineTick, data: {} }), this.logger),
      start: true,
    });
  }

  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    const failed = await this.routineRepository.failRunning('The server restarted during the run');
    if (failed.length > 0) {
      this.logger.warn(`Failed ${failed.length} routine run(s) interrupted by a restart`);
    }
  }

  async getRoutineConfig(): Promise<RoutineConfigResponseDto> {
    const { agent } = await this.getConfig({ withCache: true });
    const caps = agent.routines;
    return {
      enabled: isRoutinesEnabled(agent),
      profiles: agent.profiles.map(({ name }) => name),
      defaultProfile: agent.chatProfile,
      maxRoutines: caps.maxRoutinesPerUser,
      defaultLimits: capLimits(undefined, caps),
      maxLimits: { runsPerDay: caps.maxRunsPerDay, minutes: caps.maxRunMinutes, toolCalls: caps.maxToolCalls },
      safeTools: [...ROUTINE_SAFE_TOOLS],
      approvalExpiryDays: caps.approvalExpiryDays,
    };
  }

  async getAll(auth: AuthDto): Promise<RoutineResponseDto[]> {
    const routines = await this.routineRepository.getByOwner(auth.user.id);
    const [latest, pending] = await Promise.all([
      this.routineRepository.getLatestRuns(routines.map(({ id }) => id)),
      this.routineRepository.getPendingApprovals(auth.user.id),
    ]);
    const lastRuns = new Map(latest.map((run) => [run.routineId, run]));
    const counts = new Map<string, number>();
    for (const { routineId } of pending) {
      counts.set(routineId, (counts.get(routineId) ?? 0) + 1);
    }
    return Promise.all(
      routines.map(async (routine) =>
        mapRoutine(routine, {
          lastRun: lastRuns.get(routine.id),
          pendingApprovals: counts.get(routine.id) ?? 0,
          pendingEvents: await this.routineRepository.countEvents(routine.id),
        }),
      ),
    );
  }

  async get(auth: AuthDto, id: string): Promise<RoutineResponseDto> {
    const routine = await this.findOrFail(auth, id);
    return this.toDto(auth, routine);
  }

  async create(auth: AuthDto, dto: RoutineCreateDto, activity?: ActivityRecorder): Promise<RoutineResponseDto> {
    const { agent } = await this.getConfig({ withCache: true });
    const count = await this.routineRepository.countByOwner(auth.user.id);
    if (count >= agent.routines.maxRoutinesPerUser) {
      throw new BadRequestException(`You can have at most ${agent.routines.maxRoutinesPerUser} routines`);
    }
    this.requireProfile(agent, dto.profile);

    const trigger = this.toTrigger(dto.trigger);
    const routine = await this.routineRepository.create({
      ownerId: auth.user.id,
      name: dto.name,
      instruction: dto.instruction,
      trigger,
      scope: dto.scope ?? {},
      approvalMode: dto.approvalMode ?? RoutineApprovalMode.Ask,
      limits: capLimits(dto.limits, agent.routines),
      profile: dto.profile || null,
      enabled: dto.enabled ?? true,
      nextRunAt: getNextRunAt(trigger, new Date()) ?? null,
    });
    eventOwners.clear();

    await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, auth.user.id, activity, {
      action: ActivityLogAction.RoutineCreate,
      summary: `Made the routine ${quote(routine.name)}`,
      targetId: routine.id,
      undo: { routineId: routine.id, updatedAt: routine.updatedAt.toISOString() },
    });
    return mapRoutine(routine);
  }

  async update(auth: AuthDto, id: string, dto: RoutineUpdateDto): Promise<RoutineResponseDto> {
    const current = await this.findOrFail(auth, id);
    const { agent } = await this.getConfig({ withCache: true });
    if (dto.profile !== undefined) {
      this.requireProfile(agent, dto.profile);
    }

    const trigger = dto.trigger ? this.toTrigger(dto.trigger) : current.trigger;
    const resumed = dto.paused === false && current.pausedAt !== null;
    const enabled = dto.enabled ?? current.enabled;
    // a schedule runs next from now on, not at a time missed while it was off or paused
    const reschedule = !!dto.trigger || resumed || (enabled && !current.enabled);
    const routine = await this.routineRepository.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.instruction !== undefined && { instruction: dto.instruction }),
      ...(dto.trigger && { trigger }),
      ...(dto.scope && { scope: dto.scope }),
      ...(dto.approvalMode && { approvalMode: dto.approvalMode }),
      ...(dto.limits && { limits: capLimits({ ...current.limits, ...dto.limits }, agent.routines) }),
      ...(dto.profile !== undefined && { profile: dto.profile || null }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(resumed && { pausedAt: null, consecutiveFailures: 0 }),
      ...(reschedule && { nextRunAt: getNextRunAt(trigger, new Date()) ?? null }),
    });
    eventOwners.clear();
    return this.toDto(auth, routine);
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.findOrFail(auth, id);
    await this.routineRepository.delete(id);
    eventOwners.clear();
  }

  /** "Run now", or a dry run: queues a run of the routine with the events that wait for it */
  async run(auth: AuthDto, id: string, dto: RoutineRunCreateDto): Promise<RoutineRunResponseDto> {
    const routine = await this.findOrFail(auth, id);
    const result = await this.startRun(routine, RoutineTriggerType.Manual, { dryRun: dto.dryRun, manual: true });
    if (typeof result === 'string') {
      throw new BadRequestException(result);
    }
    return mapRoutineRun(result!);
  }

  async getRuns(auth: AuthDto, id: string): Promise<RoutineRunResponseDto[]> {
    await this.findOrFail(auth, id);
    const runs = await this.routineRepository.getRuns(id, 50);
    return runs.map((run) => mapRoutineRun(run, Number(run.pending ?? 0)));
  }

  /** a run with its transcript (like a chat) and its changes that waited for approval */
  async getRun(auth: AuthDto, runId: string): Promise<RoutineRunDetailResponseDto> {
    const run = await this.findRunOrFail(auth, runId);
    const [routine, approvals, messages] = await Promise.all([
      this.routineRepository.get(run.routineId),
      this.routineRepository.getApprovals(run.id),
      run.sessionId ? this.agentRepository.getMessages(run.sessionId) : Promise.resolve([]),
    ]);
    const pending = approvals.filter(({ status }) => status === RoutineApprovalStatus.Pending).length;
    return {
      ...mapRoutineRun(run, pending),
      routineName: routine?.name ?? '',
      messages: messages.map((message) => mapAgentMessage(message)),
      approvals: approvals.map((approval) => mapRoutineApproval(approval)),
    };
  }

  async cancelRun(auth: AuthDto, runId: string): Promise<RoutineRunResponseDto> {
    const run = await this.findRunOrFail(auth, runId);
    if (run.status === RoutineRunStatus.Queued) {
      return mapRoutineRun(
        await this.routineRepository.updateRun(run.id, {
          status: RoutineRunStatus.Cancelled,
          finishedAt: new Date(),
          error: 'Cancelled before it started',
        }),
      );
    }
    if (run.status === RoutineRunStatus.Running) {
      // the job checks the flag every few seconds and stops the agent
      return mapRoutineRun(await this.routineRepository.updateRun(run.id, { cancelRequested: true }));
    }
    return mapRoutineRun(run);
  }

  /** undoes every change of a run: the changes it made, and the queued ones applied since */
  async undoRun(auth: AuthDto, runId: string): Promise<ActivityUndoResponseDto> {
    const run = await this.findRunOrFail(auth, runId);
    return BaseService.create(ActivityLogService, this).undoAll(auth, { groupId: run.id });
  }

  /** the Routines inbox: the changes of runs that wait for the user */
  async getInbox(auth: AuthDto): Promise<RoutineApprovalResponseDto[]> {
    const approvals = await this.routineRepository.getPendingApprovals(auth.user.id);
    return approvals.map((approval) => mapRoutineApproval(approval));
  }

  /**
   * Approves or denies queued changes, one by one or every change of a run. Approving one makes the recorded tool call
   * again, as the user and with the run's activity group, so that it is undone with the run.
   */
  async decide(auth: AuthDto, dto: RoutineApprovalDecisionDto): Promise<RoutineApprovalDecisionResponseDto> {
    const ids = new Set(dto.ids);
    if (dto.runId) {
      const run = await this.findRunOrFail(auth, dto.runId);
      for (const approval of await this.routineRepository.getApprovals(run.id)) {
        if (approval.status === RoutineApprovalStatus.Pending) {
          ids.add(approval.id);
        }
      }
    }

    const now = new Date();
    const status = dto.approve ? RoutineApprovalStatus.Applying : RoutineApprovalStatus.Denied;
    const claimed = await this.routineRepository.claimApprovals(auth.user.id, [...ids], status, now);
    const claimedIds = new Set(claimed.map(({ id }) => id));
    const unclaimed = await this.routineRepository.getApprovalsByIds(
      auth.user.id,
      [...ids].filter((id) => !claimedIds.has(id)),
    );

    const results: Approval[] = [];
    if (dto.approve) {
      const runs = new Map<string, Run | undefined>();
      for (const approval of claimed.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
        if (!runs.has(approval.runId)) {
          runs.set(approval.runId, await this.routineRepository.getRun(approval.runId));
        }
        results.push(await this.applyApproval(auth, approval, runs.get(approval.runId)));
      }
    } else {
      results.push(...claimed);
    }

    return {
      results: [...results, ...unclaimed].map((approval) => mapRoutineApproval(approval)),
      applied: results.filter(({ status }) => status === RoutineApprovalStatus.Applied).length,
      denied: results.filter(({ status }) => status === RoutineApprovalStatus.Denied).length,
      failed: results.filter(({ status }) => status === RoutineApprovalStatus.Failed).length,
      skipped: unclaimed.length,
    };
  }

  /** Sends a photo to a routine, from the "Send to assistant routine" step of a Workflow; false when it can't */
  async sendFromWorkflow(auth: AuthDto, routineId: string, assetId: string): Promise<boolean> {
    const routine = await this.routineRepository.get(routineId);
    if (!routine || routine.ownerId !== auth.user.id || !routine.enabled || routine.pausedAt) {
      return false;
    }
    await this.routineRepository.addEvents([{ routineId, kind: RoutineEvent.Workflow, assetIds: [assetId] }]);
    return true;
  }

  @OnEvent({ name: 'AssetMetadataExtracted' })
  async onAssetMetadataExtracted({ assetId, userId, source }: ArgOf<'AssetMetadataExtracted'>) {
    // only new uploads, not a metadata refresh or the sidecar written back
    if (source !== 'upload') {
      return;
    }
    await this.addEvent(userId, RoutineEvent.Upload, [assetId]);
  }

  @OnEvent({ name: 'AssetTag' })
  async onAssetTag({ assetId, userId, tagIds = [] }: ArgOf<'AssetTag'>) {
    if (!(await this.hasEventRoutines(userId, RoutineEvent.Tag))) {
      return;
    }
    const tags: string[] = [];
    for (const tagId of tagIds) {
      const tag = await this.tagRepository.get(tagId);
      if (tag) {
        tags.push(tag.value);
      }
    }
    await this.addEvent(userId, RoutineEvent.Tag, [assetId], (routine) => {
      const filter = routine.trigger.type === RoutineTriggerType.Event ? routine.trigger.tag : undefined;
      const matching = filter ? tags.filter((tag) => isTagUnder(tag, filter)) : tags;
      return filter && matching.length === 0 ? undefined : { tags: matching };
    });
  }

  @OnEvent({ name: 'JournalVisitFound' })
  async onJournalVisitFound({ userId, pack, assetIds, title }: ArgOf<'JournalVisitFound'>) {
    await this.addEvent(userId, RoutineEvent.JournalVisit, assetIds, (routine) => {
      const filter = routine.trigger.type === RoutineTriggerType.Event ? routine.trigger.pack : undefined;
      return filter && filter !== pack ? undefined : { journal: pack, title };
    });
  }

  @OnEvent({ name: 'TripEnded' })
  async onTripEnded({ userId, memoryId, title, assetIds }: ArgOf<'TripEnded'>) {
    await this.addEvent(userId, RoutineEvent.Trip, assetIds, () => ({ memoryId, title }));
  }

  @OnEvent({ name: 'BookDraftCreate' })
  async onBookDraftCreate({ userId, bookId, kind, title, assetIds }: ArgOf<'BookDraftCreate'>) {
    await this.addEvent(userId, RoutineEvent.BookDraft, assetIds, () => ({ bookId, kind, title }));
  }

  /**
   * Every minute: expires the queued changes nobody decided in time, starts the scheduled routines that are due, and
   * the event routines whose events settled (no new one for `eventSettleMinutes`, or waiting for too long).
   */
  @OnJob({ name: JobName.RoutineTick, queue: QueueName.BackgroundTask })
  async handleTick(): Promise<JobStatus> {
    const now = new Date();
    const expired = await this.routineRepository.expireApprovals(now);
    if (expired > 0) {
      this.logger.log(`Expired ${expired} change(s) of routine runs that waited for approval`);
    }

    const { agent } = await this.getConfig({ withCache: false });
    if (!isRoutinesEnabled(agent)) {
      return JobStatus.Skipped;
    }

    for (const routine of await this.routineRepository.getDueRoutines(now)) {
      const next = getNextRunAt(routine.trigger, now) ?? null;
      if (!routine.nextRunAt || !(await this.routineRepository.claimSchedule(routine.id, routine.nextRunAt, next))) {
        continue;
      }
      await this.startRun(routine, RoutineTriggerType.Schedule).catch((error) =>
        this.logger.error(`Unable to start the scheduled run of routine ${routine.id}`, error),
      );
    }

    const settle = agent.routines.eventSettleMinutes * 60_000;
    // a long upload still gets a run now and then
    const maxWait = Math.max(settle * 6, 60 * 60_000);
    const settled = await this.routineRepository.getSettledRoutineIds(
      new Date(now.getTime() - settle),
      new Date(now.getTime() - maxWait),
    );
    for (const id of settled) {
      const routine = await this.routineRepository.get(id);
      if (routine) {
        await this.startRun(routine, RoutineTriggerType.Event).catch((error) =>
          this.logger.error(`Unable to start the run of routine ${id}`, error),
        );
      }
    }

    return JobStatus.Success;
  }

  /** A run: a headless assistant session with the routine's instruction, scope and approval mode */
  @OnJob({ name: JobName.RoutineRun, queue: QueueName.BackgroundTask })
  async handleRun({ id }: JobOf<JobName.RoutineRun>): Promise<JobStatus> {
    const run = await this.routineRepository.getRun(id);
    if (!run || run.status !== RoutineRunStatus.Queued) {
      return JobStatus.Skipped;
    }
    const routine = await this.routineRepository.get(run.routineId);
    if (!routine) {
      return JobStatus.Skipped;
    }

    const { agent } = await this.getConfig({ withCache: false });
    if (!isRoutinesEnabled(agent)) {
      await this.routineRepository.updateRun(id, {
        status: RoutineRunStatus.Skipped,
        error: 'The assistant or routines are turned off',
        finishedAt: new Date(),
      });
      return JobStatus.Skipped;
    }

    // the runs of the server share `maxConcurrentRuns`: this one waits its turn
    if ((await this.routineRepository.countRunning()) >= agent.routines.maxConcurrentRuns) {
      await this.jobRepository.queue({ name: JobName.RoutineRun, data: { id, delay: ROUTINE_RETRY_DELAY_MS } });
      return JobStatus.Success;
    }

    const token = randomBytes(32).toString('base64url');
    const claimed = await this.routineRepository.claimRun(id, hashRoutineToken(token));
    if (!claimed) {
      return JobStatus.Skipped;
    }
    const session = claimed.sessionId ? await this.agentRepository.getSession(claimed.sessionId) : undefined;

    let result: HeadlessRunResult;
    if (session) {
      const text = buildRoutinePrompt({
        name: routine.name,
        instruction: routine.instruction,
        trigger: claimed.trigger,
        mode: claimed.approvalMode,
        scope: routine.scope,
        context: claimed.context,
        limits: claimed.limits,
      });
      const dryRun = claimed.approvalMode === RoutineApprovalMode.DryRun ? ' (dry run)' : '';
      try {
        result = await BaseService.create(AgentService, this).runHeadless({
          session,
          text,
          displayText: `${routine.instruction}${dryRun}`,
          token,
          timeoutMs: claimed.limits.minutes * 60_000,
          isCancelled: async () => {
            const current = await this.routineRepository.getRun(id);
            return current?.cancelRequested ?? true;
          },
        });
      } catch (error: Error | unknown) {
        result = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    } else {
      result = { status: 'failed', error: 'The transcript of the run was deleted' };
    }

    const status =
      result.status === 'completed'
        ? RoutineRunStatus.Succeeded
        : result.status === 'cancelled'
          ? RoutineRunStatus.Cancelled
          : RoutineRunStatus.Failed;
    const finished = await this.routineRepository.updateRun(id, {
      status,
      summary: result.summary ? truncateText(result.summary, 4000) : null,
      error: result.error ? truncateText(result.error, 1000) : null,
      tokenHash: null,
      finishedAt: new Date(),
    });

    const updated = await this.recordOutcome(routine, status, agent);
    await this.notifyRun(updated, finished);
    return status === RoutineRunStatus.Failed ? JobStatus.Failed : JobStatus.Success;
  }

  /**
   * Starts a run of the routine, unless a limit is reached: the reason is returned (and, for a scheduled run, recorded
   * as a skipped run); the events of an event routine then wait for a later run. Returns undefined when an event
   * routine has nothing left to run on.
   */
  async startRun(
    routine: Routine,
    trigger: RoutineTriggerType,
    { dryRun = false, manual = false }: { dryRun?: boolean; manual?: boolean } = {},
  ): Promise<Run | string | undefined> {
    const { agent } = await this.getConfig({ withCache: true });
    const reason = await this.getLimitReason(routine, agent);
    if (reason) {
      if (trigger === RoutineTriggerType.Schedule) {
        await this.routineRepository.createRun({
          routineId: routine.id,
          ownerId: routine.ownerId,
          trigger,
          approvalMode: routine.approvalMode,
          limits: routine.limits,
          status: RoutineRunStatus.Skipped,
          error: reason,
          finishedAt: new Date(),
        });
      }
      if (!manual) {
        this.logger.log(`Routine ${routine.id} did not run: ${reason}`);
      }
      return reason;
    }

    const events = await this.routineRepository.takeEvents(routine.id);
    const context = await this.buildContext(routine, events);
    if (trigger === RoutineTriggerType.Event && !context.assetIds?.length && !context.events?.length) {
      return;
    }

    const profile =
      routine.profile && getAgentProfile(agent, routine.profile) ? routine.profile : (agent.chatProfile as string);
    const session = await this.agentRepository.createSession({
      userId: routine.ownerId,
      title: `Routine: ${routine.name}`,
      profile,
      autoApprove: false,
    });
    const run = await this.routineRepository.createRun({
      routineId: routine.id,
      ownerId: routine.ownerId,
      sessionId: session.id,
      trigger,
      approvalMode: dryRun ? RoutineApprovalMode.DryRun : routine.approvalMode,
      context,
      limits: capLimits(routine.limits, agent.routines),
    });
    await this.routineRepository.update(routine.id, { lastRunAt: new Date() });
    await this.jobRepository.queue({ name: JobName.RoutineRun, data: { id: run.id } });
    return run;
  }

  private async getLimitReason(routine: Routine, agent: AgentConfig): Promise<string | undefined> {
    if (!isRoutinesEnabled(agent)) {
      return 'The assistant or routines are turned off';
    }
    if (routine.pausedAt) {
      return 'The routine is paused after repeated failures; resume it first';
    }
    const since = new Date(Date.now() - DAY_MS);
    const limit = Math.min(routine.limits.runsPerDay, agent.routines.maxRunsPerDay);
    if ((await this.routineRepository.countRoutineRuns(routine.id, since)) >= limit) {
      return `The routine ran ${limit} time(s) in the last 24 hours, its limit`;
    }
    if ((await this.routineRepository.countOwnerRuns(routine.ownerId, since)) >= agent.routines.maxRunsPerDay) {
      return `Your routines ran ${agent.routines.maxRunsPerDay} times in the last 24 hours, the limit of this server`;
    }
  }

  /**
   * What a run is started with: the photos of its events (without the ones routine runs changed or made, so that a
   * routine can't start itself again), the events that are not only photos, and when the last run was.
   */
  private async buildContext(routine: Routine, events: RoutineEventRow[]): Promise<RoutineRunContext> {
    const own = new Set(
      events.length > 0
        ? await this.routineRepository.getRunAssetIds(routine.ownerId, new Date(Date.now() - LOOP_GUARD_DAYS * DAY_MS))
        : [],
    );
    const assetIds = [...new Set(events.flatMap((event) => event.assetIds)).difference(own)];

    const summaries: RoutineRunEvent[] = [];
    const byKind = new Map<string, RoutineEventRow[]>();
    for (const event of events.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (PHOTO_EVENTS.has(event.kind)) {
        byKind.set(event.kind, [...(byKind.get(event.kind) ?? []), event]);
      } else {
        summaries.push({
          kind: event.kind,
          at: event.createdAt.toISOString(),
          ...(event.data && { data: event.data }),
        });
      }
    }
    for (const [kind, items] of byKind) {
      const ids = new Set(items.flatMap((item) => item.assetIds).filter((id) => !own.has(id)));
      if (ids.size === 0) {
        continue;
      }
      const tags = [...new Set(items.flatMap((item) => (item.data?.tags as string[] | undefined) ?? []))];
      summaries.push({
        kind,
        at: items.at(-1)!.createdAt.toISOString(),
        data: { photos: ids.size, ...(tags.length > 0 && { tags }) },
      });
    }

    return {
      ...(assetIds.length > 0 && { assetIds: assetIds.slice(0, ROUTINE_MAX_CONTEXT_ASSETS) }),
      ...(assetIds.length > ROUTINE_MAX_CONTEXT_ASSETS && { moreAssets: assetIds.length - ROUTINE_MAX_CONTEXT_ASSETS }),
      ...(summaries.length > 0 && { events: summaries }),
      ...(routine.lastRunAt && { since: routine.lastRunAt.toISOString() }),
    };
  }

  /** counts the failures in a row of a routine, and pauses it after too many */
  private async recordOutcome(routine: Routine, status: RoutineRunStatus, agent: AgentConfig): Promise<Routine> {
    if (status === RoutineRunStatus.Succeeded) {
      return routine.consecutiveFailures > 0
        ? this.routineRepository.update(routine.id, { consecutiveFailures: 0 })
        : routine;
    }
    if (status !== RoutineRunStatus.Failed) {
      return routine;
    }
    const failures = routine.consecutiveFailures + 1;
    const pause = failures >= agent.routines.pauseAfterFailures && !routine.pausedAt;
    return this.routineRepository.update(routine.id, {
      consecutiveFailures: failures,
      ...(pause && { pausedAt: new Date() }),
    });
  }

  /** "Routine “Name dishes” ran: 12 changes · 2 need your OK", which opens the run */
  private async notifyRun(routine: Routine, run: Run) {
    if (run.status === RoutineRunStatus.Cancelled) {
      return;
    }
    try {
      const approvals = await this.routineRepository.getApprovals(run.id);
      const pending = approvals.filter(({ status }) => status === RoutineApprovalStatus.Pending).length;
      const reported = approvals.filter(({ status }) => status === RoutineApprovalStatus.DryRun).length;
      const failed = run.status === RoutineRunStatus.Failed;
      const paused = failed && !!routine.pausedAt && routine.consecutiveFailures > 0;
      const title = paused
        ? `Routine ${quote(routine.name)} was paused`
        : failed
          ? `Routine ${quote(routine.name)} failed`
          : `Routine ${quote(routine.name)} ran`;
      const description = paused
        ? `It failed ${routine.consecutiveFailures} times in a row. Check its last run, then resume it`
        : failed
          ? truncateText(run.error ?? 'The run failed', 200)
          : describeRunOutcome({ changes: run.changes, pending, reported });
      const notification = await this.notificationRepository.create({
        userId: run.ownerId,
        type: NotificationType.Custom,
        level: failed ? NotificationLevel.Error : NotificationLevel.Info,
        title,
        description,
        data: JSON.stringify({ routineRunId: run.id, routineId: routine.id }),
      });
      this.websocketRepository.clientSend('on_notification', run.ownerId, mapNotification(notification));
    } catch (error) {
      this.logger.warn(`Unable to notify about routine run ${run.id}: ${error}`);
    }
  }

  /** makes the recorded tool call of an approved change, as the user, in the run's activity group */
  private async applyApproval(auth: AuthDto, approval: Approval, run: Run | undefined): Promise<Approval> {
    const finish = (status: RoutineApprovalStatus, result: string, activityIds: string[] = []) =>
      this.routineRepository.updateApproval(approval.id, {
        status,
        result: truncateText(result, 2000),
        activityIds,
      });

    const tool = BaseService.create(AgentToolService, this).getTool(approval.toolName);
    if (!tool || !run) {
      return finish(RoutineApprovalStatus.Failed, tool ? 'The run was deleted' : `Unknown tool ${approval.toolName}`);
    }
    const input = tool.input.safeParse(approval.input);
    if (!input.success) {
      return finish(RoutineApprovalStatus.Failed, `The recorded arguments are no longer valid: ${input.error.message}`);
    }

    const activity = ActivityRecorder.assistant({ sessionId: run.sessionId, toolName: tool.name, groupId: run.id });
    try {
      const result = await tool.handler({ auth, sessionId: run.sessionId, activity }, input.data);
      const { texts } = getToolCallResult({ rawOutput: result });
      return finish(
        result.isError ? RoutineApprovalStatus.Failed : RoutineApprovalStatus.Applied,
        texts.join('\n'),
        activity.ids,
      );
    } catch (error: Error | unknown) {
      this.logger.warn(`Applying change ${approval.id} (${approval.toolName}) failed: ${error}`);
      return finish(RoutineApprovalStatus.Failed, error instanceof Error ? error.message : String(error), activity.ids);
    }
  }

  /** adds an event to the user's routines that run after it; `filter` gives its data, or undefined to skip a routine */
  private async addEvent(
    userId: string,
    kind: RoutineEvent,
    assetIds: string[],
    filter: (routine: Routine) => Record<string, unknown> | undefined = () => ({}),
  ) {
    try {
      if (!(await this.hasEventRoutines(userId, kind))) {
        return;
      }
      const routines = await this.routineRepository.getEventRoutines(userId, kind);
      const events = routines.flatMap((routine) => {
        const data = filter(routine);
        return data
          ? [{ routineId: routine.id, kind, assetIds, data: Object.keys(data).length > 0 ? data : null }]
          : [];
      });
      await this.routineRepository.addEvents(events);
    } catch (error) {
      // an event lost is a run missed, never a failed upload
      this.logger.warn(`Unable to add a ${kind} event for the routines of user ${userId}: ${error}`);
    }
  }

  private async hasEventRoutines(userId: string, kind: RoutineEvent) {
    const now = Date.now();
    let cached = eventOwners.get(kind);
    if (!cached || now - cached.at > EVENT_OWNERS_TTL_MS) {
      cached = { at: now, owners: new Set(await this.routineRepository.getEventOwners(kind)) };
      eventOwners.set(kind, cached);
    }
    return cached.owners.has(userId);
  }

  /** the trigger as stored, checked (the assistant's create_routine passes it without the DTO's checks) */
  private toTrigger(dto: RoutineTriggerDto): RoutineTrigger {
    if (dto.type === RoutineTriggerType.Schedule) {
      try {
        validateCron(dto.cron ?? '', dto.timezone);
      } catch (error) {
        throw new BadRequestException(`Invalid schedule: ${(error as Error).message}`);
      }
    }
    if (dto.type === RoutineTriggerType.Event && !dto.event) {
      throw new BadRequestException('An event trigger needs an event');
    }
    return toRoutineTrigger(dto);
  }

  private requireProfile(agent: AgentConfig, profile: string | null | undefined) {
    if (profile && !getAgentProfile(agent, profile)) {
      throw new BadRequestException(`Unknown agent profile: ${profile}`);
    }
  }

  private async findOrFail(auth: AuthDto, id: string): Promise<Routine> {
    const routine = await this.routineRepository.get(id);
    if (!routine || routine.ownerId !== auth.user.id) {
      throw new BadRequestException('Routine not found');
    }
    return routine;
  }

  private async findRunOrFail(auth: AuthDto, id: string): Promise<Run> {
    const run = await this.routineRepository.getRun(id);
    if (!run || run.ownerId !== auth.user.id) {
      throw new BadRequestException('Routine run not found');
    }
    return run;
  }

  private async toDto(auth: AuthDto, routine: Routine): Promise<RoutineResponseDto> {
    const [lastRun] = await this.routineRepository.getLatestRuns([routine.id]);
    const pending = await this.routineRepository.getPendingApprovals(auth.user.id);
    return mapRoutine(routine, {
      lastRun,
      pendingApprovals: pending.filter(({ routineId }) => routineId === routine.id).length,
      pendingEvents: await this.routineRepository.countEvents(routine.id),
    });
  }
}

/** clears the cache of the users with event routines, after a routine is made or changed (and in tests) */
export const clearRoutineEventOwners = () => eventOwners.clear();

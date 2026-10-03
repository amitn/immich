import { BadRequestException } from '@nestjs/common';
import z from 'zod';
import type { MockInstance } from 'vitest';
import {
  ActivityLogAction,
  JobName,
  JobStatus,
  NotificationLevel,
  RoutineApprovalMode,
  RoutineApprovalStatus,
  RoutineEvent,
  RoutineRunStatus,
  RoutineTriggerType,
} from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { AgentToolService } from 'src/services/agent-tool.service.js';
import { AgentService } from 'src/services/agent.service.js';
import { ROUTINE_RETRY_DELAY_MS, RoutineService, clearRoutineEventOwners } from 'src/services/routine.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';
import { clearConfigCache } from 'src/utils/config.js';
import { hashRoutineToken } from 'src/utils/routines.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const DAY = 24 * 60 * 60 * 1000;
const limits = { runsPerDay: 4, minutes: 15, toolCalls: 100 };

const albumTool = defineTool({
  name: 'create_album',
  title: 'Create album',
  description: 'Create an album',
  input: z.object({ name: z.string(), assetIds: z.array(z.string()) }),
  mutating: true,
  handler: vi.fn(),
});

describe(RoutineService.name, () => {
  let sut: RoutineService;
  let mocks: ServiceMocks;
  const auth = factory.auth();

  const routineRow = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'routine-1',
      ownerId: auth.user.id,
      name: 'Name dishes',
      instruction: 'Name the dishes of new restaurant visits',
      trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Upload },
      scope: {},
      approvalMode: RoutineApprovalMode.Ask,
      limits,
      profile: null,
      enabled: true,
      pausedAt: null,
      consecutiveFailures: 0,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
      ...overrides,
    }) as never;

  const runRow = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'run-1',
      routineId: 'routine-1',
      ownerId: auth.user.id,
      sessionId: 'session-1',
      trigger: RoutineTriggerType.Event,
      approvalMode: RoutineApprovalMode.Ask,
      status: RoutineRunStatus.Queued,
      context: { assetIds: ['asset-1'] },
      limits,
      summary: null,
      error: null,
      toolCalls: 0,
      changes: 0,
      tokenHash: null,
      cancelRequested: false,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as never;

  const approvalRow = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'approval-1',
      runId: 'run-1',
      ownerId: auth.user.id,
      toolName: 'create_album',
      title: 'Create album',
      summary: 'Name: Italy · 1 photo',
      input: { name: 'Italy', assetIds: ['5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10'] },
      status: RoutineApprovalStatus.Pending,
      result: null,
      activityIds: [],
      expiresAt: new Date(Date.now() + DAY),
      decidedAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as never;

  const setConfig = (agent: Record<string, unknown> = {}, routines: Record<string, unknown> = {}) => {
    clearConfigCache();
    mocks.systemMetadata.get.mockResolvedValue({ agent: { enabled: true, ...agent, routines } });
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(RoutineService));
    clearRoutineEventOwners();
    setConfig();
    vi.spyOn(AgentToolService.prototype, 'getTool').mockImplementation((name) =>
      name === albumTool.name ? albumTool : undefined,
    );
    vi.mocked(albumTool.handler).mockReset();

    mocks.routine.countByOwner.mockResolvedValue(0);
    mocks.routine.create.mockImplementation((values) => Promise.resolve(routineRow(values)));
    mocks.routine.update.mockImplementation((id, values) => Promise.resolve(routineRow({ id, ...values })));
    mocks.routine.get.mockResolvedValue(routineRow());
    mocks.routine.getLatestRuns.mockResolvedValue([]);
    mocks.routine.getPendingApprovals.mockResolvedValue([]);
    mocks.routine.countEvents.mockResolvedValue(0);
    mocks.routine.countRoutineRuns.mockResolvedValue(0);
    mocks.routine.countOwnerRuns.mockResolvedValue(0);
    mocks.routine.takeEvents.mockResolvedValue([]);
    mocks.routine.getRunAssetIds.mockResolvedValue([]);
    mocks.routine.createRun.mockImplementation((values) => Promise.resolve(runRow(values)));
    mocks.routine.updateRun.mockImplementation((id, values) => Promise.resolve(runRow({ id, ...values })));
    mocks.routine.addEvents.mockResolvedValue();
    mocks.routine.expireApprovals.mockResolvedValue(0);
    mocks.routine.getDueRoutines.mockResolvedValue([]);
    mocks.routine.getSettledRoutineIds.mockResolvedValue([]);
    mocks.routine.getApprovals.mockResolvedValue([]);
    mocks.routine.getApprovalsByIds.mockResolvedValue([]);
    mocks.agent.createSession.mockResolvedValue({ id: 'session-1' } as never);
    mocks.job.queue.mockResolvedValue();
    mocks.notification.create.mockResolvedValue({ id: 'notification-1', createdAt: new Date() } as never);
    mocks.activityLog.create.mockResolvedValue({ id: 'change-1' } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('create', () => {
    const dto = {
      name: 'Name dishes',
      instruction: 'Name the dishes',
      trigger: { type: RoutineTriggerType.Schedule, cron: '0 2 * * *', timezone: 'UTC' },
    };

    it('starts in Ask me with limits under the server caps, and schedules the first run', async () => {
      setConfig({}, { maxRunMinutes: 10 });
      await sut.create(auth, { ...dto, limits: { minutes: 60, toolCalls: 50 } });

      expect(mocks.routine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: auth.user.id,
          approvalMode: RoutineApprovalMode.Ask,
          trigger: { type: RoutineTriggerType.Schedule, cron: '0 2 * * *', timezone: 'UTC' },
          limits: { runsPerDay: 4, minutes: 10, toolCalls: 50 },
          nextRunAt: expect.any(Date),
          profile: null,
        }),
      );
      const { nextRunAt } = mocks.routine.create.mock.calls[0][0] as { nextRunAt: Date };
      expect(nextRunAt.getUTCHours()).toBe(2);
    });

    it('keeps only the fields of the trigger type', async () => {
      await sut.create(auth, {
        ...dto,
        trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'print', pack: 'food', cron: 'x' },
      });
      expect(mocks.routine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'print' },
          nextRunAt: null,
        }),
      );
    });

    it('refuses a bad schedule, an unknown profile and too many routines', async () => {
      await expect(
        sut.create(auth, { ...dto, trigger: { type: RoutineTriggerType.Schedule, cron: 'nightly' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.create(auth, { ...dto, profile: 'missing' })).rejects.toThrow('Unknown agent profile');
      mocks.routine.countByOwner.mockResolvedValue(20);
      await expect(sut.create(auth, dto)).rejects.toThrow('at most 20 routines');
      expect(mocks.routine.create).not.toHaveBeenCalled();
    });

    it('records a routine made by the assistant in the activity log, to be undone', async () => {
      const activity = ActivityRecorder.assistant({ sessionId: 'chat-1', toolName: 'create_routine', groupId: 'turn' });
      await sut.create(auth, dto, activity);
      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ActivityLogAction.RoutineCreate,
          targetId: 'routine-1',
          undo: { routineId: 'routine-1', updatedAt: '2026-10-01T00:00:00.000Z' },
        }),
      );
      expect(activity.ids).toEqual(['change-1']);
    });
  });

  describe('update', () => {
    it('resumes a paused routine and schedules it from now', async () => {
      mocks.routine.get.mockResolvedValue(
        routineRow({
          pausedAt: new Date(),
          consecutiveFailures: 3,
          trigger: { type: RoutineTriggerType.Schedule, cron: '0 2 * * *' },
        }),
      );
      await sut.update(auth, 'routine-1', { paused: false });
      expect(mocks.routine.update).toHaveBeenCalledWith('routine-1', {
        pausedAt: null,
        consecutiveFailures: 0,
        nextRunAt: expect.any(Date),
      });
    });

    it("refuses another user's routine", async () => {
      mocks.routine.get.mockResolvedValue(routineRow({ ownerId: 'someone-else' }));
      await expect(sut.update(auth, 'routine-1', { name: 'Mine' })).rejects.toThrow('Routine not found');
    });
  });

  describe('events', () => {
    it('adds the photos of new uploads to the routines that run after uploads', async () => {
      mocks.routine.getEventOwners.mockResolvedValue([auth.user.id]);
      mocks.routine.getEventRoutines.mockResolvedValue([routineRow()]);

      await sut.onAssetMetadataExtracted({ assetId: 'asset-1', userId: auth.user.id, source: 'upload' });

      expect(mocks.routine.addEvents).toHaveBeenCalledWith([
        { routineId: 'routine-1', kind: RoutineEvent.Upload, assetIds: ['asset-1'], data: null },
      ]);
    });

    it('ignores metadata refreshes and users without such routines, cheaply', async () => {
      mocks.routine.getEventOwners.mockResolvedValue(['someone-else']);

      await sut.onAssetMetadataExtracted({ assetId: 'asset-1', userId: auth.user.id, source: 'sidecar-write' });
      await sut.onAssetMetadataExtracted({ assetId: 'asset-1', userId: auth.user.id, source: 'upload' });
      await sut.onAssetMetadataExtracted({ assetId: 'asset-2', userId: auth.user.id, source: 'upload' });

      expect(mocks.routine.getEventRoutines).not.toHaveBeenCalled();
      // the owners are cached between uploads
      expect(mocks.routine.getEventOwners).toHaveBeenCalledTimes(1);
    });

    it('filters tag events by the tag of the routine', async () => {
      mocks.routine.getEventOwners.mockResolvedValue([auth.user.id]);
      mocks.routine.getEventRoutines.mockResolvedValue([
        routineRow({ id: 'print', trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'print' } }),
        routineRow({ id: 'food', trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'Food' } }),
        routineRow({ id: 'any', trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Tag } }),
      ]);
      mocks.tag.get.mockResolvedValue({ id: 'tag-1', value: 'Print/Wedding' } as never);

      await sut.onAssetTag({ assetId: 'asset-1', userId: auth.user.id, tagIds: ['tag-1'] });

      expect(mocks.routine.addEvents).toHaveBeenCalledWith([
        { routineId: 'print', kind: RoutineEvent.Tag, assetIds: ['asset-1'], data: { tags: ['Print/Wedding'] } },
        { routineId: 'any', kind: RoutineEvent.Tag, assetIds: ['asset-1'], data: { tags: ['Print/Wedding'] } },
      ]);
    });

    it('filters journal visits by the journal of the routine', async () => {
      mocks.routine.getEventOwners.mockResolvedValue([auth.user.id]);
      mocks.routine.getEventRoutines.mockResolvedValue([
        routineRow({
          id: 'food',
          trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.JournalVisit, pack: 'food' },
        }),
        routineRow({
          id: 'museum',
          trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.JournalVisit, pack: 'museum' },
        }),
      ]);

      await sut.onJournalVisitFound({ userId: auth.user.id, pack: 'food', assetIds: ['a', 'b'], title: 'Dinner?' });

      expect(mocks.routine.addEvents).toHaveBeenCalledWith([
        {
          routineId: 'food',
          kind: RoutineEvent.JournalVisit,
          assetIds: ['a', 'b'],
          data: { journal: 'food', title: 'Dinner?' },
        },
      ]);
    });

    it('takes photos from a Workflow for an enabled routine of the owner only', async () => {
      await expect(sut.sendFromWorkflow(auth, 'routine-1', 'asset-1')).resolves.toBe(true);
      expect(mocks.routine.addEvents).toHaveBeenCalledWith([
        { routineId: 'routine-1', kind: RoutineEvent.Workflow, assetIds: ['asset-1'] },
      ]);

      mocks.routine.get.mockResolvedValue(routineRow({ ownerId: 'someone-else' }));
      await expect(sut.sendFromWorkflow(auth, 'routine-1', 'asset-1')).resolves.toBe(false);
      mocks.routine.get.mockResolvedValue(routineRow({ pausedAt: new Date() }));
      await expect(sut.sendFromWorkflow(auth, 'routine-1', 'asset-1')).resolves.toBe(false);
    });
  });

  describe('handleTick', () => {
    it('expires the queued changes nobody decided in time, even with routines off', async () => {
      setConfig({}, { enabled: false });
      mocks.routine.expireApprovals.mockResolvedValue(2);

      await expect(sut.handleTick()).resolves.toBe(JobStatus.Skipped);

      expect(mocks.routine.expireApprovals).toHaveBeenCalledWith(expect.any(Date));
      expect(mocks.routine.getDueRoutines).not.toHaveBeenCalled();
    });

    it('starts a due scheduled routine once, and moves it to its next run', async () => {
      const due = new Date(Date.now() - 1000);
      const routine = routineRow({ trigger: { type: RoutineTriggerType.Schedule, cron: '0 2 * * *' }, nextRunAt: due });
      mocks.routine.getDueRoutines.mockResolvedValue([routine, routine]);
      mocks.routine.claimSchedule.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await sut.handleTick();

      expect(mocks.routine.claimSchedule).toHaveBeenCalledWith('routine-1', due, expect.any(Date));
      expect(mocks.routine.createRun).toHaveBeenCalledTimes(1);
      expect(mocks.routine.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: RoutineTriggerType.Schedule, sessionId: 'session-1' }),
      );
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.RoutineRun, data: { id: 'run-1' } });
    });

    it('starts the event routines once their events settle, with the photos batched in one run', async () => {
      setConfig({}, { eventSettleMinutes: 10 });
      const now = Date.now();
      mocks.routine.getSettledRoutineIds.mockResolvedValue(['routine-1']);
      mocks.routine.takeEvents.mockResolvedValue([
        { kind: RoutineEvent.Upload, assetIds: ['a'], data: null, createdAt: new Date(now - 20 * 60_000) },
        { kind: RoutineEvent.Upload, assetIds: ['b', 'a'], data: null, createdAt: new Date(now - 15 * 60_000) },
        { kind: RoutineEvent.Upload, assetIds: ['made-by-a-run'], data: null, createdAt: new Date(now - 14 * 60_000) },
      ] as never);
      // a copy a routine run made is not a new upload for the routines
      mocks.routine.getRunAssetIds.mockResolvedValue(['made-by-a-run']);

      await sut.handleTick();

      const [settledBefore, maxWaitBefore] = mocks.routine.getSettledRoutineIds.mock.calls[0];
      expect(now - settledBefore.getTime()).toBeGreaterThanOrEqual(10 * 60_000);
      expect(now - maxWaitBefore.getTime()).toBeGreaterThanOrEqual(60 * 60_000);
      expect(mocks.routine.createRun).toHaveBeenCalledTimes(1);
      expect(mocks.routine.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: RoutineTriggerType.Event,
          approvalMode: RoutineApprovalMode.Ask,
          context: {
            assetIds: ['a', 'b'],
            events: [{ kind: RoutineEvent.Upload, at: expect.any(String), data: { photos: 2 } }],
          },
        }),
      );
    });

    it('does not run an event routine on its own changes only', async () => {
      mocks.routine.getSettledRoutineIds.mockResolvedValue(['routine-1']);
      mocks.routine.takeEvents.mockResolvedValue([
        { kind: RoutineEvent.Tag, assetIds: ['mine'], data: { tags: ['Food/Noma'] }, createdAt: new Date() },
      ] as never);
      mocks.routine.getRunAssetIds.mockResolvedValue(['mine']);

      await sut.handleTick();

      expect(mocks.routine.createRun).not.toHaveBeenCalled();
    });

    it('keeps the events of a routine at its daily limit for a later run', async () => {
      mocks.routine.getSettledRoutineIds.mockResolvedValue(['routine-1']);
      mocks.routine.countRoutineRuns.mockResolvedValue(4);

      await sut.handleTick();

      expect(mocks.routine.takeEvents).not.toHaveBeenCalled();
      expect(mocks.routine.createRun).not.toHaveBeenCalled();
    });

    it('records a skipped run when a schedule reaches the limit of the user', async () => {
      setConfig({}, { maxRunsPerDay: 10 });
      const due = new Date(Date.now() - 1000);
      mocks.routine.getDueRoutines.mockResolvedValue([
        routineRow({ trigger: { type: RoutineTriggerType.Schedule, cron: '0 2 * * *' }, nextRunAt: due }),
      ]);
      mocks.routine.claimSchedule.mockResolvedValue(true);
      mocks.routine.countOwnerRuns.mockResolvedValue(10);

      await sut.handleTick();

      expect(mocks.routine.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: RoutineRunStatus.Skipped, error: expect.stringContaining('limit') }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    it('queues a dry run with the waiting events', async () => {
      mocks.routine.takeEvents.mockResolvedValue([
        { kind: RoutineEvent.Workflow, assetIds: ['a'], data: null, createdAt: new Date() },
      ] as never);

      await sut.run(auth, 'routine-1', { dryRun: true });

      expect(mocks.routine.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: RoutineTriggerType.Manual,
          approvalMode: RoutineApprovalMode.DryRun,
          context: expect.objectContaining({ assetIds: ['a'] }),
        }),
      );
      expect(mocks.agent.createSession).toHaveBeenCalledWith({
        userId: auth.user.id,
        title: 'Routine: Name dishes',
        profile: 'claude',
        autoApprove: false,
      });
    });

    it('refuses to run when routines are off, paused or at the limit', async () => {
      setConfig({}, { enabled: false });
      await expect(sut.run(auth, 'routine-1', {})).rejects.toThrow('turned off');
      setConfig();
      mocks.routine.get.mockResolvedValue(routineRow({ pausedAt: new Date() }));
      await expect(sut.run(auth, 'routine-1', {})).rejects.toThrow('paused');
      mocks.routine.get.mockResolvedValue(routineRow());
      mocks.routine.countRoutineRuns.mockResolvedValue(4);
      await expect(sut.run(auth, 'routine-1', {})).rejects.toThrow('4 time(s)');
      expect(mocks.routine.createRun).not.toHaveBeenCalled();
    });
  });

  describe('handleRun', () => {
    let headless: MockInstance<AgentService['runHeadless']>;

    beforeEach(() => {
      mocks.routine.getRun.mockResolvedValue(runRow());
      mocks.routine.countRunning.mockResolvedValue(0);
      mocks.routine.claimRun.mockImplementation((id, tokenHash) =>
        Promise.resolve(runRow({ id, tokenHash, status: RoutineRunStatus.Running })),
      );
      mocks.agent.getSession.mockResolvedValue({ id: 'session-1', userId: auth.user.id, profile: 'claude' } as never);
      headless = vi
        .spyOn(AgentService.prototype, 'runHeadless')
        .mockResolvedValue({ status: 'completed', summary: 'Named 12 dishes' });
    });

    it('runs the routine headless with its token, prompt and limits, then notifies the result', async () => {
      mocks.routine.getApprovals.mockResolvedValue([approvalRow(), approvalRow({ id: 'approval-2' })]);
      mocks.routine.updateRun.mockImplementation((id, values) =>
        Promise.resolve(runRow({ id, changes: 12, ...values })),
      );

      await expect(sut.handleRun({ id: 'run-1' })).resolves.toBe(JobStatus.Success);

      const [{ token, text, displayText, timeoutMs }] = headless.mock.calls[0];
      expect(mocks.routine.claimRun).toHaveBeenCalledWith('run-1', hashRoutineToken(token));
      expect(text).toContain('Approval mode: Ask me');
      expect(text).toContain('asset-1');
      expect(displayText).toBe('Name the dishes of new restaurant visits');
      expect(timeoutMs).toBe(15 * 60_000);
      expect(mocks.routine.updateRun).toHaveBeenCalledWith('run-1', {
        status: RoutineRunStatus.Succeeded,
        summary: 'Named 12 dishes',
        error: null,
        tokenHash: null,
        finishedAt: expect.any(Date),
      });
      expect(mocks.notification.create).toHaveBeenCalledWith({
        userId: auth.user.id,
        type: 'Custom',
        level: NotificationLevel.Info,
        title: 'Routine “Name dishes” ran',
        description: '12 changes · 2 need your OK',
        data: JSON.stringify({ routineRunId: 'run-1', routineId: 'routine-1' }),
      });
    });

    it('waits its turn when the server runs as many runs as it may', async () => {
      setConfig({}, { maxConcurrentRuns: 2 });
      mocks.routine.countRunning.mockResolvedValue(2);

      await sut.handleRun({ id: 'run-1' });

      expect(headless).not.toHaveBeenCalled();
      expect(mocks.routine.claimRun).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.RoutineRun,
        data: { id: 'run-1', delay: ROUTINE_RETRY_DELAY_MS },
      });
    });

    it('skips a run that was cancelled or started meanwhile', async () => {
      mocks.routine.getRun.mockResolvedValue(runRow({ status: RoutineRunStatus.Cancelled }));
      await expect(sut.handleRun({ id: 'run-1' })).resolves.toBe(JobStatus.Skipped);

      mocks.routine.getRun.mockResolvedValue(runRow());
      mocks.routine.claimRun.mockResolvedValue(undefined);
      await expect(sut.handleRun({ id: 'run-1' })).resolves.toBe(JobStatus.Skipped);
      expect(headless).not.toHaveBeenCalled();
    });

    it('counts the failures in a row and pauses the routine after too many', async () => {
      setConfig({}, { pauseAfterFailures: 3 });
      headless.mockResolvedValue({ status: 'failed', error: 'rate limited' });
      mocks.routine.get.mockResolvedValue(routineRow({ consecutiveFailures: 1 }));

      await expect(sut.handleRun({ id: 'run-1' })).resolves.toBe(JobStatus.Failed);
      expect(mocks.routine.update).toHaveBeenLastCalledWith('routine-1', { consecutiveFailures: 2 });
      expect(mocks.notification.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: NotificationLevel.Error, title: 'Routine “Name dishes” failed' }),
      );

      mocks.routine.get.mockResolvedValue(routineRow({ consecutiveFailures: 2 }));
      await sut.handleRun({ id: 'run-1' });
      expect(mocks.routine.update).toHaveBeenLastCalledWith('routine-1', {
        consecutiveFailures: 3,
        pausedAt: expect.any(Date),
      });
      expect(mocks.notification.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Routine “Name dishes” was paused' }),
      );
    });

    it('resets the failures after a run that worked', async () => {
      mocks.routine.get.mockResolvedValue(routineRow({ consecutiveFailures: 2 }));
      await sut.handleRun({ id: 'run-1' });
      expect(mocks.routine.update).toHaveBeenCalledWith('routine-1', { consecutiveFailures: 0 });
    });

    it('stops when the user cancels, without a notification', async () => {
      headless.mockImplementation(async ({ isCancelled }) => {
        mocks.routine.getRun.mockResolvedValue(runRow({ cancelRequested: true }));
        return { status: (await isCancelled!()) ? 'cancelled' : 'completed' };
      });

      await sut.handleRun({ id: 'run-1' });

      expect(mocks.routine.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: RoutineRunStatus.Cancelled }),
      );
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('skips the run when routines were turned off', async () => {
      setConfig({}, { enabled: false });
      await expect(sut.handleRun({ id: 'run-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.routine.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: RoutineRunStatus.Skipped }),
      );
    });
  });

  describe('decide', () => {
    beforeEach(() => {
      mocks.routine.getRun.mockResolvedValue(runRow({ status: RoutineRunStatus.Succeeded }));
      mocks.routine.updateApproval.mockImplementation((id, values) => Promise.resolve(approvalRow({ id, ...values })));
    });

    it('re-applies the recorded tool call as the user, in the activity group of the run', async () => {
      mocks.routine.claimApprovals.mockResolvedValue([approvalRow({ status: RoutineApprovalStatus.Applying })]);
      vi.mocked(albumTool.handler).mockImplementation((ctx) => {
        ctx.activity!.ids.push('change-9');
        return Promise.resolve(toolJson({ albumId: 'album-1' }));
      });

      const result = await sut.decide(auth, { ids: ['approval-1'], approve: true });

      expect(mocks.routine.claimApprovals).toHaveBeenCalledWith(
        auth.user.id,
        ['approval-1'],
        RoutineApprovalStatus.Applying,
        expect.any(Date),
      );
      const [ctx, input] = vi.mocked(albumTool.handler).mock.calls[0];
      expect(input).toEqual({ name: 'Italy', assetIds: ['5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10'] });
      expect(ctx.auth).toBe(auth);
      expect(ctx.activity?.origin).toMatchObject({
        sessionId: 'session-1',
        groupId: 'run-1',
        toolName: 'create_album',
      });
      expect(mocks.routine.updateApproval).toHaveBeenCalledWith('approval-1', {
        status: RoutineApprovalStatus.Applied,
        result: '{"albumId":"album-1"}',
        activityIds: ['change-9'],
      });
      expect(result).toMatchObject({ applied: 1, failed: 0, denied: 0, skipped: 0 });
    });

    it('records a change whose tool call fails', async () => {
      mocks.routine.claimApprovals.mockResolvedValue([approvalRow()]);
      vi.mocked(albumTool.handler).mockResolvedValue(toolError('The album was deleted'));

      const result = await sut.decide(auth, { ids: ['approval-1'], approve: true });

      expect(mocks.routine.updateApproval).toHaveBeenCalledWith('approval-1', {
        status: RoutineApprovalStatus.Failed,
        result: 'The album was deleted',
        activityIds: [],
      });
      expect(result.failed).toBe(1);
    });

    it('denies every pending change of a run, and skips the decided and expired ones', async () => {
      mocks.routine.getApprovals.mockResolvedValue([
        approvalRow({ id: 'a' }),
        approvalRow({ id: 'b' }),
        approvalRow({ id: 'c', status: RoutineApprovalStatus.Applied }),
      ]);
      mocks.routine.claimApprovals.mockResolvedValue([approvalRow({ id: 'a', status: RoutineApprovalStatus.Denied })]);
      mocks.routine.getApprovalsByIds.mockResolvedValue([
        approvalRow({ id: 'b', status: RoutineApprovalStatus.Expired }),
      ]);

      const result = await sut.decide(auth, { runId: 'run-1', approve: false });

      expect(mocks.routine.claimApprovals).toHaveBeenCalledWith(
        auth.user.id,
        ['a', 'b'],
        RoutineApprovalStatus.Denied,
        expect.any(Date),
      );
      expect(albumTool.handler).not.toHaveBeenCalled();
      expect(result).toMatchObject({ denied: 1, skipped: 1, applied: 0 });
    });

    it('refuses the run of another user', async () => {
      mocks.routine.getRun.mockResolvedValue(runRow({ ownerId: 'someone-else' }));
      await expect(sut.decide(auth, { runId: 'run-1', approve: true })).rejects.toThrow('Routine run not found');
    });
  });

  it('undoes a run as one group of the activity log', async () => {
    mocks.routine.getRun.mockResolvedValue(runRow());
    const undoAll = vi
      .spyOn(ActivityLogService.prototype, 'undoAll')
      .mockResolvedValue({ results: [], undone: 3, refused: 0 });

    await expect(sut.undoRun(auth, 'run-1')).resolves.toMatchObject({ undone: 3 });
    expect(undoAll).toHaveBeenCalledWith(auth, { groupId: 'run-1' });
  });

  it('stops a running run through its flag, and cancels a queued one', async () => {
    mocks.routine.getRun.mockResolvedValue(runRow({ status: RoutineRunStatus.Running }));
    await sut.cancelRun(auth, 'run-1');
    expect(mocks.routine.updateRun).toHaveBeenCalledWith('run-1', { cancelRequested: true });

    mocks.routine.getRun.mockResolvedValue(runRow());
    await sut.cancelRun(auth, 'run-1');
    expect(mocks.routine.updateRun).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({ status: RoutineRunStatus.Cancelled }),
    );
  });
});

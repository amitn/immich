import { BadRequestException } from '@nestjs/common';
import { RoutineApprovalMode, RoutineEvent, RoutineTriggerType } from 'src/enum.js';
import { RoutineAgentTools } from 'src/services/agent-tools/routine.tools.js';
import { RoutineService } from 'src/services/routine.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { AgentTool, AgentToolContext } from 'src/utils/agent/tools.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newTestService } from 'test/utils.js';

const text = (result: Awaited<ReturnType<AgentTool['handler']>>) =>
  result.content.find((item) => item.type === 'text')?.text ?? '';

describe(RoutineAgentTools.name, () => {
  let tools: Map<string, AgentTool>;
  const activity = ActivityRecorder.assistant({ sessionId: 'session-1', toolName: 'create_routine', groupId: 'turn' });
  const ctx: AgentToolContext = { auth: authStub.admin, sessionId: 'session-1', activity };

  const call = (name: string, input: Record<string, unknown> = {}) => tools.get(name)!.handler(ctx, input as never);

  beforeEach(() => {
    const { sut } = newTestService(RoutineAgentTools);
    tools = new Map(sut.getTools().map((tool) => [tool.name, tool]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should list the routines read-only, and create one only with approval', () => {
    expect(tools.get('list_routines')?.mutating).toBe(false);
    expect(tools.get('create_routine')?.mutating).toBe(true);
    expect(tools.get('create_routine')?.description).toContain('journal_visit');
  });

  it('should create a routine through the service, recorded in the activity log', async () => {
    const create = vi.spyOn(RoutineService.prototype, 'create').mockResolvedValue({
      id: 'routine-1',
      name: 'Name new dishes',
      trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Upload },
      approvalMode: RoutineApprovalMode.Ask,
      limits: { runsPerDay: 4, minutes: 15, toolCalls: 100 },
      nextRunAt: null,
    } as never);
    const input = {
      name: 'Name new dishes',
      instruction: 'Name the dishes of new restaurant visits',
      trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Upload },
    };

    const result = await call('create_routine', input);

    expect(create).toHaveBeenCalledWith(authStub.admin, input, activity);
    expect(JSON.parse(text(result))).toMatchObject({ routineId: 'routine-1', approvalMode: 'ask' });
  });

  it('should report a refused routine as a tool error', async () => {
    vi.spyOn(RoutineService.prototype, 'create').mockRejectedValue(
      new BadRequestException('Invalid schedule: Unknown alias: nightly'),
    );
    const result = await call('create_routine', {
      name: 'x',
      instruction: 'y',
      trigger: { type: RoutineTriggerType.Schedule, cron: 'nightly' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Invalid schedule');
  });

  it('should list the routines with their last run', async () => {
    vi.spyOn(RoutineService.prototype, 'getAll').mockResolvedValue([
      {
        id: 'routine-1',
        name: 'Nightly dishes',
        instruction: 'Name the dishes',
        trigger: { type: RoutineTriggerType.Schedule, cron: '0 2 * * *' },
        approvalMode: RoutineApprovalMode.Ask,
        enabled: true,
        pausedAt: null,
        lastRun: { status: 'succeeded', createdAt: new Date('2026-10-03T02:00:00Z') },
        pendingApprovals: 2,
      },
    ] as never);

    const result = JSON.parse(text(await call('list_routines')));

    expect(result.routines[0]).toMatchObject({
      id: 'routine-1',
      lastRun: { status: 'succeeded' },
      pendingApprovals: 2,
    });
  });
});

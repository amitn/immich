import {
  RoutineApprovalMode,
  RoutineEvent,
  RoutineTriggerType,
  type RoutineConfigResponseDto,
  type RoutineResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import RoutineEditModal from './RoutineEditModal.svelte';

const limits = { runsPerDay: 4, minutes: 15, toolCalls: 100 };

const config: RoutineConfigResponseDto = {
  enabled: true,
  profiles: ['claude', 'codex'],
  defaultProfile: 'claude',
  maxRoutines: 20,
  defaultLimits: limits,
  maxLimits: { runsPerDay: 24, minutes: 30, toolCalls: 200 },
  safeTools: ['create_album'],
  approvalExpiryDays: 7,
};

const routine = (overrides: Partial<RoutineResponseDto> = {}): RoutineResponseDto => ({
  id: 'routine-1',
  name: 'Sunday bursts',
  instruction: 'Clean up the bursts of the week',
  trigger: { type: RoutineTriggerType.Schedule, cron: '0 9 * * 0' },
  scope: { sinceLastRun: true },
  approvalMode: RoutineApprovalMode.Ask,
  limits,
  profile: null,
  enabled: true,
  pausedAt: null,
  consecutiveFailures: 0,
  lastRunAt: null,
  nextRunAt: null,
  pendingEvents: 0,
  pendingApprovals: 0,
  lastRun: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('RoutineEditModal component (#15)', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getAllAlbums.mockResolvedValue([]);
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should make a nightly routine in Ask me by default, from a chat turn', async () => {
    const saved = routine({ id: 'new' });
    sdkMock.createRoutine.mockResolvedValue(saved);
    render(RoutineEditModal, {
      props: { config, initial: { name: 'Name dishes', instruction: 'Name the dishes of new visits' }, onClose },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(saved));
    expect(sdkMock.createRoutine).toHaveBeenCalledWith({
      routineCreateDto: expect.objectContaining({
        name: 'Name dishes',
        instruction: 'Name the dishes of new visits',
        trigger: expect.objectContaining({ type: RoutineTriggerType.Schedule, cron: '0 2 * * *' }),
        approvalMode: RoutineApprovalMode.Ask,
        scope: { sinceLastRun: true },
        limits,
        profile: null,
        enabled: true,
      }),
    });
  });

  it('should offer the three approval modes, with a dry run that changes nothing', async () => {
    sdkMock.createRoutine.mockResolvedValue(routine());
    render(RoutineEditModal, { props: { config, initial: { name: 'x', instruction: 'y' }, onClose } });

    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      RoutineApprovalMode.Ask,
      RoutineApprovalMode.AutoSafe,
      RoutineApprovalMode.DryRun,
    ]);
    await fireEvent.click(radios[2]);
    await fireEvent.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() =>
      expect(sdkMock.createRoutine).toHaveBeenCalledWith({
        routineCreateDto: expect.objectContaining({ approvalMode: RoutineApprovalMode.DryRun }),
      }),
    );
  });

  it('should not save a routine without a name or an instruction', () => {
    render(RoutineEditModal, { props: { config, onClose } });
    expect(screen.getByRole('button', { name: 'create' })).toBeDisabled();
  });

  it('should keep the schedule and the event of a routine it edits', async () => {
    const weekly = routine();
    sdkMock.updateRoutine.mockResolvedValue(weekly);
    render(RoutineEditModal, { props: { config, routine: weekly, onClose } });

    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(weekly));
    expect(sdkMock.updateRoutine).toHaveBeenCalledWith({
      id: 'routine-1',
      routineUpdateDto: expect.objectContaining({
        trigger: expect.objectContaining({ type: RoutineTriggerType.Schedule, cron: '0 9 * * 0' }),
      }),
    });

    vi.mocked(sdkMock.updateRoutine).mockClear();
    const tagged = routine({
      trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'print' },
    });
    sdkMock.updateRoutine.mockResolvedValue(tagged);
    render(RoutineEditModal, { props: { config, routine: tagged, onClose } });
    await fireEvent.click(screen.getAllByRole('button', { name: 'save' }).at(-1)!);

    await waitFor(() =>
      expect(sdkMock.updateRoutine).toHaveBeenCalledWith({
        id: 'routine-1',
        routineUpdateDto: expect.objectContaining({
          trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'print' },
        }),
      }),
    );
  });
});

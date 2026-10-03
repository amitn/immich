import { RoutineApprovalStatus, type RoutineApprovalResponseDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import RoutineChangeList from './RoutineChangeList.svelte';

const change = (overrides: Partial<RoutineApprovalResponseDto> = {}): RoutineApprovalResponseDto => ({
  id: 'change-1',
  runId: 'run-1',
  routineId: 'routine-1',
  routineName: 'Name dishes',
  toolName: 'create_album',
  title: 'Create album',
  summary: 'Name: Italy · 2 photos',
  input: { name: 'Italy' },
  assetIds: [],
  status: RoutineApprovalStatus.Pending,
  result: null,
  activityIds: [],
  expiresAt: '2026-10-10T00:00:00.000Z',
  decidedAt: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  ...overrides,
});

describe('RoutineChangeList component (#15)', () => {
  const onDecide = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should approve or deny one change', async () => {
    render(RoutineChangeList, { props: { changes: [change()], onDecide } });

    expect(screen.getByText('Create album')).toBeInTheDocument();
    expect(screen.getByText('Name: Italy · 2 photos')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'routine_approve' }));
    expect(onDecide).toHaveBeenCalledWith(['change-1'], true);
    await fireEvent.click(screen.getByRole('button', { name: 'routine_deny' }));
    expect(onDecide).toHaveBeenCalledWith(['change-1'], false);
    // a single change has no "all" buttons
    expect(screen.queryByRole('button', { name: 'routine_approve_all' })).toBeNull();
  });

  it('should decide the pending changes of a run together, and link the run in the inbox', async () => {
    render(RoutineChangeList, {
      props: {
        changes: [
          change({ id: 'a' }),
          change({ id: 'b' }),
          change({ id: 'c', status: RoutineApprovalStatus.Applied, result: '{"albumId":"x"}' }),
          change({ id: 'd', runId: 'run-2', routineName: 'Bursts' }),
        ],
        showRun: true,
        onDecide,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'routine_approve_all' }));
    expect(onDecide).toHaveBeenCalledWith(['a', 'b'], true);
    expect(screen.getByRole('link', { name: 'Name dishes' })).toHaveAttribute('href', '/routines/runs/run-1');
    expect(screen.getByRole('link', { name: 'Bursts' })).toHaveAttribute('href', '/routines/runs/run-2');
    expect(screen.getByText('routine_change_status_applied')).toBeInTheDocument();
  });

  it('should disable the buttons of the changes being decided', () => {
    render(RoutineChangeList, { props: { changes: [change()], busy: new Set(['change-1']), onDecide } });
    expect(screen.getByRole('button', { name: 'routine_deny' })).toBeDisabled();
  });
});

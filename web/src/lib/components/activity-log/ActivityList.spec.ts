import { ActivityLogSource, ActivityUndoStatus } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { ActivityLogState } from '$lib/managers/activity-log.svelte';
import { activityLogFactory } from '@test-data/factories/activity-log-factory';
import ActivityList from './ActivityList.svelte';

describe('ActivityList component', () => {
  const groupId = 'turn-1';

  const newState = async (items: ReturnType<typeof activityLogFactory.build>[]) => {
    sdkMock.getActivityLog.mockResolvedValue(items);
    const activity = new ActivityLogState(() => ({ sessionId: 'chat-1' }));
    await activity.load();
    return activity;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    vi.spyOn(toastManager, 'warning').mockImplementation(() => {});
    vi.spyOn(toastManager, 'info').mockImplementation(() => {});
  });

  it('should say when nothing was changed', async () => {
    render(ActivityList, { props: { activity: await newState([]), emptyText: 'Nothing here' } });

    expect(screen.getByTestId('activity-empty')).toHaveTextContent('Nothing here');
  });

  it('should list the changes with who made them', async () => {
    const assistant = activityLogFactory.build({ summary: 'Created the album “Sicily” with 3 photos' });
    const web = activityLogFactory.build({
      source: ActivityLogSource.Web,
      toolName: null,
      sessionId: null,
      summary: 'Named 4 photos of “Nino” (Food)',
    });
    render(ActivityList, { props: { activity: await newState([assistant, web]) } });

    const [first, second] = screen.getAllByTestId('activity-item');
    expect(first).toHaveTextContent('Created the album “Sicily” with 3 photos');
    expect(first).toHaveTextContent('activity_log_by_assistant_tool');
    expect(second).toHaveTextContent('Named 4 photos of “Nino” (Food)');
    expect(second).toHaveTextContent('activity_log_source_web');
    expect(sdkMock.getActivityLog).toHaveBeenCalledWith({ sessionId: 'chat-1', limit: 100 });
  });

  it('should undo a change and show it as undone', async () => {
    const change = activityLogFactory.build({ id: 'a', groupId });
    const activity = await newState([change]);
    sdkMock.undoActivities.mockResolvedValue({
      undone: 1,
      refused: 0,
      results: [{ id: 'a', summary: change.summary, status: ActivityUndoStatus.Undone, warnings: [] }],
    });
    sdkMock.getActivityLog.mockResolvedValue([
      { ...change, canUndo: false, undoneAt: '2026-09-27T11:00:00.000Z', undoneBy: ActivityLogSource.Web },
    ]);
    render(ActivityList, { props: { activity } });

    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_undo' }));

    expect(sdkMock.undoActivities).toHaveBeenCalledWith({ activityUndoDto: { ids: ['a'] } });
    await waitFor(() => expect(screen.getByTestId('activity-undone')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'activity_log_undo' })).not.toBeInTheDocument();
    expect(toastManager.success).toHaveBeenCalledWith({ title: 'activity_log_undone_one' }, { timeout: 3000 });
  });

  it('should show why a change was refused', async () => {
    const change = activityLogFactory.build({ id: 'a', groupId });
    const activity = await newState([change]);
    const message = 'The photo is placed in “Sicily” (page 3): remove it from the book first, or undo that change.';
    sdkMock.undoActivities.mockResolvedValue({
      undone: 0,
      refused: 1,
      results: [{ id: 'a', summary: change.summary, status: ActivityUndoStatus.Refused, message, warnings: [] }],
    });
    render(ActivityList, { props: { activity } });

    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_undo' }));

    await waitFor(() => expect(screen.getByTestId('activity-message')).toHaveTextContent(message));
    expect(screen.getByRole('button', { name: 'activity_log_undo' })).toBeInTheDocument();
    expect(toastManager.warning).toHaveBeenCalledWith({ title: 'activity_log_undo_refused', description: message });
  });

  it('should redo an undone change that is simple to repeat', async () => {
    const change = activityLogFactory.build({
      id: 'a',
      canUndo: false,
      canRedo: true,
      undoneAt: '2026-09-27T11:00:00.000Z',
    });
    const activity = await newState([change]);
    sdkMock.redoActivity.mockResolvedValue({ ...change, canUndo: true, canRedo: false, undoneAt: null });
    render(ActivityList, { props: { activity } });

    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_redo' }));

    expect(sdkMock.redoActivity).toHaveBeenCalledWith({ id: 'a' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'activity_log_undo' })).toBeInTheDocument());
  });

  it('should undo all the changes of a group', async () => {
    const changes = [
      activityLogFactory.build({ id: 'b', groupId, summary: 'Placed a photo on page 2 of “Sicily”' }),
      activityLogFactory.build({ id: 'a', groupId, summary: 'Cropped a photo' }),
    ];
    const activity = await newState(changes);
    sdkMock.undoActivities.mockResolvedValue({
      undone: 2,
      refused: 0,
      results: changes.map(({ id, summary }) => ({ id, summary, status: ActivityUndoStatus.Undone, warnings: [] })),
    });
    render(ActivityList, { props: { activity } });

    const [group] = screen.getAllByTestId('activity-group');
    expect(group).toHaveTextContent('activity_log_group_changes');
    await fireEvent.click(within(group).getByRole('button', { name: 'activity_log_undo_all' }));

    expect(sdkMock.undoActivities).toHaveBeenCalledWith({ activityUndoDto: { groupId } });
    await waitFor(() =>
      expect(toastManager.success).toHaveBeenCalledWith({ title: 'activity_log_undone_count' }, { timeout: 3000 }),
    );
  });
});

import { ActivityUndoStatus } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component, ComponentProps } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { activityLogFactory } from '@test-data/factories/activity-log-factory';
import ActivityPage from './+page.svelte';

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  return await import('@test-data/mocks/UserPageLayout.mock.svelte');
});
vi.mock('$app/navigation', () => ({ replaceState: vi.fn() }));

type Props = ComponentProps<typeof ActivityPage>;
type Data = Props['data'];
/** TestWrapper provides the tooltips of the inputs */
type WrapperProps = { component: Component<Props>; componentProps: Props };

describe('activity page', () => {
  const renderPage = (data: Partial<Data> = {}) =>
    render(TestWrapper as Component<WrapperProps>, {
      props: {
        component: ActivityPage,
        componentProps: { data: { meta: { title: 'Activity log' }, ...data } as Data },
      },
    });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    vi.spyOn(toastManager, 'warning').mockImplementation(() => {});
  });

  it('should list every change, newest first', async () => {
    sdkMock.getActivityLog.mockResolvedValue([
      activityLogFactory.build({ summary: 'Created the book “Sicily”' }),
      activityLogFactory.build({ summary: 'Added 3 photos to “Sicily”' }),
    ]);

    renderPage();

    await waitFor(() => expect(screen.getAllByTestId('activity-item')).toHaveLength(2));
    expect(sdkMock.getActivityLog).toHaveBeenCalledWith({ limit: 100 });
    expect(screen.getByTestId('activity-filters')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-scope')).not.toBeInTheDocument();
  });

  it('should show the changes of one turn, undo them all, and then show every change', async () => {
    const groupId = 'turn-1';
    const changes = [
      activityLogFactory.build({ groupId, summary: 'Placed a photo on page 2 of “Sicily”' }),
      activityLogFactory.build({ groupId, summary: 'Cropped a photo' }),
    ];
    sdkMock.getActivityLog.mockResolvedValue(changes);
    sdkMock.undoActivities.mockResolvedValue({
      undone: 1,
      refused: 1,
      results: [
        { id: changes[0].id, summary: changes[0].summary, status: ActivityUndoStatus.Undone, warnings: [] },
        {
          id: changes[1].id,
          summary: changes[1].summary,
          status: ActivityUndoStatus.Refused,
          message: 'The photo is placed in “Rome” (page 1)',
          warnings: [],
        },
      ],
    });

    renderPage({ groupId });

    await waitFor(() => expect(screen.getAllByTestId('activity-item')).toHaveLength(2));
    expect(sdkMock.getActivityLog).toHaveBeenCalledWith({ groupId, limit: 100 });
    expect(screen.getByTestId('activity-scope')).toHaveTextContent('activity_log_one_turn');

    const [undoAll] = screen.getAllByRole('button', { name: 'activity_log_undo_all' });
    await fireEvent.click(undoAll);
    expect(sdkMock.undoActivities).toHaveBeenCalledWith({ activityUndoDto: { groupId } });
    await waitFor(() =>
      expect(toastManager.warning).toHaveBeenCalledWith(
        { title: 'activity_log_undone_one', description: 'The photo is placed in “Rome” (page 1)' },
        { timeout: 8000 },
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('activity-message')).toHaveTextContent('The photo is placed in “Rome” (page 1)'),
    );

    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_show_all' }));
    await waitFor(() => expect(sdkMock.getActivityLog).toHaveBeenLastCalledWith({ limit: 100 }));
    expect(screen.queryByTestId('activity-scope')).not.toBeInTheDocument();
  });
});

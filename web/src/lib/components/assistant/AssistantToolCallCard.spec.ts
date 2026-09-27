import { ActivityLogAction } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Component, ComponentProps } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { activityLogFactory } from '@test-data/factories/activity-log-factory';
import AssistantToolCallCard from './AssistantToolCallCard.svelte';

type Props = ComponentProps<typeof AssistantToolCallCard>;
/** TestWrapper provides the tooltips of the buttons */
type WrapperProps = { component: Component<Props>; componentProps: Props };

describe('AssistantToolCallCard component', () => {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const content = { toolName: 'add_to_album', title: 'Add to album', status: 'completed', activityIds: ['a'] };

  const renderCard = (props: Partial<Props> = {}) =>
    render(TestWrapper as Component<WrapperProps>, {
      props: { component: AssistantToolCallCard, componentProps: { content, onUndo, onRedo, ...props } },
    });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should undo the changes of a completed call', async () => {
    const change = activityLogFactory.build({ id: 'a' });
    renderCard({ changes: [change] });

    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_undo' }));

    expect(onUndo).toHaveBeenCalledWith(['a']);
  });

  it('should undo every change of a call at once', async () => {
    const changes = [activityLogFactory.build({ id: 'a' }), activityLogFactory.build({ id: 'b' })];
    renderCard({ content: { ...content, activityIds: ['a', 'b'] }, changes });

    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_undo_count' }));

    expect(onUndo).toHaveBeenCalledWith(['a', 'b']);
  });

  it('should not offer undo while the call runs, or without changes', () => {
    const { unmount } = renderCard({
      content: { ...content, status: 'in_progress' },
      changes: [activityLogFactory.build({ id: 'a' })],
    });
    expect(screen.queryByRole('button', { name: 'activity_log_undo' })).not.toBeInTheDocument();
    unmount();

    renderCard({ changes: [] });
    expect(screen.queryByRole('button', { name: 'activity_log_undo' })).not.toBeInTheDocument();
  });

  it('should show undone changes, with redo when it is simple', async () => {
    const change = activityLogFactory.build({
      id: 'a',
      canUndo: false,
      canRedo: true,
      undoneAt: '2026-09-27T11:00:00.000Z',
    });
    renderCard({ changes: [change] });

    expect(screen.getByTestId('tool-call-undone')).toHaveTextContent('activity_log_undone');
    expect(screen.queryByRole('button', { name: 'activity_log_undo' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_redo' }));
    expect(onRedo).toHaveBeenCalledWith('a');
  });

  it('should not offer redo for changes that are not simple to repeat', () => {
    const change = activityLogFactory.build({
      id: 'a',
      action: ActivityLogAction.AssetCopy,
      canUndo: false,
      canRedo: false,
      undoneAt: '2026-09-27T11:00:00.000Z',
    });
    renderCard({ changes: [change] });

    expect(screen.getByTestId('tool-call-undone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'activity_log_redo' })).not.toBeInTheDocument();
  });

  it('should say why the undo was refused', () => {
    const change = activityLogFactory.build({ id: 'a' });
    renderCard({ changes: [change], undoMessage: 'The photo is placed in “Sicily” (page 3)' });

    expect(screen.getByTestId('tool-call-undo-message')).toHaveTextContent('The photo is placed in “Sicily” (page 3)');
    expect(screen.getByRole('button', { name: 'activity_log_undo' })).toBeInTheDocument();
  });
});

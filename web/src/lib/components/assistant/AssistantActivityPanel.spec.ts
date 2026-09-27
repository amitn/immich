import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component, ComponentProps } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { ActivityLogState } from '$lib/managers/activity-log.svelte';
import { activityLogFactory } from '@test-data/factories/activity-log-factory';
import AssistantActivityPanel from './AssistantActivityPanel.svelte';
import AssistantTurnUndo from './AssistantTurnUndo.svelte';

type Props = ComponentProps<typeof AssistantActivityPanel>;
/** TestWrapper provides the tooltips of the buttons */
type WrapperProps = { component: Component<Props>; componentProps: Props };

describe('AssistantActivityPanel component', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
  });

  const renderPanel = (props: Partial<Props>) =>
    render(TestWrapper as Component<WrapperProps>, {
      props: {
        component: AssistantActivityPanel,
        componentProps: { chat: new ActivityLogState(), hasChat: true, onClose, ...props },
      },
    });

  it('should list the changes of the chat, then all of them', async () => {
    sdkMock.getActivityLog.mockResolvedValueOnce([activityLogFactory.build({ summary: 'Added 3 photos to “Sicily”' })]);
    const chat = new ActivityLogState(() => ({ sessionId: 'chat-1' }));
    await chat.load();
    renderPanel({ chat });

    expect(screen.getByRole('tab', { name: 'activity_log_this_chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('activity-item')).toHaveTextContent('Added 3 photos to “Sicily”');

    sdkMock.getActivityLog.mockResolvedValueOnce([
      activityLogFactory.build({ summary: 'Kept the suggested book “2025 in food”' }),
      activityLogFactory.build({ summary: 'Added 3 photos to “Sicily”' }),
    ]);
    await fireEvent.click(screen.getByRole('tab', { name: 'activity_log_all' }));

    expect(sdkMock.getActivityLog).toHaveBeenLastCalledWith({ limit: 100 });
    await waitFor(() => expect(screen.getAllByTestId('activity-item')).toHaveLength(2));
  });

  it('should say when a new chat has no changes', () => {
    renderPanel({ hasChat: false });

    expect(screen.getByText('activity_log_empty_chat')).toBeInTheDocument();
  });

  it('should close', async () => {
    renderPanel({});

    await fireEvent.click(screen.getByRole('button', { name: 'close' }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('AssistantTurnUndo component', () => {
  const onUndo = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should undo the turn', async () => {
    render(AssistantTurnUndo, {
      props: { changes: [activityLogFactory.build(), activityLogFactory.build({ canUndo: false })], onUndo },
    });

    expect(screen.getByTestId('assistant-turn-undo')).toHaveTextContent('activity_log_turn_changes');
    await fireEvent.click(screen.getByRole('button', { name: 'activity_log_undo_turn' }));

    expect(onUndo).toHaveBeenCalled();
  });

  it('should hide once nothing is left to undo', () => {
    render(AssistantTurnUndo, {
      props: { changes: [activityLogFactory.build({ canUndo: false, undoneAt: '2026-09-27T11:00:00.000Z' })], onUndo },
    });

    expect(screen.queryByTestId('assistant-turn-undo')).not.toBeInTheDocument();
  });
});

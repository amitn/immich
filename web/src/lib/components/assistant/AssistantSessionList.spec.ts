import { AgentSessionStatus, type AgentSessionResponseDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Component, ComponentProps } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import AssistantSessionList from './AssistantSessionList.svelte';

type Props = ComponentProps<typeof AssistantSessionList>;
/** TestWrapper provides the tooltips of the buttons */
type WrapperProps = { component: Component<Props>; componentProps: Props };

const session = (id: string, title: string): AgentSessionResponseDto => ({
  id,
  title,
  profile: 'claude',
  status: AgentSessionStatus.Idle,
  autoApprove: false,
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
});

describe('AssistantSessionList component', () => {
  const onSelect = vi.fn();
  const onNew = vi.fn();
  const onDelete = vi.fn();
  const onDeleteAll = vi.fn();
  const sessions = [session('a', 'Best of Sicily'), session('b', 'Tasting notes')];

  const renderList = (props: Partial<Props> = {}) =>
    render(TestWrapper as Component<WrapperProps>, {
      props: {
        component: AssistantSessionList,
        componentProps: { sessions, activeId: 'a', onSelect, onNew, onDelete, onDeleteAll, ...props },
      },
    });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should delete a chat', async () => {
    renderList();

    await fireEvent.click(screen.getAllByRole('button', { name: /assistant_delete_chat_named/ })[0]);

    expect(onDelete).toHaveBeenCalledWith(sessions[0]);
  });

  it('should always show the delete button of the open chat', () => {
    renderList();

    const [open, other] = screen.getAllByRole('button', { name: /assistant_delete_chat_named/ });
    // the other chats show theirs on hover, where hovering is possible
    expect(open.className).not.toContain('opacity-0');
    expect(other.className).toContain('[@media(hover:hover)]:opacity-0');
  });

  it('should show the delete button of the other chats on hover and on keyboard focus', () => {
    renderList();

    const [, other] = screen.getAllByRole('button', { name: /assistant_delete_chat_named/ });
    expect(other.className).toContain('[@media(hover:hover)]:group-hover:opacity-100');
    // focusing the chat, or tabbing to the button itself
    expect(other.className).toContain('[@media(hover:hover)]:group-focus-within:opacity-100');
    expect(other.className).toContain('[@media(hover:hover)]:focus-visible:opacity-100');
  });

  it('should style the open chat apart from a hovered one', () => {
    renderList();

    const [open, other] = screen.getAllByRole('listitem');
    expect(open).toHaveAttribute('data-active', 'true');
    expect(open.className).toContain('border-primary');
    expect(open.className).not.toContain('hover:bg');
    expect(other).not.toHaveAttribute('data-active');
    expect(other.className).toContain('border-transparent');
    // hovering does not tint a chat like the open one
    const hover = other.className.split(/\s+/).filter((name) => name.includes('hover:bg'));
    expect(hover.length).toBeGreaterThan(0);
    expect(hover.some((name) => name.includes('primary'))).toBe(false);
  });

  it('should delete all chats', async () => {
    renderList();

    await fireEvent.click(screen.getByRole('button', { name: 'assistant_delete_all_chats' }));

    expect(onDeleteAll).toHaveBeenCalled();
  });

  it('should not offer to delete all chats for a single chat', () => {
    renderList({ sessions: [sessions[0]] });

    expect(screen.queryByRole('button', { name: 'assistant_delete_all_chats' })).not.toBeInTheDocument();
  });
});

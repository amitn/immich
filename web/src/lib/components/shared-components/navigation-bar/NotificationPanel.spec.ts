import { NotificationLevel, NotificationType, type NotificationDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { foodPack } from '$lib/collections/packs/food';
import CollectionNameModal from '$lib/modals/CollectionNameModal.svelte';
import { renderWithTooltips } from '$tests/helpers';
import NotificationPanel from './NotificationPanel.svelte';

const { store, flags } = vi.hoisted(() => ({
  store: { notifications: [] as NotificationDto[], markAsRead: vi.fn(), markAllAsRead: vi.fn() },
  flags: { smartSearch: true },
}));

vi.mock(import('$app/navigation'), () => ({ goto: vi.fn(), afterNavigate: vi.fn() }) as never);
vi.mock(import('$lib/stores/notification-manager.svelte'), () => ({ notificationManager: store as never }));
vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: flags } as never,
}));

const notification = (overrides: Partial<NotificationDto> = {}): NotificationDto => ({
  id: 'notification-1',
  type: NotificationType.Custom,
  level: NotificationLevel.Info,
  title: 'Name the dishes from last night at Taormina?',
  description: '4 dishes · Taormina, 26 September 2026',
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('NotificationPanel component', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    store.markAsRead.mockResolvedValue(undefined);
    flags.smartSearch = true;
  });

  it('should open the naming dialog of a new collection on the photos of its visit', async () => {
    store.notifications = [
      notification({
        data: { collectionPack: 'food', assetIds: ['a', 'b', 'c'], visitKey: '2026-09-26|Dinner|Taormina' },
      }),
    ];
    renderWithTooltips(NotificationPanel, { onClose });

    await fireEvent.click(screen.getByText('Name the dishes from last night at Taormina?'));

    await waitFor(() =>
      expect(modalManager.show).toHaveBeenCalledWith(CollectionNameModal, {
        pack: foodPack,
        assetIds: ['a', 'b', 'c'],
      }),
    );
    expect(store.markAsRead).toHaveBeenCalledWith('notification-1');
    expect(onClose).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
  });

  it('should still open the page of other notifications', async () => {
    store.notifications = [notification({ title: 'A new photo book is ready', data: { bookId: 'book-1' } })];
    renderWithTooltips(NotificationPanel, { onClose });

    await fireEvent.click(screen.getByText('A new photo book is ready'));

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/books/book-1'));
    expect(modalManager.show).not.toHaveBeenCalled();
  });

  it('should not open the dialog of a pack that is not available', async () => {
    flags.smartSearch = false;
    store.notifications = [notification({ data: { collectionPack: 'food', assetIds: ['a'] } })];
    renderWithTooltips(NotificationPanel, { onClose });

    await fireEvent.click(screen.getByText('Name the dishes from last night at Taormina?'));

    await waitFor(() => expect(store.markAsRead).toHaveBeenCalled());
    expect(modalManager.show).not.toHaveBeenCalled();
  });
});

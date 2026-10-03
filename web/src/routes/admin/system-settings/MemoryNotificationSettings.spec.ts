import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips } from '$tests/helpers';
import MemoryNotificationSettings from './MemoryNotificationSettings.svelte';

const memoryNotifications = vi.hoisted(() => ({ enabled: true, digest: true }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: { configFile: false } } as never,
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    get value() {
      return { memoryNotifications: structuredClone(memoryNotifications) };
    },
    get defaultValue() {
      return { memoryNotifications: structuredClone(memoryNotifications) };
    },
    cloneValue: () => ({ memoryNotifications: structuredClone(memoryNotifications) }),
  } as never,
}));

describe('MemoryNotificationSettings component (#6)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getConfig.mockImplementation(() =>
      Promise.resolve({ memoryNotifications: structuredClone(memoryNotifications) } as never),
    );
    sdkMock.updateConfig.mockImplementation(({ adminConfigDto }) => Promise.resolve(adminConfigDto));
  });

  it('shows the notification of the day and the digest, both on by default', () => {
    renderWithTooltips(MemoryNotificationSettings, {});

    expect(screen.getByText('admin.memory_notifications_enabled')).toBeInTheDocument();
    expect(screen.getByText('admin.memory_notifications_digest')).toBeInTheDocument();
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toBeChecked();
    }
  });

  it('turns the weekly digest off for everyone', async () => {
    renderWithTooltips(MemoryNotificationSettings, {});

    await fireEvent.click(screen.getAllByRole('switch')[1]);
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(sdkMock.updateConfig).toHaveBeenCalledWith({
        adminConfigDto: { memoryNotifications: { enabled: true, digest: false } },
      }),
    );
  });
});

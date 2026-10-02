import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips } from '$tests/helpers';
import JournalSettings from './JournalSettings.svelte';

const collections = vi.hoisted(() => ({ notifications: { enabled: true, maxPerRun: 3, windowDays: 14 } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: { configFile: false } } as never,
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    get value() {
      return { collections: structuredClone(collections) };
    },
    get defaultValue() {
      return { collections: structuredClone(collections) };
    },
    cloneValue: () => ({ collections: structuredClone(collections) }),
  } as never,
}));

describe('JournalSettings component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getConfig.mockImplementation(() => Promise.resolve({ collections: structuredClone(collections) } as never));
    sdkMock.updateConfig.mockImplementation(({ adminConfigDto }) => Promise.resolve(adminConfigDto));
  });

  it('should show the notifications, on by default, with their limits', () => {
    renderWithTooltips(JournalSettings, {});

    expect(screen.getByText('admin.journal_notifications_enabled')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: /admin.journal_notifications_max_per_run/ })).toHaveValue(3);
    expect(screen.getByRole('spinbutton', { name: /admin.journal_notifications_window_days/ })).toHaveValue(14);
  });

  it('should turn the notifications off for everyone', async () => {
    renderWithTooltips(JournalSettings, {});

    await fireEvent.click(screen.getByRole('switch'));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(sdkMock.updateConfig).toHaveBeenCalledWith({
        adminConfigDto: { collections: { notifications: { enabled: false, maxPerRun: 3, windowDays: 14 } } },
      }),
    );
  });

  it('should turn on the notifications, which are off by default', async () => {
    collections.notifications.enabled = false;
    try {
      renderWithTooltips(JournalSettings, {});
      expect(screen.getByRole('switch')).not.toBeChecked();
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

      await fireEvent.click(screen.getByRole('switch'));
      expect(screen.getByRole('spinbutton', { name: /admin.journal_notifications_max_per_run/ })).toHaveValue(3);
      await fireEvent.click(screen.getByRole('button', { name: 'save' }));

      await waitFor(() =>
        expect(sdkMock.updateConfig).toHaveBeenCalledWith({
          adminConfigDto: { collections: { notifications: { enabled: true, maxPerRun: 3, windowDays: 14 } } },
        }),
      );
    } finally {
      collections.notifications.enabled = true;
    }
  });

  it('should save the number of notifications per night', async () => {
    renderWithTooltips(JournalSettings, {});

    const perRun = screen.getByRole('spinbutton', { name: /admin.journal_notifications_max_per_run/ });
    await fireEvent.input(perRun, { target: { value: '5' } });
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(sdkMock.updateConfig).toHaveBeenCalledWith({
        adminConfigDto: { collections: { notifications: { enabled: true, maxPerRun: 5, windowDays: 14 } } },
      }),
    );
  });
});

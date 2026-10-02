import { toastManager } from '@immich/ui';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips } from '$tests/helpers';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import FeatureSettings from './FeatureSettings.svelte';

const { auth } = vi.hoisted(() => ({
  auth: { preferences: {} as Record<string, unknown>, setPreferences: vi.fn() },
}));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({ authManager: auth as never }));
vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: { assistant: true } } as never,
}));
vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: { value: { minFaces: 3 } } as never,
}));

describe('FeatureSettings component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    vi.spyOn(toastManager, 'primary').mockImplementation(() => {});
    auth.preferences = preferencesFactory.build() as never;
    sdkMock.updateMyPreferences.mockImplementation(({ userPreferencesUpdateDto }) =>
      Promise.resolve(userPreferencesUpdateDto as never),
    );
  });

  it('should turn off the journal notifications', async () => {
    renderWithTooltips(FeatureSettings, {});

    await fireEvent.click(screen.getByText('journal_notifications_setting'));
    const toggle = await screen.findByRole('switch', { name: 'enable' });
    expect(toggle).toBeChecked();
    await fireEvent.click(toggle);
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(sdkMock.updateMyPreferences).toHaveBeenCalledWith({
        userPreferencesUpdateDto: expect.objectContaining({ collectionNotifications: { enabled: false } }),
      }),
    );
  });

  it('should keep the notifications on for a user who never chose', async () => {
    auth.preferences = { ...preferencesFactory.build(), collectionNotifications: undefined } as never;
    renderWithTooltips(FeatureSettings, {});

    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(sdkMock.updateMyPreferences).toHaveBeenCalledWith({
        // beside the other preferences, such as the answers of the assistant
        userPreferencesUpdateDto: expect.objectContaining({
          collectionNotifications: { enabled: true },
          aiAnswers: { enabled: true },
        }),
      }),
    );
  });
});

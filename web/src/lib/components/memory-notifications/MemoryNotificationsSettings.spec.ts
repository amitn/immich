import { toastManager } from '@immich/ui';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips } from '$tests/helpers';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import MemoryNotificationsSettings from './MemoryNotificationsSettings.svelte';

const { auth, flags } = vi.hoisted(() => ({
  auth: { preferences: {} as Record<string, unknown>, setPreferences: vi.fn() },
  flags: { email: true } as Record<string, boolean>,
}));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({ authManager: auth as never }));
vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    get value() {
      return flags;
    },
    get valueOrUndefined() {
      return flags;
    },
  } as never,
}));

const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

const saved = () => sdkMock.updateMyPreferences.mock.calls.at(-1)?.[0].userPreferencesUpdateDto;

describe('MemoryNotificationsSettings component (#6)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    vi.spyOn(toastManager, 'primary').mockImplementation(() => {});
    flags.email = true;
    auth.preferences = preferencesFactory.build() as never;
    sdkMock.updateMyPreferences.mockImplementation(({ userPreferencesUpdateDto }) =>
      Promise.resolve(userPreferencesUpdateDto as never),
    );
  });

  it('shows every kind on but the digest, by default', () => {
    renderWithTooltips(MemoryNotificationsSettings, {});

    expect(screen.getByRole('switch', { name: 'memory_notifications_memories' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'memory_notifications_drafts' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'journal_notifications_setting' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'memory_notifications_creations' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'memory_notifications_digest' })).not.toBeChecked();
    expect(screen.queryByText('memory_notifications_digest_day')).not.toBeInTheDocument();
  });

  it('saves each kind, the time of day in the time zone of the browser, and the journal visits', async () => {
    renderWithTooltips(MemoryNotificationsSettings, {});

    await fireEvent.click(screen.getByRole('switch', { name: 'memory_notifications_drafts' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'journal_notifications_setting' }));
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(sdkMock.updateMyPreferences).toHaveBeenCalledWith({
        userPreferencesUpdateDto: {
          memoryNotifications: {
            memories: true,
            drafts: false,
            creations: true,
            hour: 9,
            timeZone,
            digest: false,
            digestDay: 7,
          },
          collectionNotifications: { enabled: false },
        },
      }),
    );
    expect(auth.setPreferences).toHaveBeenCalled();
  });

  it('turns the weekly digest on, with its day', async () => {
    renderWithTooltips(MemoryNotificationsSettings, {});

    await fireEvent.click(screen.getByRole('switch', { name: 'memory_notifications_digest' }));
    expect(await screen.findByText('memory_notifications_digest_day')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(saved()?.memoryNotifications).toMatchObject({ digest: true, digestDay: 7 }));
  });

  it('keeps the choices the user made', () => {
    auth.preferences = {
      ...preferencesFactory.build(),
      memoryNotifications: {
        memories: false,
        drafts: true,
        creations: false,
        hour: 18,
        timeZone: 'Europe/London',
        digest: true,
        digestDay: 1,
      },
    } as never;
    renderWithTooltips(MemoryNotificationsSettings, {});

    expect(screen.getByRole('switch', { name: 'memory_notifications_memories' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'memory_notifications_creations' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'memory_notifications_digest' })).toBeChecked();
    expect(screen.getByText('memory_notifications_digest_day')).toBeInTheDocument();
  });

  it('cannot turn the digest on when the server cannot send email', async () => {
    flags.email = false;
    auth.preferences = {
      ...preferencesFactory.build(),
      memoryNotifications: { ...preferencesFactory.build().memoryNotifications, digest: true },
    } as never;
    renderWithTooltips(MemoryNotificationsSettings, {});

    expect(screen.getByText('memory_notifications_digest_unavailable')).toBeInTheDocument();
    expect(screen.queryByText('memory_notifications_digest_day')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(saved()?.memoryNotifications).toMatchObject({ digest: false }));
  });
});

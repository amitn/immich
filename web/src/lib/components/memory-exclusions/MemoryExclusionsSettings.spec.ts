import { MemoryExclusionType } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import AlbumPickerModal from '$lib/modals/AlbumPickerModal.svelte';
import PeoplePickerModal from '$lib/modals/PeoplePickerModal.svelte';
import MemoryExclusionsSettings from './MemoryExclusionsSettings.svelte';

const mocks = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  serverConfig: {} as Record<string, unknown>,
  setPreferences: vi.fn(),
  updateMyPreferences: vi.fn(),
  getMemoryExclusions: vi.fn(),
  createMemoryExclusion: vi.fn(),
  deleteMemoryExclusion: vi.fn(),
}));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({
  authManager: {
    get preferences() {
      return mocks.preferences;
    },
    setPreferences: mocks.setPreferences,
  } as never,
}));

vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: {
    get value() {
      return mocks.serverConfig;
    },
  } as never,
}));

vi.mock(import('@immich/sdk'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    updateMyPreferences: mocks.updateMyPreferences,
    getMemoryExclusions: mocks.getMemoryExclusions,
    createMemoryExclusion: mocks.createMemoryExclusion,
    deleteMemoryExclusion: mocks.deleteMemoryExclusion,
  };
});

const dana = {
  id: 'e-dana',
  type: MemoryExclusionType.Person,
  person: { id: 'p-dana', name: 'Dana', isPet: false },
  createdAt: '2026-01-01T00:00:00.000Z',
};
const work = {
  id: 'e-work',
  type: MemoryExclusionType.Album,
  album: { id: 'a-work', albumName: 'Work' },
  createdAt: '2026-01-01T00:00:00.000Z',
};

// the remove buttons are IconButtons, whose tooltip needs the provider of the root layout
const renderSettings = () =>
  render(
    TestWrapper as Component<{ component: typeof MemoryExclusionsSettings; componentProps: Record<string, never> }>,
    { component: MemoryExclusionsSettings, componentProps: {} },
  );

describe('MemoryExclusionsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preferences = { memories: { types: {} }, memoryExclusions: { documents: false } };
    mocks.serverConfig = { availableMemoryTypes: ['on_this_day', 'year_recap'] };
    mocks.getMemoryExclusions.mockResolvedValue({ exclusions: [dana, work], documents: true });
    mocks.updateMyPreferences.mockImplementation(({ userPreferencesUpdateDto }) =>
      Promise.resolve({ ...mocks.preferences, ...userPreferencesUpdateDto }),
    );
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  it('lists what is left out, by kind', async () => {
    renderSettings();

    expect(await screen.findByText('Dana')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    // the documents switch reflects the server
    await waitFor(() => expect(screen.getByRole('switch', { name: 'memory_exclusions_documents' })).toBeChecked());
  });

  it('lets someone back in', async () => {
    mocks.deleteMemoryExclusion.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSettings();

    // svelte-i18n echoes the key in tests: the first one is Dana's
    const [removeDana] = await screen.findAllByRole('button', { name: 'memory_exclusions_remove' });
    await user.click(removeDana);

    expect(mocks.deleteMemoryExclusion).toHaveBeenCalledWith({ id: 'e-dana' });
    await waitFor(() => expect(screen.queryByText('Dana')).not.toBeInTheDocument());
  });

  it('leaves out the people and pets picked', async () => {
    const rex = { id: 'p-rex', name: 'Rex' };
    vi.mocked(modalManager.show).mockResolvedValue([rex] as never);
    mocks.createMemoryExclusion.mockResolvedValue({
      id: 'e-rex',
      type: MemoryExclusionType.Person,
      person: { id: 'p-rex', name: 'Rex', isPet: true },
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText('Dana');

    await user.click(screen.getByRole('button', { name: 'memory_exclusions_add_people' }));

    expect(modalManager.show).toHaveBeenCalledWith(PeoplePickerModal, { multiple: true, excludedIds: ['p-dana'] });
    expect(mocks.createMemoryExclusion).toHaveBeenCalledWith({
      memoryExclusionCreateDto: { type: MemoryExclusionType.Person, personId: 'p-rex' },
    });
    expect(await screen.findByText('Rex')).toBeInTheDocument();
  });

  it('leaves out an album picked', async () => {
    vi.mocked(modalManager.show).mockResolvedValue([{ id: 'a-tax', albumName: 'Taxes' }] as never);
    mocks.createMemoryExclusion.mockResolvedValue({
      id: 'e-tax',
      type: MemoryExclusionType.Album,
      album: { id: 'a-tax', albumName: 'Taxes' },
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText('Dana');

    await user.click(screen.getByRole('button', { name: 'memory_exclusions_add_album' }));

    expect(modalManager.show).toHaveBeenCalledWith(AlbumPickerModal, {});
    expect(mocks.createMemoryExclusion).toHaveBeenCalledWith({
      memoryExclusionCreateDto: { type: MemoryExclusionType.Album, albumId: 'a-tax' },
    });
  });

  it('switches the documents and the year recap, saving each right away', async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText('Dana');

    await user.click(screen.getByRole('switch', { name: 'memory_exclusions_documents' }));
    expect(mocks.updateMyPreferences).toHaveBeenCalledWith({
      userPreferencesUpdateDto: { memoryExclusions: { documents: false } },
    });

    await user.click(screen.getByRole('switch', { name: 'memory_exclusions_recaps' }));
    expect(mocks.updateMyPreferences).toHaveBeenCalledWith({
      userPreferencesUpdateDto: { memories: { types: { year_recap: false } } },
    });
    expect(mocks.setPreferences).toHaveBeenCalledTimes(2);
  });

  it('hides the year recap switch when the admin turned recaps off', async () => {
    mocks.serverConfig = { availableMemoryTypes: ['on_this_day'] };
    renderSettings();
    await screen.findByText('Dana');

    expect(screen.queryByRole('switch', { name: 'memory_exclusions_recaps' })).toBeNull();
  });
});

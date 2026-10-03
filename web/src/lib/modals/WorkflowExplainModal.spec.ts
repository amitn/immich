import type { WorkflowResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { openAssistant } from '$lib/services/assistant.service';
import WorkflowExplainModal from './WorkflowExplainModal.svelte';

vi.mock(import('$lib/services/assistant.service'), () => ({ openAssistant: vi.fn() }));

vi.mock(import('$lib/managers/plugin-manager.svelte'), () => ({
  pluginManager: { getMethodLabel: (method: string) => method } as never,
}));

const workflow = {
  id: 'workflow-1',
  name: 'Italian food',
  description: null,
  trigger: 'AssetTagged',
  enabled: true,
  logging: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  steps: [
    { method: 'immich-plugin-core#assetLocationFilter', config: { region: { country: 'Italy' } }, enabled: true },
    { method: 'gallery-core#assetTagPathFilter', config: { tag: 'Food' }, enabled: true },
    { method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: ['album-1'] }, enabled: true },
  ],
} as unknown as WorkflowResponseDto;

describe('WorkflowExplainModal (#11)', () => {
  const onClose = vi.fn();

  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getAllAlbums.mockResolvedValue([{ id: 'album-1', albumName: 'Italian food' }] as never);
  });

  it('should explain the workflow in plain words, with the names of its albums', async () => {
    render(WorkflowExplainModal, { props: { workflow, onClose } });

    expect(screen.getByText('When a photo or video gets a tag, e.g. when a journal names it')).toBeInTheDocument();
    expect(screen.getByText('it was taken in Italy')).toBeInTheDocument();
    expect(screen.getByText('it has the tag “Food” or a tag under it')).toBeInTheDocument();
    expect(await screen.findByText('add it to the album “Italian food”')).toBeInTheDocument();
    expect(sdkMock.getAllAlbums).toHaveBeenCalledWith({});
    expect(sdkMock.getAllSpaces).not.toHaveBeenCalled();
  });

  it('should open the assistant to change it', async () => {
    render(WorkflowExplainModal, { props: { workflow, onClose } });

    await fireEvent.click(screen.getByRole('button', { name: 'Change with the assistant' }));

    await waitFor(() => expect(openAssistant).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(vi.mocked(openAssistant).mock.calls[0][0]?.prompt).toMatch(
      /^Let's change my workflow “Italian food” \(workflow id: workflow-1\)/,
    );
  });
});

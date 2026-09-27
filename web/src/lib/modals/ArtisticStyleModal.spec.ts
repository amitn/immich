import { ArtJobStatus, type ArtJobResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import StyleCreatorModal from '$lib/modals/StyleCreatorModal.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import ArtisticStyleModal from './ArtisticStyleModal.svelte';

type ArtJobListener = (job: ArtJobResponseDto) => void;

const { onArtJobUpdate } = vi.hoisted(() => ({ onArtJobUpdate: vi.fn<(callback: ArtJobListener) => void>() }));

const { flags } = vi.hoisted(() => ({ flags: { assistant: true } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: flags } as never,
}));

vi.mock('$lib/stores/websocket', () => ({
  websocketEvents: { on: (_event: string, callback: ArtJobListener) => onArtJobUpdate(callback) },
}));

describe('ArtisticStyleModal component', () => {
  const onClose = vi.fn();
  const asset = assetFactory.build();

  const job = (overrides: Partial<ArtJobResponseDto> = {}): ArtJobResponseDto => ({
    id: 'job-1',
    sourceAssetId: asset.id,
    resultAssetId: null,
    style: 'watercolor',
    caption: null,
    status: ArtJobStatus.Pending,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getArtStyles.mockResolvedValue([
      {
        id: 'watercolor',
        name: 'Watercolor',
        description: 'Soft paint',
        usesCaption: false,
        photoAbove: false,
        owned: false,
      },
    ]);
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should title the modal without the menu ellipsis', async () => {
    render(ArtisticStyleModal, { props: { asset, onClose } });

    expect(await screen.findByText('artistic_style_title')).toBeInTheDocument();
    expect(screen.queryByText('artistic_style')).not.toBeInTheDocument();
  });

  it('should create a job with the selected style', async () => {
    sdkMock.createArtJob.mockResolvedValue(job());

    render(ArtisticStyleModal, { props: { asset, onClose } });
    expect(await screen.findByText('Watercolor')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'art_generate' }));

    expect(sdkMock.createArtJob).toHaveBeenCalledWith({
      artJobCreateDto: { assetId: asset.id, style: 'watercolor', prompt: undefined, caption: undefined },
    });
    expect(await screen.findByText('art_status_pending')).toBeInTheDocument();
  });

  it('should show the error of a failed job from the websocket', async () => {
    sdkMock.createArtJob.mockResolvedValue(job());

    render(ArtisticStyleModal, { props: { asset, onClose } });
    await screen.findByText('Watercolor');
    await fireEvent.click(screen.getByRole('button', { name: 'art_generate' }));
    await screen.findByText('art_status_pending');

    const [callback] = onArtJobUpdate.mock.calls[0];
    callback(job({ status: ArtJobStatus.Failed, error: 'The agent did not return an image' }));

    expect(await screen.findByText('The agent did not return an image')).toBeInTheDocument();
  });

  describe('your styles', () => {
    const blueprint = {
      id: '5f0c3a52-8f4e-4a3b-9d51-7f2b9d3c1e11',
      name: 'Blueprint',
      description: 'White lines on deep blue',
      usesCaption: false,
      photoAbove: false,
      owned: true,
    };

    beforeEach(() => {
      flags.assistant = true;
      sdkMock.getArtStyles.mockResolvedValue([
        {
          id: 'watercolor',
          name: 'Watercolor',
          description: 'Soft paint',
          usesCaption: false,
          photoAbove: false,
          owned: false,
        },
        blueprint,
      ]);
    });

    it('should list them apart and generate with one', async () => {
      sdkMock.createArtJob.mockResolvedValue(job({ style: blueprint.id }));

      render(ArtisticStyleModal, { props: { asset, onClose } });
      expect(await screen.findByText('art_your_styles')).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('radio', { name: /Blueprint/ }));
      await fireEvent.click(screen.getByRole('button', { name: 'art_generate' }));

      expect(sdkMock.createArtJob).toHaveBeenCalledWith({
        artJobCreateDto: { assetId: asset.id, style: blueprint.id, prompt: undefined, caption: undefined },
      });
    });

    it('should delete a style of your own', async () => {
      vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
      vi.spyOn(toastManager, 'success').mockImplementation(() => {});
      sdkMock.deleteArtUserStyle.mockResolvedValue(undefined as never);

      render(ArtisticStyleModal, { props: { asset, onClose } });
      await fireEvent.click(await screen.findByRole('button', { name: 'art_style_delete_named' }));

      await waitFor(() => expect(sdkMock.deleteArtUserStyle).toHaveBeenCalledWith({ id: blueprint.id }));
      await waitFor(() => expect(screen.queryByText('Blueprint')).not.toBeInTheDocument());
      // the built-in styles can't be deleted
      expect(screen.queryAllByRole('button', { name: 'art_style_delete_named' })).toHaveLength(0);
      expect(screen.getByText('Watercolor')).toBeInTheDocument();
    });

    it('should open the style creator for the photo', async () => {
      const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);

      render(ArtisticStyleModal, { props: { asset, onClose } });
      await fireEvent.click(await screen.findByRole('button', { name: 'style_creator_create_with_assistant' }));

      expect(onClose).toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith(StyleCreatorModal, { target: { kind: 'art', assetId: asset.id } });
    });

    it('should not offer the assistant when it is disabled', async () => {
      flags.assistant = false;

      render(ArtisticStyleModal, { props: { asset, onClose } });
      await screen.findByText('Watercolor');

      expect(screen.queryByRole('button', { name: 'style_creator_create_with_assistant' })).not.toBeInTheDocument();
    });
  });
});

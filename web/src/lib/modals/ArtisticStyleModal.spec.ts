import { ArtJobStatus, type ArtJobResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { assetFactory } from '@test-data/factories/asset-factory';
import ArtisticStyleModal from './ArtisticStyleModal.svelte';

type ArtJobListener = (job: ArtJobResponseDto) => void;

const { onArtJobUpdate } = vi.hoisted(() => ({ onArtJobUpdate: vi.fn<(callback: ArtJobListener) => void>() }));

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
      { id: 'watercolor', name: 'Watercolor', description: 'Soft paint', usesCaption: false },
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
});

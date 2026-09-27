import { HighlightJobStatus, HighlightStyle, type HighlightJobResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { highlightManager } from '$lib/managers/highlight-manager.svelte';
import HighlightVideoModal from './HighlightVideoModal.svelte';

const job = (overrides: Partial<HighlightJobResponseDto> = {}): HighlightJobResponseDto => ({
  id: 'job-id',
  title: 'Sicily',
  status: HighlightJobStatus.Pending,
  progress: 0,
  albumId: 'album-id',
  bookId: null,
  durationSeconds: 60,
  resultAssetId: null,
  error: null,
  warnings: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('HighlightVideoModal component', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getHighlightMusic.mockResolvedValue([{ id: 'song-id', name: 'Summer.mp3', durationSeconds: 125 }]);
    vi.spyOn(highlightManager, 'track').mockImplementation(() => {});
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should make a one minute video of the album by default, silent', async () => {
    sdkMock.createHighlight.mockResolvedValue(job());

    render(HighlightVideoModal, { props: { albumId: 'album-id', title: 'Sicily', onClose } });
    await fireEvent.click(screen.getByRole('button', { name: 'highlight_video_create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createHighlight).toHaveBeenCalledWith({
      highlightCreateDto: {
        albumId: 'album-id',
        title: 'Sicily',
        durationSeconds: 60,
        style: HighlightStyle.Auto,
        includeMaps: true,
        captions: true,
        music: undefined,
      },
    });
    expect(highlightManager.track).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-id' }));
  });

  it('should pass the length, the switches and the selection', async () => {
    sdkMock.createHighlight.mockResolvedValue(job());

    render(HighlightVideoModal, { props: { assetIds: ['a', 'b'], onClose } });
    // 30, 60, 90 and 120 seconds
    await fireEvent.click(screen.getAllByLabelText('highlight_video_seconds')[2]);
    await fireEvent.click(screen.getByRole('switch', { name: 'highlight_video_maps' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'highlight_video_captions' }));
    await fireEvent.click(screen.getByRole('button', { name: 'highlight_video_create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createHighlight).toHaveBeenCalledWith({
      highlightCreateDto: expect.objectContaining({
        assetIds: ['a', 'b'],
        title: undefined,
        durationSeconds: 90,
        includeMaps: false,
        captions: false,
      }),
    });
  });

  it('should upload an audio file and pick it as the music', async () => {
    sdkMock.uploadHighlightMusic.mockResolvedValue({ id: 'new-song', name: 'Waves.mp3', durationSeconds: 60 });
    sdkMock.createHighlight.mockResolvedValue(job());

    render(HighlightVideoModal, { props: { bookId: 'book-id', title: 'Our book', onClose } });
    const input = screen.getByLabelText('highlight_video_upload_music', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['ID3'], 'Waves.mp3', { type: 'audio/mpeg' });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(sdkMock.uploadHighlightMusic).toHaveBeenCalledWith({ highlightMusicUploadDto: { file } }),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'highlight_video_create' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createHighlight).toHaveBeenCalledWith({
      highlightCreateDto: expect.objectContaining({ bookId: 'book-id', music: 'new-song' }),
    });
  });

  it('should keep the dialog open when the video can not be made', async () => {
    sdkMock.createHighlight.mockRejectedValue(new Error('no photos'));

    render(HighlightVideoModal, { props: { albumId: 'album-id', onClose } });
    await fireEvent.click(screen.getByRole('button', { name: 'highlight_video_create' }));

    await waitFor(() => expect(sdkMock.createHighlight).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(highlightManager.track).not.toHaveBeenCalled();
  });
});

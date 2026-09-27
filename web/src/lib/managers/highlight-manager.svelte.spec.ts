import { HighlightFormat, HighlightJobStatus, type HighlightJobResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getHighlightViewerRoute, highlightManager } from '$lib/managers/highlight-manager.svelte';

const { location } = vi.hoisted(() => ({ location: { url: new URL('http://localhost/photos') } }));

vi.mock(import('$app/navigation'), () => ({ goto: vi.fn() }) as never);
vi.mock(import('$app/state'), () => ({ page: location }) as never);

const job = (overrides: Partial<HighlightJobResponseDto> = {}): HighlightJobResponseDto => ({
  id: `job-${Math.random()}`,
  title: 'Sicily',
  status: HighlightJobStatus.Running,
  progress: 0.4,
  albumId: null,
  bookId: null,
  durationSeconds: 60,
  format: HighlightFormat.Landscape,
  resultAssetId: null,
  error: null,
  warnings: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('highlightManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    vi.spyOn(toastManager, 'danger').mockImplementation(() => {});
    highlightManager.jobs = [];
    highlightManager.ready = [];
    location.url = new URL('http://localhost/photos');
    // the thumbnail of the video is made
    sdkMock.getAssetInfo.mockResolvedValue({ id: 'video', thumbhash: 'abc' } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show the progress of a video, and open it once it is ready', async () => {
    const started = job({ status: HighlightJobStatus.Pending, progress: 0 });
    highlightManager.track(started);
    expect(highlightManager.jobs).toEqual([started]);

    highlightManager.onUpdate({ ...started, status: HighlightJobStatus.Running, progress: 0.5 });
    expect(highlightManager.jobs[0].progress).toBe(0.5);

    highlightManager.onUpdate({
      ...started,
      status: HighlightJobStatus.Completed,
      progress: 1,
      resultAssetId: 'video',
    });
    await vi.waitFor(() => expect(highlightManager.jobs).toEqual([]));
    expect(sdkMock.getAssetInfo).toHaveBeenCalledWith({ id: 'video' });
    // a card offers to share or download it
    expect(highlightManager.ready).toEqual([expect.objectContaining({ id: started.id, resultAssetId: 'video' })]);
    expect(goto).toHaveBeenCalledWith('/photos/video');
  });

  it('should keep the card of a finished video until it is closed', async () => {
    const running = job();
    highlightManager.track(running);
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Completed, resultAssetId: 'video' });
    await vi.waitFor(() => expect(highlightManager.ready).toHaveLength(1));

    highlightManager.dismiss(running.id);
    expect(highlightManager.ready).toEqual([]);
  });

  it('should announce and open the video only once its thumbnail is made', async () => {
    vi.useFakeTimers();
    sdkMock.getAssetInfo
      .mockResolvedValueOnce({ id: 'video', thumbhash: null } as never)
      .mockResolvedValue({ id: 'video', thumbhash: 'abc' } as never);
    const running = job();
    highlightManager.track(running);

    highlightManager.onUpdate({
      ...running,
      status: HighlightJobStatus.Completed,
      progress: 1,
      resultAssetId: 'video',
    });
    await vi.advanceTimersByTimeAsync(0);

    // the card stays, preparing the video
    expect(highlightManager.jobs).toEqual([expect.objectContaining({ status: HighlightJobStatus.Completed })]);
    expect(highlightManager.ready).toEqual([]);
    expect(goto).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    expect(highlightManager.jobs).toEqual([]);
    expect(highlightManager.ready).toHaveLength(1);
    expect(goto).toHaveBeenCalledWith('/photos/video');
  });

  it('should open a video made from an album over the album the user is on', async () => {
    location.url = new URL('http://localhost/albums/album-1');
    const running = job({ albumId: 'album-1' });
    highlightManager.track(running);

    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Completed, resultAssetId: 'video' });

    await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/albums/album-1/photos/video'));
  });

  it('should not take the user away from another page, and offer to open the video', async () => {
    location.url = new URL('http://localhost/books/book-1');
    const running = job({ albumId: 'album-1' });
    highlightManager.track(running);

    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Completed, resultAssetId: 'video' });

    await vi.waitFor(() => expect(highlightManager.ready).toHaveLength(1));
    expect(goto).not.toHaveBeenCalled();
    await highlightManager.open(highlightManager.ready[0]);
    expect(goto).toHaveBeenCalledWith('/albums/album-1/photos/video');
  });

  it('should not open a video started elsewhere, e.g. by the assistant', async () => {
    const running = job();
    highlightManager.onUpdate(running);
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Completed, resultAssetId: 'video' });
    await vi.waitFor(() => expect(highlightManager.ready).toHaveLength(1));
    expect(goto).not.toHaveBeenCalled();
  });

  it('should tell when a video failed', async () => {
    const running = job();
    highlightManager.track(running);
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Failed, error: 'No photos' });
    await vi.waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    expect(toastManager.danger).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'highlight_video_failed', description: 'No photos' }),
      expect.anything(),
    );
  });

  it('should cancel a video and stop showing it', async () => {
    const running = job();
    highlightManager.track(running);
    sdkMock.cancelHighlight.mockResolvedValue({ ...running, status: HighlightJobStatus.Cancelled });

    await highlightManager.cancel(running.id);

    expect(sdkMock.cancelHighlight).toHaveBeenCalledWith({ id: running.id });
    expect(highlightManager.jobs).toEqual([]);
    expect(highlightManager.ready).toEqual([]);
    expect(toastManager.danger).not.toHaveBeenCalled();
  });

  it('should ignore late updates of a finished video', () => {
    const running = job();
    highlightManager.track(running);
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Cancelled });
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Running });
    expect(highlightManager.jobs).toEqual([]);
  });

  describe('getHighlightViewerRoute', () => {
    it('should open the video in its album, or in the timeline, over the page the user is on', () => {
      const fromAlbum = { albumId: 'album-1' };
      expect(getHighlightViewerRoute(fromAlbum, 'video', '/albums/album-1')).toBe('/albums/album-1/photos/video');
      expect(getHighlightViewerRoute(fromAlbum, 'video', '/albums/album-1/photos/other')).toBe(
        '/albums/album-1/photos/video',
      );
      expect(getHighlightViewerRoute(fromAlbum, 'video', '/albums/album-2')).toBeUndefined();
      expect(getHighlightViewerRoute({ albumId: null }, 'video', '/photos')).toBe('/photos/video');
      expect(getHighlightViewerRoute({ albumId: null }, 'video', '/books/book-1')).toBeUndefined();
    });
  });
});

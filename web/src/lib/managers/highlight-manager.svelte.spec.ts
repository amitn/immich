import { HighlightJobStatus, type HighlightJobResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { highlightManager } from '$lib/managers/highlight-manager.svelte';

vi.mock(import('$app/navigation'), () => ({ goto: vi.fn() }) as never);

const job = (overrides: Partial<HighlightJobResponseDto> = {}): HighlightJobResponseDto => ({
  id: `job-${Math.random()}`,
  title: 'Sicily',
  status: HighlightJobStatus.Running,
  progress: 0.4,
  albumId: null,
  bookId: null,
  durationSeconds: 60,
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
  });

  it('should show the progress of a video, and open it once it is ready', () => {
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
    expect(highlightManager.jobs).toEqual([]);
    expect(toastManager.success).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'highlight_video_ready', description: 'Sicily' }),
      expect.anything(),
    );
    expect(goto).toHaveBeenCalledWith(expect.stringContaining('video'));
  });

  it('should not open a video started elsewhere, e.g. by the assistant', () => {
    const running = job();
    highlightManager.onUpdate(running);
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Completed, resultAssetId: 'video' });
    expect(toastManager.success).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
  });

  it('should tell when a video failed', () => {
    const running = job();
    highlightManager.track(running);
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Failed, error: 'No photos' });
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
    expect(toastManager.success).not.toHaveBeenCalled();
    expect(toastManager.danger).not.toHaveBeenCalled();
  });

  it('should ignore late updates of a finished video', () => {
    const running = job();
    highlightManager.track(running);
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Cancelled });
    highlightManager.onUpdate({ ...running, status: HighlightJobStatus.Running });
    expect(highlightManager.jobs).toEqual([]);
  });
});

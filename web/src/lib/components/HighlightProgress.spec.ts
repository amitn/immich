import { HighlightFormat, HighlightJobStatus, type HighlightJobResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { highlightManager } from '$lib/managers/highlight-manager.svelte';
import * as highlightUtils from '$lib/utils/highlight';
import { renderWithTooltips } from '$tests/helpers';
import HighlightProgress from './HighlightProgress.svelte';

const job = (overrides: Partial<HighlightJobResponseDto> = {}): HighlightJobResponseDto => ({
  id: 'job-1',
  title: 'Museum visits',
  status: HighlightJobStatus.Running,
  progress: 0.54,
  albumId: null,
  bookId: null,
  memoryId: null,
  durationSeconds: 30,
  format: HighlightFormat.Landscape,
  resultAssetId: null,
  error: null,
  warnings: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('HighlightProgress component', () => {
  afterEach(() => {
    highlightManager.jobs = [];
    highlightManager.ready = [];
    vi.restoreAllMocks();
  });

  it('should show the progress of a video, which can be cancelled', () => {
    highlightManager.jobs = [job()];
    render(HighlightProgress);

    expect(screen.getByText('Museum visits')).toBeInTheDocument();
    expect(screen.getByText('highlight_video_progress')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cancel' })).toBeInTheDocument();
  });

  it('should say a rendered video is being prepared until its thumbnail is made', () => {
    highlightManager.jobs = [job({ status: HighlightJobStatus.Completed, progress: 1, resultAssetId: 'video' })];
    render(HighlightProgress);

    expect(screen.getByText('highlight_video_preparing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'cancel' })).not.toBeInTheDocument();
  });

  describe('a finished video', () => {
    const vertical = job({
      title: 'Sicily',
      status: HighlightJobStatus.Completed,
      progress: 1,
      resultAssetId: 'video',
      format: HighlightFormat.Vertical,
    });

    it('should offer to share, download and open it', async () => {
      const share = vi.spyOn(highlightUtils, 'shareHighlightVideo').mockResolvedValue('shared');
      const download = vi.spyOn(highlightUtils, 'downloadHighlightVideo').mockImplementation(() => {});
      const open = vi.spyOn(highlightManager, 'open').mockResolvedValue();
      highlightManager.ready = [vertical];
      renderWithTooltips(HighlightProgress, {});

      expect(screen.getByText('highlight_video_ready')).toBeInTheDocument();
      expect(screen.getByText('Sicily')).toBeInTheDocument();

      await fireEvent.click(screen.getByRole('button', { name: 'share' }));
      await waitFor(() => expect(share).toHaveBeenCalledWith('video', 'Sicily-vertical.mp4', 'Sicily'));

      await fireEvent.click(screen.getByRole('button', { name: 'download' }));
      expect(download).toHaveBeenCalledWith('video', 'Sicily-vertical.mp4');

      await fireEvent.click(screen.getByRole('button', { name: 'open' }));
      expect(open).toHaveBeenCalledWith(vertical);
    });

    it('should close its card', async () => {
      highlightManager.ready = [vertical];
      renderWithTooltips(HighlightProgress, {});

      await fireEvent.click(screen.getByRole('button', { name: 'close' }));
      expect(highlightManager.ready).toEqual([]);
      await waitFor(() => expect(screen.queryByText('highlight_video_ready')).not.toBeInTheDocument());
    });
  });
});

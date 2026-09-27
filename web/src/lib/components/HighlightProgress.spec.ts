import { HighlightJobStatus, type HighlightJobResponseDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { highlightManager } from '$lib/managers/highlight-manager.svelte';
import HighlightProgress from './HighlightProgress.svelte';

const job = (overrides: Partial<HighlightJobResponseDto> = {}): HighlightJobResponseDto => ({
  id: 'job-1',
  title: 'Museum visits',
  status: HighlightJobStatus.Running,
  progress: 0.54,
  albumId: null,
  bookId: null,
  durationSeconds: 30,
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
});

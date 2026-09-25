import { ArtJobStatus, type ArtJobResponseDto } from '@immich/sdk';
import { toastManager, type ToastButton } from '@immich/ui';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { artJobManager } from '$lib/managers/art-job-manager.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('@immich/ui', () => ({ toastManager: { success: vi.fn(), danger: vi.fn() } }));

const job = (overrides: Partial<ArtJobResponseDto> = {}): ArtJobResponseDto => ({
  id: 'job-1',
  sourceAssetId: 'source-1',
  resultAssetId: null,
  style: 'watercolor',
  caption: null,
  status: ArtJobStatus.Running,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('artJobManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getArtStyles.mockResolvedValue([
      { id: 'watercolor', name: 'Watercolor', description: 'Soft paint', usesCaption: false },
    ]);
  });

  it('should toast finished artwork with a link to the new photo', async () => {
    await artJobManager.onUpdate(job({ status: ArtJobStatus.Completed, resultAssetId: 'art-1' }));

    expect(toastManager.success).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'art_ready', description: 'art_done_description' }),
      expect.anything(),
    );

    const close = vi.fn();
    const { button } = vi.mocked(toastManager.success).mock.calls[0][0] as {
      button: (close: () => void) => ToastButton;
    };
    const { label, onclick } = button(close);
    expect(label).toBe('open');
    await onclick();
    expect(close).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith('/photos/art-1');
  });

  it('should toast artwork in a custom style', async () => {
    await artJobManager.onUpdate(job({ status: ArtJobStatus.Completed, resultAssetId: 'art-1', style: null }));

    expect(toastManager.success).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'art_ready_custom' }),
      expect.anything(),
    );
  });

  it('should toast failed jobs with the error', async () => {
    await artJobManager.onUpdate(job({ status: ArtJobStatus.Failed, error: 'No image' }));

    expect(toastManager.danger).toHaveBeenCalledWith(
      { title: 'art_failed', description: 'No image' },
      expect.anything(),
    );
    expect(toastManager.success).not.toHaveBeenCalled();
  });

  it('should ignore jobs that are still running', async () => {
    await artJobManager.onUpdate(job({ status: ArtJobStatus.Pending }));
    await artJobManager.onUpdate(job({ status: ArtJobStatus.Running }));

    expect(toastManager.success).not.toHaveBeenCalled();
    expect(toastManager.danger).not.toHaveBeenCalled();
  });

  it('should not toast jobs the art dialog shows, until it stops watching', async () => {
    const unwatch = artJobManager.watch('job-1');
    await artJobManager.onUpdate(job({ status: ArtJobStatus.Completed, resultAssetId: 'art-1' }));
    await artJobManager.onUpdate(job({ id: 'job-2', status: ArtJobStatus.Failed }));

    expect(toastManager.success).not.toHaveBeenCalled();
    expect(toastManager.danger).toHaveBeenCalledTimes(1);

    unwatch();
    await artJobManager.onUpdate(job({ status: ArtJobStatus.Completed, resultAssetId: 'art-1' }));
    expect(toastManager.success).toHaveBeenCalledTimes(1);
  });
});

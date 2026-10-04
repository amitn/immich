import {
  ActivityUndoStatus,
  BurstGroupSource,
  BurstKeepReason,
  type BurstGroupResponseDto,
  type BurstSearchResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips as render } from '$tests/helpers';
import BurstReview from './BurstReview.svelte';

const photo = (assetId: string, isOwned = true) => ({
  assetId,
  isOwned,
  isRaw: assetId.endsWith('raw'),
  isEdited: false,
  width: 4000,
  height: 3000,
  fileSize: 3_000_000,
  sharpness: 0.5,
  exposure: 0.5,
  faces: 0,
  score: 0.5,
});

const group = (key: string, ids: string[], overrides: Partial<BurstGroupResponseDto> = {}): BurstGroupResponseDto => ({
  key,
  source: BurstGroupSource.Burst,
  duplicateId: null,
  stackId: null,
  takenAt: '2026-06-01T10:00:00.000Z',
  assets: ids.map((id) => photo(id)),
  keepAssetId: ids[0],
  reasons: [BurstKeepReason.Sharpest],
  archiveAssetIds: ids.slice(1),
  readOnly: false,
  ...overrides,
});

const response = (groups: BurstGroupResponseDto[], overrides: Partial<BurstSearchResponseDto> = {}) => ({
  groups,
  total: groups.length,
  totalToArchive: groups.reduce((sum, { archiveAssetIds }) => sum + archiveAssetIds.length, 0),
  scanned: 100,
  truncated: false,
  hasNextPage: false,
  ...overrides,
});

describe('BurstReview component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    Element.prototype.animate = getAnimateMock();
  });

  const groups = () => screen.queryAllByTestId('burst-group');

  it('should show the groups with the photo to keep and why', async () => {
    sdkMock.searchBursts.mockResolvedValue(
      response([
        group('burst:a', ['a', 'b', 'c']),
        group('duplicate:d', ['d-raw', 'e'], {
          source: BurstGroupSource.Duplicate,
          reasons: [BurstKeepReason.Raw, BurstKeepReason.BestExposed],
        }),
      ]),
    );
    render(BurstReview, {});

    await waitFor(() => expect(groups()).toHaveLength(2));
    expect(sdkMock.searchBursts).toHaveBeenCalledWith({
      burstSearchDto: { rules: { preferRaw: false, preferEdited: true, preferLargest: false }, page: 1, size: 20 },
    });
    const [first, second] = groups();
    expect(within(first).getAllByTestId('burst-keeper')).toHaveLength(1);
    expect(within(first).getAllByTestId('burst-photo')).toHaveLength(2);
    expect(within(first).getByText('burst_reason_sharpest')).toBeInTheDocument();
    expect(within(second).getByText('burst_source_duplicate')).toBeInTheDocument();
    expect(
      within(second)
        .getAllByTestId('burst-reason')
        .map((reason) => reason.textContent?.trim()),
    ).toEqual(['burst_reason_raw', 'burst_reason_best_exposed']);
    // the dry run: what cleaning up the groups shown would archive
    expect(screen.getByTestId('burst-summary')).toHaveTextContent('burst_summary');
  });

  it('should keep the best of one group and offer to undo it', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([group('burst:a', ['a', 'b', 'c']), group('burst:d', ['d', 'e'])]));
    sdkMock.cleanBursts.mockResolvedValue({
      dryRun: false,
      groups: [{ keepAssetId: 'a', archivedAssetIds: ['b', 'c'] }],
      archived: 2,
      activityId: 'change',
    });
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(2));

    await fireEvent.click(within(groups()[0]).getByRole('button', { name: 'burst_keep_best' }));

    await waitFor(() => expect(groups()).toHaveLength(1));
    expect(sdkMock.cleanBursts).toHaveBeenCalledWith({
      burstCleanDto: { groups: [{ assetIds: ['a', 'b', 'c'], keepAssetId: 'a' }] },
    });
  });

  it('should undo a cleanup from its toast, and show the groups again', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([group('burst:a', ['a', 'b'])]));
    sdkMock.cleanBursts.mockResolvedValue({
      dryRun: false,
      groups: [{ keepAssetId: 'a', archivedAssetIds: ['b'] }],
      archived: 1,
      activityId: 'change',
    });
    sdkMock.undoActivities.mockResolvedValue({
      results: [{ id: 'change', summary: 'Kept the best', status: ActivityUndoStatus.Undone, warnings: [] }],
      undone: 1,
      refused: 0,
    });
    const success = vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(1));

    await fireEvent.click(within(groups()[0]).getByRole('button', { name: 'burst_keep_best' }));
    await waitFor(() => expect(groups()).toHaveLength(0));

    const [toast] = success.mock.calls[0] as unknown as [
      { title: string; button: (close: () => void) => { onclick: () => unknown } },
    ];
    expect(toast.title).toBe('burst_archived');
    const close = vi.fn();
    await toast.button(close).onclick();

    expect(close).toHaveBeenCalled();
    expect(sdkMock.undoActivities).toHaveBeenCalledWith({ activityUndoDto: { ids: ['change'] } });
    await waitFor(() => expect(groups()).toHaveLength(1));
    expect(sdkMock.searchBursts).toHaveBeenCalledTimes(2);
  });

  it('should keep the photo the user picked instead', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([group('burst:a', ['a', 'b', 'c'])]));
    sdkMock.cleanBursts.mockResolvedValue({
      dryRun: false,
      groups: [{ keepAssetId: 'c', archivedAssetIds: ['a', 'b'] }],
      archived: 2,
      activityId: null,
    });
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(1));

    const third = within(groups()[0]).getAllByRole('button', { name: /burst_keep_this|burst_kept_photo/ })[2];
    await fireEvent.click(third);
    expect(within(groups()[0]).getByText('burst_your_pick')).toBeInTheDocument();
    expect(within(groups()[0]).queryByText('burst_reason_sharpest')).not.toBeInTheDocument();

    await fireEvent.click(within(groups()[0]).getByRole('button', { name: 'burst_keep_best' }));

    await waitFor(() => expect(groups()).toHaveLength(0));
    expect(sdkMock.cleanBursts).toHaveBeenCalledWith({
      burstCleanDto: { groups: [{ assetIds: ['a', 'b', 'c'], keepAssetId: 'c' }] },
    });
  });

  it('should clean up all the groups shown after asking', async () => {
    sdkMock.searchBursts.mockResolvedValue(
      response([
        group('burst:a', ['a', 'b']),
        group('burst:c', ['c', 'd'], { readOnly: true, archiveAssetIds: [], assets: [photo('c', false), photo('d')] }),
        group('burst:e', ['e', 'f', 'g']),
      ]),
    );
    sdkMock.cleanBursts.mockResolvedValue({
      dryRun: false,
      groups: [
        { keepAssetId: 'a', archivedAssetIds: ['b'] },
        { keepAssetId: 'e', archivedAssetIds: ['f', 'g'] },
      ],
      archived: 3,
      activityId: 'change',
    });
    const showDialog = vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(3));

    await fireEvent.click(screen.getByRole('button', { name: 'burst_clean_all' }));

    await waitFor(() => expect(groups()).toHaveLength(1));
    expect(showDialog).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'burst_clean_all_prompt' }));
    // the read-only group of someone else's photos is left out
    expect(sdkMock.cleanBursts).toHaveBeenCalledWith({
      burstCleanDto: {
        groups: [
          { assetIds: ['a', 'b'], keepAssetId: 'a' },
          { assetIds: ['e', 'f', 'g'], keepAssetId: 'e' },
        ],
      },
    });
    expect(within(groups()[0]).getByText('burst_read_only')).toBeInTheDocument();
    expect(within(groups()[0]).queryByRole('button', { name: 'burst_keep_best' })).not.toBeInTheDocument();
  });

  it('should not clean up anything when the user says no', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([group('burst:a', ['a', 'b'])]));
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(false);
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(1));

    await fireEvent.click(screen.getByRole('button', { name: 'burst_clean_all' }));

    expect(sdkMock.cleanBursts).not.toHaveBeenCalled();
    expect(groups()).toHaveLength(1);
  });

  it('should search again with a rule, and remember it', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([group('burst:a', ['a', 'b'])]));
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(1));

    await fireEvent.click(screen.getByLabelText('burst_rule_prefer_raw'));

    await waitFor(() =>
      expect(sdkMock.searchBursts).toHaveBeenLastCalledWith({
        burstSearchDto: { rules: { preferRaw: true, preferEdited: true, preferLargest: false }, page: 1, size: 20 },
      }),
    );
    expect(JSON.parse(localStorage.getItem('burst-cleanup-rules')!)).toEqual({
      preferRaw: true,
      preferEdited: true,
      preferLargest: false,
    });
  });

  it('should start with the photos of an album', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([]));
    sdkMock.getAllAlbums.mockResolvedValue([]);
    render(BurstReview, { albumId: 'album' });

    await waitFor(() => expect(screen.getByText('burst_none')).toBeInTheDocument());
    expect(sdkMock.searchBursts).toHaveBeenCalledWith({
      burstSearchDto: expect.objectContaining({ albumId: 'album' }),
    });
  });

  it('should skip a group', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([group('burst:a', ['a', 'b']), group('burst:c', ['c', 'd'])]));
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(2));

    await fireEvent.click(within(groups()[0]).getByRole('button', { name: 'skip' }));

    expect(groups()).toHaveLength(1);
    expect(sdkMock.cleanBursts).not.toHaveBeenCalled();
  });

  it('should load more groups', async () => {
    sdkMock.searchBursts
      .mockResolvedValueOnce(response([group('burst:a', ['a', 'b'])], { total: 2, hasNextPage: true }))
      .mockResolvedValueOnce(response([group('burst:c', ['c', 'd'])], { total: 2, hasNextPage: false }));
    render(BurstReview, {});
    await waitFor(() => expect(groups()).toHaveLength(1));

    await fireEvent.click(screen.getByRole('button', { name: 'load_more' }));

    await waitFor(() => expect(groups()).toHaveLength(2));
    expect(sdkMock.searchBursts).toHaveBeenLastCalledWith({
      burstSearchDto: expect.objectContaining({ page: 2 }),
    });
    expect(screen.queryByRole('button', { name: 'load_more' })).not.toBeInTheDocument();
  });

  it('should say when there is nothing to clean up', async () => {
    sdkMock.searchBursts.mockResolvedValue(response([]));
    render(BurstReview, {});

    await waitFor(() => expect(screen.getByText('burst_none')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'burst_clean_all' })).not.toBeInTheDocument();
  });
});

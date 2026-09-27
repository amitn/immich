import { OrientationStatus, type OrientationSuggestionResponseDto } from '@immich/sdk';
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips as render } from '$tests/helpers';
import OrientationReview from './OrientationReview.svelte';

const suggestion = (assetId: string, rotate = 90): OrientationSuggestionResponseDto => ({
  assetId,
  status: OrientationStatus.Suggested,
  rotate,
  confidence: 0.92,
  reasons: ['CLIP: upright when turned 90° (92%)'],
  checkedAt: '2026-09-01T00:00:00.000Z',
});

describe('OrientationReview component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
  });

  const cards = () => screen.queryAllByTestId('orientation-card');

  it('should show the photos to turn, turned as suggested', () => {
    render(OrientationReview, { suggestions: [suggestion('a', 90), suggestion('b', 180)], fixed: [] });

    expect(cards()).toHaveLength(2);
    const [first, second] = cards().map((card) => card.querySelector('img')!);
    expect(first.style.transform).toBe('rotate(90deg)');
    expect(first).toHaveAttribute('alt', 'orientation_turn_right');
    expect(second.style.transform).toBe('rotate(180deg)');
    expect(screen.getByText('orientation_turn_right · 92%')).toBeInTheDocument();
  });

  it('should turn one photo upright and move it to the fixed ones', async () => {
    sdkMock.fixOrientation.mockResolvedValue([{ id: 'a', success: true }]);
    render(OrientationReview, { suggestions: [suggestion('a'), suggestion('b')], fixed: [] });

    await fireEvent.click(within(cards()[0]).getByRole('button', { name: 'orientation_fix' }));

    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(sdkMock.fixOrientation).toHaveBeenCalledWith({ orientationFixDto: { assetIds: ['a'] } });
    await fireEvent.click(screen.getByRole('tab', { name: 'orientation_fixed' }));
    expect(cards()).toHaveLength(1);
  });

  it('should keep a photo as it is', async () => {
    sdkMock.rejectOrientation.mockResolvedValue([{ id: 'a', success: true }]);
    render(OrientationReview, { suggestions: [suggestion('a')], fixed: [] });

    await fireEvent.click(screen.getByRole('button', { name: 'orientation_keep' }));

    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(sdkMock.rejectOrientation).toHaveBeenCalledWith({ orientationAssetsDto: { assetIds: ['a'] } });
    expect(screen.getByText('orientation_none')).toBeInTheDocument();
  });

  it('should fix all the photos at once', async () => {
    sdkMock.fixOrientation.mockResolvedValue([
      { id: 'a', success: true },
      { id: 'b', success: true },
    ]);
    render(OrientationReview, { suggestions: [suggestion('a'), suggestion('b', 270)], fixed: [] });

    await fireEvent.click(screen.getByRole('button', { name: 'orientation_fix_all' }));

    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(sdkMock.fixOrientation).toHaveBeenCalledWith({ orientationFixDto: { assetIds: ['a', 'b'] } });
  });

  it('should keep the photos that could not be turned', async () => {
    sdkMock.fixOrientation.mockResolvedValue([
      { id: 'a', success: true },
      { id: 'b', success: false, errorMessage: 'Editing live photos is not supported' },
    ]);
    render(OrientationReview, { suggestions: [suggestion('a'), suggestion('b')], fixed: [] });

    await fireEvent.click(screen.getByRole('button', { name: 'orientation_fix_all' }));

    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('should undo a fix', async () => {
    sdkMock.undoOrientation.mockResolvedValue([{ id: 'a', success: true }]);
    render(OrientationReview, { suggestions: [], fixed: [{ ...suggestion('a'), status: OrientationStatus.Fixed }] });

    await fireEvent.click(screen.getByRole('tab', { name: 'orientation_fixed' }));
    // a fixed photo is shown as it is now
    expect(cards()[0].querySelector('img')!.style.transform).toBe('');
    await fireEvent.click(screen.getByRole('button', { name: 'undo' }));

    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(sdkMock.undoOrientation).toHaveBeenCalledWith({ orientationAssetsDto: { assetIds: ['a'] } });
    await fireEvent.click(screen.getByRole('tab', { name: 'orientation_to_review' }));
    expect(cards()).toHaveLength(1);
  });

  it('should say when there is nothing to review', () => {
    render(OrientationReview, { suggestions: [], fixed: [] });
    expect(screen.getByText('orientation_none')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'orientation_fix_all' })).not.toBeInTheDocument();
  });
});

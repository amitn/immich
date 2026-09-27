import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import OrientationScanModal from './OrientationScanModal.svelte';

describe('OrientationScanModal component', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getAllAlbums.mockResolvedValue([]);
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should check all the photos by default', async () => {
    sdkMock.scanOrientation.mockResolvedValue();
    render(OrientationScanModal, { props: { onClose } });

    await fireEvent.click(screen.getByRole('button', { name: 'orientation_check' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(sdkMock.scanOrientation).toHaveBeenCalledWith({ orientationScanDto: {} });
  });

  it('should ask for an album or dates before checking them', async () => {
    render(OrientationScanModal, { props: { onClose } });

    await fireEvent.click(screen.getByLabelText('orientation_scope_album'));
    expect(screen.getByRole('button', { name: 'orientation_check' })).toBeDisabled();
    await fireEvent.click(screen.getByLabelText('orientation_scope_dates'));
    expect(screen.getByRole('button', { name: 'orientation_check' })).toBeDisabled();
    await fireEvent.click(screen.getByLabelText('orientation_scope_all'));
    expect(screen.getByRole('button', { name: 'orientation_check' })).toBeEnabled();
  });
});

import { BookStylePreset, CollageAspectRatio } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import CollageModal from './CollageModal.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const layouts = [
  { id: 'hero-left-two', name: 'Hero left + two', description: '' },
  { id: 'hero-top-two', name: 'Hero top + two', description: '' },
  { id: 'collage-3-columns', name: 'Three columns', description: '' },
];

describe('CollageModal component', () => {
  const onClose = vi.fn();
  const assetIds = ['a', 'b', 'c'];

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    URL.createObjectURL = vi.fn(() => 'blob:collage');
    URL.revokeObjectURL = vi.fn();
    sdkMock.getBookUserStyles.mockResolvedValue([]);
    sdkMock.getCollageLayouts.mockResolvedValue({ layouts });
    sdkMock.renderCollage.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  const lastRender = () => sdkMock.renderCollage.mock.calls.at(-1)?.[0].collageRenderDto;

  it('should show a live preview drawn by the server, square and in the classic style by default', async () => {
    render(CollageModal, { props: { assetIds, onClose } });

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'collage_preview' })).toHaveAttribute('src', 'blob:collage'),
    );
    expect(lastRender()).toEqual({
      assetIds,
      aspectRatio: CollageAspectRatio.$11,
      layout: undefined,
      title: undefined,
      stylePreset: BookStylePreset.Classic,
    });
    expect(sdkMock.getCollageLayouts).toHaveBeenCalledWith({
      collageDto: { assetIds, aspectRatio: CollageAspectRatio.$11, title: undefined, layout: undefined },
    });
  });

  it('should draw the preview again for another aspect ratio and a title', async () => {
    render(CollageModal, { props: { assetIds, onClose } });
    await waitFor(() => expect(sdkMock.renderCollage).toHaveBeenCalled());

    await fireEvent.click(screen.getByLabelText('9:16 collage_aspect_story'));
    await fireEvent.input(screen.getByPlaceholderText('collage_title_placeholder'), { target: { value: 'Palermo' } });

    await waitFor(() =>
      expect(lastRender()).toEqual(expect.objectContaining({ aspectRatio: CollageAspectRatio.$916, title: 'Palermo' })),
    );
    // the layouts are ranked again for the shape of the page with a title band
    await waitFor(() =>
      expect(sdkMock.getCollageLayouts).toHaveBeenLastCalledWith({
        collageDto: expect.objectContaining({ aspectRatio: CollageAspectRatio.$916, title: 'title' }),
      }),
    );
  });

  it('should shuffle through the layouts, best first', async () => {
    render(CollageModal, { props: { assetIds, onClose } });
    const shuffle = screen.getByRole('button', { name: 'collage_shuffle_layout' });
    await waitFor(() => expect(shuffle).toBeEnabled());

    await fireEvent.click(shuffle);
    await waitFor(() => expect(lastRender()).toEqual(expect.objectContaining({ layout: 'hero-top-two' })));
    await fireEvent.click(shuffle);
    await waitFor(() => expect(lastRender()).toEqual(expect.objectContaining({ layout: 'collage-3-columns' })));
    await fireEvent.click(shuffle);
    await waitFor(() => expect(lastRender()).toEqual(expect.objectContaining({ layout: 'hero-left-two' })));
  });

  it('should load the user’s own styles', async () => {
    sdkMock.getBookUserStyles.mockResolvedValue([
      {
        id: 'style-id',
        name: 'Wedding',
        description: '',
        style: { marginMm: 12, gutterMm: 4, background: '#ffffff', textColor: '#222222', fontFamily: 'serif' },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
    render(CollageModal, { props: { assetIds, onClose } });
    await waitFor(() => expect(sdkMock.getBookUserStyles).toHaveBeenCalled());
    await waitFor(() => expect(sdkMock.renderCollage).toHaveBeenCalled());
  });

  it('should save the collage into the album and open it there', async () => {
    sdkMock.createCollage.mockResolvedValue({
      assetId: 'collage-id',
      duplicate: false,
      layout: 'hero-left-two',
      tag: 'Collages/Palermo',
    });
    sdkMock.getAssetInfo.mockResolvedValue({ id: 'collage-id', thumbhash: 'hash' } as never);

    render(CollageModal, { props: { assetIds, albumId: 'album-id', onClose } });
    const save = screen.getByRole('button', { name: 'collage_save' });
    await waitFor(() => expect(save).toBeEnabled());
    await fireEvent.click(save);

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/albums/album-id/photos/collage-id'));
    expect(sdkMock.createCollage).toHaveBeenCalledWith({
      collageCreateDto: expect.objectContaining({ assetIds, albumId: 'album-id', layout: 'hero-left-two' }),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('should download the collage at full size', async () => {
    render(CollageModal, { props: { assetIds, onClose } });
    const download = screen.getByRole('button', { name: 'download' });
    await waitFor(() => expect(download).toBeEnabled());
    await fireEvent.click(download);

    await waitFor(() => expect(lastRender()).toEqual(expect.objectContaining({ full: true, layout: 'hero-left-two' })));
    expect(sdkMock.createCollage).not.toHaveBeenCalled();
  });

  it('should show why the collage could not be drawn', async () => {
    sdkMock.renderCollage.mockRejectedValue(new Error('boom'));
    render(CollageModal, { props: { assetIds, onClose } });
    await waitFor(() => expect(screen.getByText('errors.unable_to_render_collage')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'collage_save' })).toBeDisabled();
  });
});

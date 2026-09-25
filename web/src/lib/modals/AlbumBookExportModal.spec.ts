import { BookExportFormat, BookExportStatus, BookMapStyleOption, BookStylePreset } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import BookExportProgressModal from '$lib/modals/BookExportProgressModal.svelte';
import { albumFactory } from '@test-data/factories/album-factory';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import AlbumBookExportModal from './AlbumBookExportModal.svelte';

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: { artisticStyles: false } } as never,
}));

describe('AlbumBookExportModal component', () => {
  const onClose = vi.fn();
  const album = albumFactory.build({ albumName: 'Italy', assetCount: 30 });

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    // show() is generic, so the spy cannot infer its result type
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should create the book and start the export', async () => {
    const book = bookDetailFactory.build({ albumId: album.id });
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...book, warnings: [] });

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createBookFromAlbum).toHaveBeenCalledWith({
      bookFromAlbumDto: {
        albumId: album.id,
        title: 'Italy',
        subtitle: undefined,
        pageWidthMm: 210,
        pageHeightMm: 210,
        stylePreset: BookStylePreset.Soft,
        targetPageCount: undefined,
        includeMaps: true,
        mapStyle: BookMapStyleOption.Auto,
        illustratedMaps: false,
        improvePhotos: true,
      },
    });
    expect(sdkMock.exportBook).toHaveBeenCalledWith({ id: book.id, bookExportDto: { format: BookExportFormat.Pdf } });
    expect(modalManager.show).toHaveBeenCalledWith(BookExportProgressModal, {
      book: expect.objectContaining({ id: book.id, exportStatus: BookExportStatus.Pending }),
      formats: [BookExportFormat.Pdf],
    });
  });

  it('should create the book with the chosen style preset', async () => {
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...bookDetailFactory.build(), warnings: [] });

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(screen.getByRole('radio', { name: /book_style_preset_bold/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(sdkMock.createBookFromAlbum).toHaveBeenCalled());
    expect(sdkMock.createBookFromAlbum).toHaveBeenCalledWith({
      bookFromAlbumDto: expect.objectContaining({ stylePreset: BookStylePreset.Bold }),
    });
  });

  it('should not improve the photos when the checkbox is cleared', async () => {
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...bookDetailFactory.build({ albumId: album.id }), warnings: [] });

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'book_improve_photos' }));
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createBookFromAlbum).toHaveBeenCalledWith({
      bookFromAlbumDto: expect.objectContaining({ improvePhotos: false }),
    });
  });

  it('should not export when the book could not be created', async () => {
    sdkMock.createBookFromAlbum.mockRejectedValue(new Error('failed'));

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(sdkMock.createBookFromAlbum).toHaveBeenCalled());
    expect(sdkMock.exportBook).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

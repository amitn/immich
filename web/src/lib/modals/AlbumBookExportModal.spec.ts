import {
  BookExportFormat,
  BookExportStatus,
  BookMapLookOption,
  BookMapStyleOption,
  BookStylePreset,
} from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import BookExportProgressModal from '$lib/modals/BookExportProgressModal.svelte';
import { albumFactory } from '@test-data/factories/album-factory';
import { bookDetailFactory, bookUserStyleFactory } from '@test-data/factories/book-factory';
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
        mapStyle: BookMapStyleOption.Styled,
        mapLook: BookMapLookOption.Auto,
        illustratedMaps: false,
        improvePhotos: true,
      },
    });
    expect(sdkMock.exportBook).toHaveBeenCalledWith({ id: book.id, bookExportDto: { format: BookExportFormat.Pdf } });
    expect(modalManager.show).toHaveBeenCalledWith(BookExportProgressModal, {
      book: expect.objectContaining({ id: book.id, exportStatus: BookExportStatus.Pending }),
      formats: [BookExportFormat.Pdf],
      warnings: [],
    });
  });

  it('should create the book with the map style and look picked', async () => {
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...bookDetailFactory.build(), warnings: [] });

    render(AlbumBookExportModal, { props: { album, onClose } });
    const vintage = screen.getByTestId('book-map-style-styled-vintage');
    expect(vintage.querySelector('img')?.getAttribute('src')).toMatch(
      new RegExp(String.raw`/books/map-preview\?albumId=${album.id}&stylePreset=soft&style=styled&look=vintage`),
    );
    await fireEvent.click(screen.getByRole('radio', { name: 'book_map_look_vintage' }));
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createBookFromAlbum).toHaveBeenCalledWith({
      bookFromAlbumDto: expect.objectContaining({
        mapStyle: BookMapStyleOption.Styled,
        mapLook: BookMapLookOption.Vintage,
      }),
    });
  });

  it('should not offer the Stadia styles without a key', () => {
    render(AlbumBookExportModal, { props: { album, onClose } });
    expect(screen.getByRole('radio', { name: 'book_map_style_watercolor' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'book_map_style_sketch' })).toBeEnabled();
    expect(screen.getByText('book_map_style_stadia_unavailable')).toBeInTheDocument();
  });

  it('should pass the notes from laying out the book to the progress dialog', async () => {
    const warning = 'Watercolor maps need a Stadia Maps API key; using the offline sketch style';
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...bookDetailFactory.build(), warnings: [warning] });

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(modalManager.show).toHaveBeenCalledWith(
      BookExportProgressModal,
      expect.objectContaining({ warnings: [warning] }),
    );
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

  it('should start from the given style preset, e.g. food after naming the dishes', async () => {
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...bookDetailFactory.build(), warnings: [] });

    render(AlbumBookExportModal, { props: { album, stylePreset: BookStylePreset.Food, onClose } });

    expect(screen.getByRole('radio', { name: /book_style_preset_food/ })).toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(sdkMock.createBookFromAlbum).toHaveBeenCalled());
    expect(sdkMock.createBookFromAlbum).toHaveBeenCalledWith({
      bookFromAlbumDto: expect.objectContaining({ stylePreset: BookStylePreset.Food }),
    });
  });

  it('should not improve the photos when the switch is turned off', async () => {
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...bookDetailFactory.build({ albumId: album.id }), warnings: [] });

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(screen.getByRole('switch', { name: 'book_improve_photos' }));
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createBookFromAlbum).toHaveBeenCalledWith({
      bookFromAlbumDto: expect.objectContaining({ improvePhotos: false }),
    });
  });

  it('should show a placeholder, not a value, in the page count field', () => {
    render(AlbumBookExportModal, { props: { album, onClose } });

    const input = screen.getByPlaceholderText('book_target_page_count_placeholder');
    expect(input).toHaveValue(null);
  });

  it('should not export when the book could not be created', async () => {
    sdkMock.createBookFromAlbum.mockRejectedValue(new Error('failed'));

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(sdkMock.createBookFromAlbum).toHaveBeenCalled());
    expect(sdkMock.exportBook).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should create the book with a style of your own', async () => {
    const wedding = bookUserStyleFactory.build({ name: 'Wedding' });
    sdkMock.getBookUserStyles.mockResolvedValue([wedding]);
    sdkMock.createBookFromAlbum.mockResolvedValue({ ...bookDetailFactory.build(), warnings: [] });

    render(AlbumBookExportModal, { props: { album, onClose } });
    await fireEvent.click(await screen.findByRole('radio', { name: /Wedding/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'book_create' }));

    await waitFor(() => expect(sdkMock.createBookFromAlbum).toHaveBeenCalled());
    const [{ bookFromAlbumDto }] = sdkMock.createBookFromAlbum.mock.calls[0];
    expect(bookFromAlbumDto.stylePreset).toBeUndefined();
    expect(bookFromAlbumDto.style).toEqual(wedding.style);
  });

  it('should not offer the assistant when it is disabled', () => {
    render(AlbumBookExportModal, { props: { album, onClose } });
    expect(screen.queryByRole('button', { name: 'style_creator_create_with_assistant' })).not.toBeInTheDocument();
  });
});

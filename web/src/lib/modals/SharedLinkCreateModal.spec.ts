import { SharedLinkType, type ServerConfigDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import QrCodeModal from '$lib/modals/QrCodeModal.svelte';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import SharedLinkCreateModal from './SharedLinkCreateModal.svelte';

vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: {
    value: { externalDomain: 'https://photos.example.com' } as ServerConfigDto,
    init: vi.fn(),
    loadServerConfig: vi.fn(),
  },
}));

describe('SharedLinkCreateModal component', () => {
  const onClose = vi.fn();
  const bookId = 'b0a8d6f2-5c2e-4b8a-9d8e-2f6c1a7e3b90';

  beforeEach(() => {
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

  describe('for a book', () => {
    it('should explain the link and offer the PDF instead of uploads', async () => {
      render(SharedLinkCreateModal, { props: { onClose, book: { id: bookId, hasPdf: true } } });

      expect(await screen.findByText('book_share_description')).toBeInTheDocument();
      expect(screen.getByText('book_share_allow_pdf_download')).toBeInTheDocument();
      expect(screen.queryByText('allow_public_user_to_upload')).not.toBeInTheDocument();
      expect(screen.queryByText('allow_public_user_to_download')).not.toBeInTheDocument();
      expect(screen.queryByText('book_share_export_pdf_hint')).not.toBeInTheDocument();
    });

    it('should say when there is no PDF to download yet', async () => {
      render(SharedLinkCreateModal, { props: { onClose, book: { id: bookId, hasPdf: false } } });

      expect(await screen.findByText('book_share_export_pdf_hint')).toBeInTheDocument();
    });

    it('should create a book link with a password and show it to copy', async () => {
      const sharedLink = sharedLinkFactory.build({ type: SharedLinkType.Book, key: 'book-key', slug: null });
      sdkMock.createSharedLink.mockResolvedValue(sharedLink);

      render(SharedLinkCreateModal, { props: { onClose, book: { id: bookId, hasPdf: true } } });
      const password = await waitFor(() => {
        const input = document.querySelector<HTMLInputElement>('input[type="password"]');
        expect(input).not.toBeNull();
        return input!;
      });
      await fireEvent.input(password, { target: { value: 'secret' } });
      await fireEvent.click(screen.getByRole('button', { name: 'create_link' }));

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(sdkMock.createSharedLink).toHaveBeenCalledWith({
        sharedLinkCreateDto: expect.objectContaining({
          type: SharedLinkType.Book,
          bookId,
          password: 'secret',
          allowDownload: true,
          expiresAt: null,
        }),
      });
      const dto = sdkMock.createSharedLink.mock.calls[0][0].sharedLinkCreateDto;
      expect(dto).not.toHaveProperty('allowUpload');
      expect(dto).not.toHaveProperty('albumId');
      expect(modalManager.show).toHaveBeenCalledWith(QrCodeModal, {
        title: 'view_link',
        value: 'https://photos.example.com/share/book-key',
      });
    });
  });

  it('should still create album links', async () => {
    const albumId = 'a1b2c3d4-0000-4000-8000-000000000000';
    sdkMock.createSharedLink.mockResolvedValue(sharedLinkFactory.build({ type: SharedLinkType.Album }));
    sdkMock.getSharedLinkById.mockResolvedValue(sharedLinkFactory.build({ type: SharedLinkType.Album }));

    render(SharedLinkCreateModal, { props: { onClose, albumId } });
    expect(await screen.findByText('album_with_link_access')).toBeInTheDocument();
    expect(screen.getByText('allow_public_user_to_upload')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'create_link' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createSharedLink).toHaveBeenCalledWith({
      sharedLinkCreateDto: expect.objectContaining({ type: SharedLinkType.Album, albumId, allowUpload: false }),
    });
    expect(sdkMock.createSharedLink.mock.calls[0][0].sharedLinkCreateDto).not.toHaveProperty('bookId');
  });
});

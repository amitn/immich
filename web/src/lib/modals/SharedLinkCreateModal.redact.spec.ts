import { SharedLinkType, type ServerConfigDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import SharedLinkCreateModal from './SharedLinkCreateModal.svelte';

vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: {
    value: { externalDomain: 'https://photos.example.com' } as ServerConfigDto,
    init: vi.fn(),
    loadServerConfig: vi.fn(),
  },
}));

// #14: a link can blur the faces of people not in what it shares, and the text and plates, for its visitors

describe('SharedLinkCreateModal redaction', () => {
  const onClose = vi.fn();
  const albumId = 'a0a8d6f2-5c2e-4b8a-9d8e-2f6c1a7e3b90';
  const bookId = 'b0a8d6f2-5c2e-4b8a-9d8e-2f6c1a7e3b90';

  beforeEach(() => {
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should offer to blur the faces of people not in the album, off by default', async () => {
    const sharedLink = sharedLinkFactory.build({ type: SharedLinkType.Album });
    sdkMock.createSharedLink.mockResolvedValue(sharedLink);
    sdkMock.getSharedLinkById.mockResolvedValue(sharedLink);
    render(SharedLinkCreateModal, { props: { onClose, albumId } });

    const faces = await screen.findByRole('switch', { name: 'shared_link_redact_faces_album' });
    const text = screen.getByRole('switch', { name: 'shared_link_redact_text' });
    expect(faces).not.toBeChecked();
    expect(text).not.toBeChecked();
    expect(screen.queryByTestId('shared-link-redact-note')).not.toBeInTheDocument();

    await fireEvent.click(faces);
    expect(await screen.findByTestId('shared-link-redact-note')).toHaveTextContent('shared_link_redact_note');

    await fireEvent.click(screen.getByRole('button', { name: 'create_link' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdkMock.createSharedLink).toHaveBeenCalledWith({
      sharedLinkCreateDto: expect.objectContaining({
        type: SharedLinkType.Album,
        albumId,
        redactFaces: true,
        redactText: false,
      }),
    });
  });

  it('should word the options for a book, whose PDF is not shared while something is blurred', async () => {
    sdkMock.createSharedLink.mockResolvedValue(sharedLinkFactory.build({ type: SharedLinkType.Book }));
    render(SharedLinkCreateModal, { props: { onClose, book: { id: bookId, hasPdf: true } } });

    expect(await screen.findByRole('switch', { name: 'shared_link_redact_faces_book' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('switch', { name: 'shared_link_redact_text' }));
    expect(await screen.findByTestId('shared-link-redact-note')).toHaveTextContent('shared_link_redact_note_book');

    await fireEvent.click(screen.getByRole('button', { name: 'create_link' }));
    await waitFor(() => expect(sdkMock.createSharedLink).toHaveBeenCalled());
    expect(sdkMock.createSharedLink.mock.calls[0][0].sharedLinkCreateDto).toMatchObject({
      type: SharedLinkType.Book,
      bookId,
      redactFaces: false,
      redactText: true,
    });
  });

  it('should word the faces option for photos shared one by one', async () => {
    render(SharedLinkCreateModal, { props: { onClose, assetIds: ['asset-1'] } });
    expect(await screen.findByRole('switch', { name: 'shared_link_redact_faces' })).toBeInTheDocument();
  });
});

import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import StyleCreatorModal from '$lib/modals/StyleCreatorModal.svelte';
import { bookUserStyleFactory } from '@test-data/factories/book-factory';
import ManageBookStylesModal from './ManageBookStylesModal.svelte';

const { flags } = vi.hoisted(() => ({ flags: { assistant: true } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: flags } as never,
}));

describe('ManageBookStylesModal component', () => {
  const onClose = vi.fn();
  const wedding = bookUserStyleFactory.build({ name: 'Wedding' });
  const polaroid = bookUserStyleFactory.build({ name: 'Polaroid' });

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    sdkMock.getBookUserStyles.mockResolvedValue([wedding, polaroid]);
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should list the styles of the user', async () => {
    render(ManageBookStylesModal, { props: { onClose } });

    const names = await screen.findAllByRole('textbox');
    expect(names.map((input) => (input as HTMLInputElement).value)).toEqual(['Wedding', 'Polaroid']);
  });

  it('should rename a style', async () => {
    sdkMock.updateBookUserStyle.mockResolvedValue({ ...wedding, name: 'Our wedding' });

    render(ManageBookStylesModal, { props: { onClose } });
    const [input] = await screen.findAllByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Our wedding' } });
    await fireEvent.click(screen.getByRole('button', { name: 'book_style_rename_named' }));

    await waitFor(() =>
      expect(sdkMock.updateBookUserStyle).toHaveBeenCalledWith({
        id: wedding.id,
        bookUserStyleUpdateDto: { name: 'Our wedding' },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'book_style_rename_named' })).toBeNull());
  });

  it('should delete a style after asking', async () => {
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    sdkMock.deleteBookUserStyle.mockResolvedValue(undefined as never);

    render(ManageBookStylesModal, { props: { onClose } });
    const [deleteWedding] = await screen.findAllByRole('button', { name: 'book_style_delete_named' });
    await fireEvent.click(deleteWedding);

    await waitFor(() => expect(sdkMock.deleteBookUserStyle).toHaveBeenCalledWith({ id: wedding.id }));
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(1));
  });

  it('should keep a style when the deletion is not confirmed', async () => {
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(false);

    render(ManageBookStylesModal, { props: { onClose } });
    const [deleteWedding] = await screen.findAllByRole('button', { name: 'book_style_delete_named' });
    await fireEvent.click(deleteWedding);

    await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
    expect(sdkMock.deleteBookUserStyle).not.toHaveBeenCalled();
  });

  it('should explain how to get styles and offer the assistant', async () => {
    sdkMock.getBookUserStyles.mockResolvedValue([]);
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);

    render(ManageBookStylesModal, { props: { onClose } });
    expect(await screen.findByText('book_style_manage_empty')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'style_creator_create_with_assistant' }));

    expect(onClose).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(StyleCreatorModal, { target: { kind: 'book' } });
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { openAssistant } from '$lib/services/assistant.service';
import { STYLE_CREATOR_EXAMPLES } from '$lib/utils/style-creator';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import StyleCreatorModal from './StyleCreatorModal.svelte';

vi.mock('$lib/services/assistant.service', () => ({ openAssistant: vi.fn() }));

describe('StyleCreatorModal component', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should ask for a description with a few examples', () => {
    render(StyleCreatorModal, { props: { target: { kind: 'book' }, onClose } });

    expect(screen.getByText('style_creator_book_title')).toBeInTheDocument();
    expect(screen.getByText('style_creator_describe')).toBeInTheDocument();
    for (const key of STYLE_CREATOR_EXAMPLES.book) {
      expect(screen.getByRole('button', { name: key })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'style_creator_open_assistant' })).toBeDisabled();
  });

  it('should open the assistant with the book and the chosen example', async () => {
    const book = bookDetailFactory.build({ id: 'book-1', title: 'Sicily' });

    render(StyleCreatorModal, { props: { target: { kind: 'book', book }, onClose } });
    const [example] = STYLE_CREATOR_EXAMPLES.book;
    await fireEvent.click(screen.getByRole('button', { name: example }));
    expect(screen.getByRole('button', { name: example })).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(screen.getByRole('button', { name: 'style_creator_open_assistant' }));

    await waitFor(() => expect(openAssistant).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(openAssistant).toHaveBeenCalledWith({ prompt: 'style_creator_book_prompt_book', assetIds: [] });
  });

  it('should open the assistant with the photo of an art style', async () => {
    render(StyleCreatorModal, { props: { target: { kind: 'art', assetId: 'photo-1' }, onClose } });

    expect(screen.getByText('style_creator_art_title')).toBeInTheDocument();
    for (const key of STYLE_CREATOR_EXAMPLES.art) {
      expect(screen.getByRole('button', { name: key })).toBeInTheDocument();
    }
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'An embroidery on linen' } });
    await fireEvent.click(screen.getByRole('button', { name: 'style_creator_open_assistant' }));

    await waitFor(() =>
      expect(openAssistant).toHaveBeenCalledWith({ prompt: 'style_creator_art_prompt', assetIds: ['photo-1'] }),
    );
  });
});

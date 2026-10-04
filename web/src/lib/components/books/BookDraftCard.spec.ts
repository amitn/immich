import { fireEvent, render, screen } from '@testing-library/svelte';
import { bookDraftFactory } from '@test-data/factories/book-factory';
import BookDraftCard from './BookDraftCard.svelte';

describe('BookDraftCard component', () => {
  const draft = bookDraftFactory.build({ reason: 'You visited 6 restaurants in 2025 and photographed 54 dishes' });

  it('should show the cover, the title and why it is suggested, and open the draft', () => {
    render(BookDraftCard, { props: { draft, onKeep: vi.fn(), onDiscard: vi.fn() } });

    expect(screen.getByRole('link')).toHaveAttribute('href', `/books/${draft.book.id}`);
    expect(screen.getByText(draft.book.title)).toBeInTheDocument();
    expect(screen.getByText('You visited 6 restaurants in 2025 and photographed 54 dishes')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining(`/books/${draft.book.id}/pages/${draft.book.firstPageId}/render`),
    );
  });

  it('should keep or discard the draft', async () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(BookDraftCard, { props: { draft, onKeep, onDiscard } });

    await fireEvent.click(screen.getByRole('button', { name: 'book_draft_keep_title' }));
    await fireEvent.click(screen.getByRole('button', { name: 'book_draft_discard_title' }));

    expect(onKeep).toHaveBeenCalledWith(draft);
    expect(onDiscard).toHaveBeenCalledWith(draft);
  });

  it('should disable the actions while one runs', () => {
    render(BookDraftCard, { props: { draft, busy: true, onKeep: vi.fn(), onDiscard: vi.fn() } });

    expect(screen.getByRole('button', { name: 'book_draft_keep_title' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'book_draft_discard_title' })).toBeDisabled();
  });
});

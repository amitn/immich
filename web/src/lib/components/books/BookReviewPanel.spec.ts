import { Severity, Type } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { openAssistant } from '$lib/services/assistant.service';
import { bookReviewIssueFactory, buildBookReview } from '@test-data/factories/book-review-factory';
import BookReviewPanel from './BookReviewPanel.svelte';

vi.mock('$lib/services/assistant.service', () => ({ openAssistant: vi.fn() }));

type Props = ComponentProps<typeof BookReviewPanel>;

describe('BookReviewPanel component', () => {
  const book = { id: 'book-1', title: 'Italy' };
  const onRefresh = vi.fn();
  const onGoToPage = vi.fn();
  const onClose = vi.fn();

  const duplicate = bookReviewIssueFactory.build({
    severity: Severity.High,
    type: Type.DuplicateStack,
    message: 'Pages 2 and 7 show the same photo',
    pages: [2, 7],
  });
  const lowDpi = bookReviewIssueFactory.build({
    severity: Severity.High,
    type: Type.LowDpi,
    message: 'Page 4, photo 2 prints at 120 dpi',
    pages: [4],
    slot: 2,
    assetIds: ['asset-1'],
  });
  const layout = bookReviewIssueFactory.build({
    severity: Severity.Medium,
    type: Type.RepeatedLayout,
    message: 'Pages 5 and 6 use the same layout',
    pages: [5, 6],
  });
  const person = bookReviewIssueFactory.build({
    severity: Severity.Low,
    type: Type.PersonUnderrepresented,
    message: 'Anna is in 1 photo',
    pages: [],
  });

  const renderPanel = (props: Partial<Props> = {}) =>
    render(TestWrapper<Props>, {
      props: {
        component: BookReviewPanel,
        componentProps: {
          id: 'review',
          book,
          review: buildBookReview({ issues: [duplicate, lowDpi, layout, person] }),
          onRefresh,
          onGoToPage,
          onClose,
          ...props,
        },
      },
    });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
    sdkMock.getAssetThumbnailPath.mockImplementation((id) => `/assets/${id}/thumbnail`);
    sdkMock.getPeopleThumbnailPath.mockImplementation((id) => `/people/${id}/thumbnail`);
  });

  it('should be labelled and take the focus', () => {
    renderPanel();

    const panel = screen.getByRole('complementary', { name: 'book_review_title' });
    expect(panel).toHaveAttribute('id', 'review');
    expect(screen.getByRole('heading', { level: 2, name: 'book_review_title' })).toHaveFocus();
  });

  it('should group the issues by severity', () => {
    renderPanel();

    const groups = screen.getAllByRole('region');
    expect(groups.map((group) => group.dataset.severity)).toEqual([Severity.High, Severity.Medium, Severity.Low]);
    expect(within(groups[0]).getByRole('heading', { level: 3 })).toHaveTextContent('book_review_severity_high (2)');
    expect(
      within(groups[0])
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('Pages 2 and 7 show the same photo'),
      expect.stringContaining('Page 4, photo 2 prints at 120 dpi'),
    ]);
    expect(within(groups[1]).getByText('book_review_issue_repeated_layout')).toBeInTheDocument();
    expect(within(groups[2]).getByText('Anna is in 1 photo')).toBeInTheDocument();
  });

  it('should go to the page and slot of an issue', async () => {
    renderPanel();

    await fireEvent.click(screen.getByRole('button', { name: /prints at 120 dpi/ }));
    expect(onGoToPage).toHaveBeenCalledWith(4, 2);

    await fireEvent.click(screen.getByRole('button', { name: /show the same photo/ }));
    expect(onGoToPage).toHaveBeenLastCalledWith(2, undefined);
  });

  it('should not offer to go to an issue that is not on a page', () => {
    renderPanel();

    expect(screen.queryByRole('button', { name: /Anna is in 1 photo/ })).not.toBeInTheDocument();
  });

  it('should fix an issue with the assistant', async () => {
    renderPanel();

    const [, lowDpiFix] = screen.getAllByRole('button', { name: 'book_review_fix_issue' });
    await fireEvent.click(lowDpiFix);

    expect(openAssistant).toHaveBeenCalledWith({
      prompt: 'book_review_fix_prompt',
      assetIds: ['asset-1'],
    });
  });

  it('should fix all issues with the assistant', async () => {
    renderPanel();

    await fireEvent.click(screen.getByRole('button', { name: 'book_review_fix_all' }));

    expect(openAssistant).toHaveBeenCalledWith({ prompt: 'book_review_fix_all_prompt' });
  });

  it('should say when there are no problems', () => {
    renderPanel({ review: buildBookReview() });

    expect(screen.getByText('book_review_no_issues')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'book_review_fix_all' })).not.toBeInTheDocument();
  });

  it('should show the good photos that are not used', async () => {
    renderPanel({
      review: buildBookReview({
        unusedPhotos: [
          { assetId: 'asset-2', score: 0.9, people: ['Anna'], city: 'Rome' },
          { assetId: 'asset-3', score: 0.8 },
        ],
      }),
    });

    const section = screen.getByRole('region', { name: 'book_review_unused_photos' });
    const images = within(section).getAllByRole('img');
    expect(images.map((image) => image.getAttribute('alt'))).toEqual(['Anna · Rome', 'book_review_unused_photo']);
    expect(images[0].getAttribute('src')).toContain('/api/assets/asset-2/thumbnail');

    await fireEvent.click(within(section).getByRole('button', { name: 'book_review_use_unused' }));
    expect(openAssistant).toHaveBeenCalledWith({
      prompt: 'book_review_unused_prompt',
      assetIds: ['asset-2', 'asset-3'],
    });
  });

  it('should go to the weakest photos', async () => {
    renderPanel({ review: buildBookReview({ weakestPlaced: [{ assetId: 'asset-4', score: 0.2, page: 3, slot: 1 }] }) });

    await fireEvent.click(screen.getByRole('button', { name: 'book_review_go_to_photo' }));

    expect(onGoToPage).toHaveBeenCalledWith(3, 1);
  });

  it('should show how often the main people appear', () => {
    renderPanel({
      review: buildBookReview({
        people: [
          { personId: 'person-1', name: 'Anna', photos: 12, placed: 4 },
          { personId: 'person-2', photos: 5, placed: 0 },
        ],
      }),
    });

    const section = screen.getByRole('region', { name: 'book_review_people' });
    const items = within(section).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Anna');
    expect(items[1]).toHaveTextContent('unknown');
    expect(items[0].querySelector('img')?.getAttribute('src')).toContain('/api/people/person-1/thumbnail');
  });

  it('should show that the review is loading', () => {
    renderPanel({ review: undefined, loading: true });

    expect(screen.getByText('book_review_loading')).toBeInTheDocument();
    expect(screen.queryByText('book_review_no_issues')).not.toBeInTheDocument();
  });

  it('should offer to try again when the review failed', async () => {
    renderPanel({ review: undefined, failed: true });

    const alert = screen.getByRole('alert');
    await fireEvent.click(within(alert).getByRole('button', { name: 'book_review_refresh' }));

    expect(onRefresh).toHaveBeenCalled();
  });

  it('should close with the close button and with Escape', async () => {
    renderPanel();

    await fireEvent.click(screen.getByRole('button', { name: 'book_review_close' }));
    await fireEvent.keyDown(screen.getByRole('button', { name: 'book_review_fix_all' }), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

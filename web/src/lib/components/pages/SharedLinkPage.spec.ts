import { SharedLinkType, type SharedLinkResponseDto } from '@immich/sdk';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import type { DetachedWindowAPI } from 'happy-dom';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips } from '$tests/helpers';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import SharedLinkPage from './SharedLinkPage.svelte';

vi.mock(import('$lib/utils/navigation'), async (originalImport) => ({
  ...(await originalImport()),
  navigate: vi.fn(),
}));

describe('SharedLinkPage component', () => {
  const bookId = 'b0a8d6f2-5c2e-4b8a-9d8e-2f6c1a7e3b90';
  const bookLink = (link: Partial<SharedLinkResponseDto> = {}) =>
    sharedLinkFactory.build({
      type: SharedLinkType.Book,
      key: 'book-key',
      slug: null,
      allowDownload: true,
      description: null,
      ...link,
      book: { id: bookId, title: 'Summer in Rome', subtitle: null, pageCount: 24, hasPdf: true },
    });

  beforeAll(() => {
    // never request the book from a server
    (globalThis as unknown as { happyDOM: DetachedWindowAPI }).happyDOM.settings.disableIframePageLoading = true;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
    Element.prototype.animate = getAnimateMock();
  });

  it('should show a shared book', () => {
    renderWithTooltips(SharedLinkPage, {
      data: { meta: { title: 'Summer in Rome' }, sharedLink: bookLink(), key: 'book-key' },
    });

    expect(screen.getByRole('heading', { name: 'Summer in Rome' })).toBeInTheDocument();
    expect(screen.getByTitle('book_shared_frame_title').getAttribute('src')).toBe(
      `/api/books/${bookId}/preview?key=book-key`,
    );
  });

  it('should ask for the password before showing the book', async () => {
    sdkMock.sharedLinkLogin.mockResolvedValue(bookLink({ password: 'secret' }));

    renderWithTooltips(SharedLinkPage, {
      data: { meta: { title: 'password_required' }, key: 'book-key', passwordRequired: true },
    });

    expect(screen.getByText('password_required')).toBeInTheDocument();
    expect(screen.queryByTitle('book_shared_frame_title')).not.toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    await fireEvent.input(input, { target: { value: 'secret' } });
    await fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => expect(screen.getByTitle('book_shared_frame_title')).toBeInTheDocument());
    expect(sdkMock.sharedLinkLogin).toHaveBeenCalledWith({
      key: 'book-key',
      slug: undefined,
      sharedLinkLoginDto: { password: 'secret' },
    });
    expect(screen.getByRole('heading', { name: 'Summer in Rome' })).toBeInTheDocument();
  });
});

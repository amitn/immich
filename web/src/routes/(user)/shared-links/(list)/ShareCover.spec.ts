import { SharedLinkType } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { getAssetMediaUrl, getBookPageRenderUrl } from '$lib/utils';
import { albumFactory } from '@test-data/factories/album-factory';
import { assetFactory } from '@test-data/factories/asset-factory';
import { bookFactory } from '@test-data/factories/book-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import ShareCover from './ShareCover.svelte';

vi.mock('$lib/utils');

describe('ShareCover component', () => {
  it('renders an image when the shared link is an album', () => {
    const component = render(ShareCover, {
      sharedLink: sharedLinkFactory.build({ album: albumFactory.build({ albumName: '123' }) }),
      preload: false,
      class: 'text',
    });
    const img = component.getByTestId('album-image') as HTMLImageElement;
    expect(img.alt).toBe('123');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toBe('size-full rounded-xl object-cover aspect-square text');
  });

  it('renders an image when the shared link is an individual share', () => {
    vi.mocked(getAssetMediaUrl).mockReturnValue('/asdf');
    const component = render(ShareCover, {
      sharedLink: sharedLinkFactory.build({ assets: [assetFactory.build({ id: 'someId' })] }),
      preload: false,
      class: 'text',
    });
    const img = component.getByTestId('album-image') as HTMLImageElement;
    expect(img.alt).toBe('individual_share');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toBe('size-full rounded-xl object-cover aspect-square text');
    expect(img.getAttribute('src')).toBe('/asdf');
    expect(getAssetMediaUrl).toHaveBeenCalledWith({ id: 'someId' });
  });

  it('renders a book icon for a link to a book, whose photos are not shared', () => {
    const component = render(ShareCover, {
      sharedLink: sharedLinkFactory.build({
        type: SharedLinkType.Book,
        book: { id: 'book-id', title: 'Summer in Rome', subtitle: null, pageCount: 12, hasPdf: false },
      }),
      preload: false,
    });
    expect(component.getByTestId('book-cover')).toHaveAccessibleName('Summer in Rome');
    expect(component.queryByTestId('album-image')).not.toBeInTheDocument();
    expect(getAssetMediaUrl).not.toHaveBeenCalledWith({ id: 'book-id' });
  });

  it("renders the first page of a book, as the list of books does, for the owner's view", () => {
    vi.mocked(getBookPageRenderUrl).mockReturnValue('/page-1');
    const book = bookFactory.build({ id: 'book-id', title: 'Summer in Rome', firstPageId: 'page-1' });
    const component = render(ShareCover, {
      sharedLink: sharedLinkFactory.build({
        type: SharedLinkType.Book,
        book: { id: 'book-id', title: 'Summer in Rome', subtitle: null, pageCount: 12, hasPdf: false },
      }),
      book,
    });

    const cover = component.getByTestId('book-cover');
    expect(cover).toHaveAccessibleName('Summer in Rome');
    expect(cover.querySelector('img')?.getAttribute('src')).toBe('/page-1');
    expect(getBookPageRenderUrl).toHaveBeenCalledWith({
      id: 'book-id',
      pageId: 'page-1',
      size: 240,
      cacheKey: book.updatedAt,
    });
  });

  it('renders the cover photo of a book without pages', () => {
    vi.mocked(getAssetMediaUrl).mockReturnValue('/cover-photo');
    const book = bookFactory.build({ id: 'book-id', firstPageId: null, coverAssetId: 'cover-id' });
    const component = render(ShareCover, {
      sharedLink: sharedLinkFactory.build({
        type: SharedLinkType.Book,
        book: { id: 'book-id', title: 'Summer in Rome', subtitle: null, pageCount: 0, hasPdf: false },
      }),
      book,
    });

    expect(component.getByTestId('book-cover').querySelector('img')?.getAttribute('src')).toBe('/cover-photo');
  });

  it('renders an image when the shared link has no album or assets', () => {
    const component = render(ShareCover, {
      sharedLink: sharedLinkFactory.build(),
      preload: false,
      class: 'text',
    });
    const img = component.getByTestId('album-image') as HTMLImageElement;
    expect(img.alt).toBe('unnamed_share');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toBe('size-full rounded-xl object-cover aspect-square text');
  });

  it.skip('renders fallback image when asset is not resized', () => {
    const sharedLink = sharedLinkFactory.build({ assets: [assetFactory.build()] });
    render(ShareCover, {
      sharedLink,
      preload: false,
    });

    // TODO emit image error event and check if fallback image is rendered

    const img = screen.getByTestId<HTMLImageElement>('album-image');
    expect(img.alt).toBe('unnamed_share');
  });
});

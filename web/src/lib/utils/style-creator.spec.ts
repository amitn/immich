import type { MessageFormatter } from 'svelte-i18n';
import { MAX_STYLE_SAMPLE_PHOTOS, getBookSampleAssetIds, getStyleCreatorRequest } from '$lib/utils/style-creator';
import { bookDetailFactory } from '@test-data/factories/book-factory';

/** Shows the key and the values, to check what goes into a prompt */
const $t = ((key: string, options?: { values?: Record<string, unknown> }) =>
  options?.values ? `${key} ${JSON.stringify(options.values)}` : key) as unknown as MessageFormatter;

const values = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf(' ') + 1));

const slot = (assetId: string | null) => ({ slot: 0, aspectRatio: 1, assetId, crop: null, caption: null });
const page = (...assetIds: Array<string | null>) =>
  ({
    id: 'page',
    position: 0,
    layout: 'single',
    sectionTitle: null,
    caption: null,
    background: null,
    map: null,
    slots: assetIds.map((assetId) => slot(assetId)),
    updatedAt: '2026-09-01T00:00:00.000Z',
  }) as never;

describe('getBookSampleAssetIds', () => {
  it('should take the cover, then the photos in page order, each once', () => {
    const book = bookDetailFactory.build({ coverAssetId: 'c', pages: [page('a', null, 'b'), page('b', 'c', 'd')] });
    expect(getBookSampleAssetIds(book)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('should take a few photos only', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `asset-${index}`);
    const book = bookDetailFactory.build({ pages: [page(...ids)] });
    expect(getBookSampleAssetIds(book)).toHaveLength(MAX_STYLE_SAMPLE_PHOTOS);
  });
});

describe('getStyleCreatorRequest', () => {
  it('should name the book and attach some of its photos', () => {
    const book = bookDetailFactory.build({ id: 'book-1', title: 'Sicily', pages: [page('a', 'b')] });

    const { prompt, assetIds } = getStyleCreatorRequest($t, { kind: 'book', book }, '  A 1970s Polaroid album.  ');

    expect(prompt).toMatch(/^style_creator_book_prompt_book /);
    expect(values(prompt)).toEqual({ description: 'A 1970s Polaroid album', title: 'Sicily', id: 'book-1' });
    expect(assetIds).toEqual(['a', 'b']);
  });

  it('should name the album a book is about to be made from', () => {
    const { prompt, assetIds } = getStyleCreatorRequest(
      $t,
      { kind: 'book', album: { id: 'album-1', albumName: 'Wedding', albumThumbnailAssetId: 'thumb' } },
      'ivory, sage and gold',
    );

    expect(prompt).toMatch(/^style_creator_book_prompt_album /);
    expect(values(prompt)).toEqual({ description: 'ivory, sage and gold', name: 'Wedding', id: 'album-1' });
    expect(assetIds).toEqual(['thumb']);
  });

  it('should work without a book', () => {
    expect(getStyleCreatorRequest($t, { kind: 'book' }, 'dark and moody').prompt).toMatch(
      /^style_creator_book_prompt /,
    );
    expect(getStyleCreatorRequest($t, { kind: 'book', assetIds: ['a'] }, 'dark').prompt).toMatch(
      /^style_creator_book_prompt_photos /,
    );
  });

  it('should attach the photo an art style is tested on', () => {
    const { prompt, assetIds } = getStyleCreatorRequest($t, { kind: 'art', assetId: 'photo-1' }, 'a blueprint');

    expect(prompt).toMatch(/^style_creator_art_prompt /);
    expect(values(prompt)).toEqual({ description: 'a blueprint', id: 'photo-1' });
    expect(assetIds).toEqual(['photo-1']);
  });
});

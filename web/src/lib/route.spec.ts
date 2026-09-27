import { OpenQueryParam } from '$lib/constants';
import { Route } from '$lib/route';

describe('Route', () => {
  describe(Route.login.name, () => {
    it('should encode continue', () => {
      expect(Route.login({ continue: '/some/path?with=query', autoLaunch: 1 })).toBe(
        '/auth/login?continue=%2Fsome%2Fpath%3Fwith%3Dquery&autoLaunch=1',
      );
    });
  });

  describe(Route.search.name, () => {
    it('should work', () => {
      expect(Route.search({})).toBe('/search');
    });

    it('should work', () => {
      expect(Route.search({ make: undefined, model: 'Immich' })).toBe('/search?query=%7B%22model%22%3A%22Immich%22%7D');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });

  describe(Route.viewSharedLink.name, () => {
    it('should work with key', () => {
      expect(Route.viewSharedLink({ key: 'uuid-key' })).toBe('/share/uuid-key');
    });

    it('should work with key and slug', () => {
      expect(Route.viewSharedLink({ key: 'uuid-key', slug: 'custom-slug' })).toBe('/s/custom-slug');
    });

    it('should URI encode slug', () => {
      expect(Route.viewSharedLink({ key: 'uuid-key', slug: 'albums/the-moon?' })).toBe('/s/albums%2Fthe-moon%3F');
    });
  });

  describe(Route.tags.name, () => {
    it('should work', () => {
      expect(Route.tags()).toBe('/tags');
    });

    it('should support query parameters', () => {
      expect(Route.tags({ path: '/some/path' })).toBe('/tags?path=%2Fsome%2Fpath');
    });

    it('should ignore an empty path', () => {
      expect(Route.tags({ path: '' })).toBe('/tags');
    });
  });

  describe(Route.systemSettings.name, () => {
    it('should work', () => {
      expect(Route.systemSettings()).toBe('/admin/system-settings');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });

  describe(Route.continue.name, () => {
    beforeEach(() => {
      // @ts-expect-error - override location for testing
      // eslint-disable-next-line unicorn/no-global-object-property-assignment
      globalThis.location = new URL('https://my.immich.server');
      vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://my.immich.server/');
    });

    it('should resolve relative URLs', () => {
      expect(Route.continue('/some/path', '/fallback')).property('href', 'https://my.immich.server/some/path');
    });

    it('should resolve absolute URLs on the same origin', () => {
      expect(Route.continue('https://my.immich.server/some/path', '/fallback')).property(
        'href',
        'https://my.immich.server/some/path',
      );
    });

    it('should return fallback for absolute URLs on a different origin', () => {
      expect(Route.continue('https://malicious.site/evil', '/fallback')).toBe('/fallback');
    });

    it('should return fallback for null URLs', () => {
      expect(Route.continue(null, '/fallback')).property('href', 'https://my.immich.server/fallback');
    });

    it('should block javascript: URLs', () => {
      expect(Route.continue('javascript:alert(1)', '/fallback')).toBe('/fallback');
    });

    it(String.raw`should block \/ URLs`, () => {
      expect(Route.continue(String.raw`\/malicious.com`, '/fallback')).toBe('/fallback');
    });
  });

  describe(Route.assistant.name, () => {
    it('should work', () => {
      expect(Route.assistant()).toBe('/assistant');
    });

    it('should select a session', () => {
      expect(Route.assistant({ sessionId: 'session-1' })).toBe('/assistant?session=session-1');
    });

    it('should join asset ids with commas', () => {
      expect(Route.assistant({ assetIds: ['a', 'b', 'c'] })).toBe('/assistant?assetIds=a%2Cb%2Cc');
    });

    it('should ignore an empty asset id list', () => {
      expect(Route.assistant({ assetIds: [] })).toBe('/assistant');
    });

    it('should encode a prefilled prompt', () => {
      expect(Route.assistant({ prompt: 'Edit book 1 & more' })).toBe('/assistant?prompt=Edit%20book%201%20%26%20more');
    });

    it('should round trip asset ids through URLSearchParams', () => {
      const url = new URL(Route.assistant({ assetIds: ['id-1', 'id-2'] }), 'https://example.com');
      expect(url.searchParams.get('assetIds')?.split(',')).toEqual(['id-1', 'id-2']);
    });
  });

  describe(Route.books.name, () => {
    it('should work', () => {
      expect(Route.books()).toBe('/books');
    });
  });

  describe(Route.viewBook.name, () => {
    it('should work', () => {
      expect(Route.viewBook({ id: 'book-1' })).toBe('/books/book-1');
    });
  });
});

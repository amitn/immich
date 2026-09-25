import {
  autoLayoutBook,
  createBookFromAlbum,
  exportBook,
  getBookExportUrl,
  getBookHtmlUrl,
  getBookPdfUrl,
} from '$lib/services/book-api';

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const jsonRequest = (method: string, body: unknown) => ({
  method,
  credentials: 'include',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('book api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe(createBookFromAlbum.name, () => {
    it('should post the album options', async () => {
      const fetchMock = respond(201, { id: 'book-1', pages: [] });
      vi.stubGlobal('fetch', fetchMock);

      const bookFromAlbumDto = {
        albumId: 'album-1',
        title: 'Italy',
        pageWidthMm: 210,
        pageHeightMm: 210,
        targetPageCount: 24,
        includeMaps: true,
        mapStyle: 'watercolor' as const,
        illustratedMaps: false,
      };
      await expect(createBookFromAlbum({ bookFromAlbumDto })).resolves.toEqual({ id: 'book-1', pages: [] });

      expect(fetchMock).toHaveBeenCalledWith('/api/books/from-album', jsonRequest('POST', bookFromAlbumDto));
    });
  });

  describe(autoLayoutBook.name, () => {
    it('should post the layout options', async () => {
      const fetchMock = respond(200, { id: 'book-1', pages: [] });
      vi.stubGlobal('fetch', fetchMock);

      const bookAutoLayoutDto = { targetPageCount: 20, includeMaps: false };
      await autoLayoutBook({ id: 'book-1', bookAutoLayoutDto });

      expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/auto-layout', jsonRequest('POST', bookAutoLayoutDto));
    });
  });

  describe(exportBook.name, () => {
    it('should send the format', async () => {
      const fetchMock = respond(204);
      vi.stubGlobal('fetch', fetchMock);

      await expect(exportBook({ id: 'book-1', bookExportDto: { format: 'html' } })).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/export', jsonRequest('POST', { format: 'html' }));
    });

    it('should send no body without a format', async () => {
      const fetchMock = respond(204);
      vi.stubGlobal('fetch', fetchMock);

      await exportBook({ id: 'book-1' });

      expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/export', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        body: undefined,
      });
    });
  });

  describe('download urls', () => {
    it('should point to the export files', () => {
      expect(getBookPdfUrl({ id: 'book-1' })).toBe('/api/books/book-1/pdf');
      expect(getBookHtmlUrl({ id: 'book-1' })).toBe('/api/books/book-1/html');
      expect(getBookExportUrl({ id: 'book-1', format: 'pdf' })).toBe('/api/books/book-1/pdf');
      expect(getBookExportUrl({ id: 'book-1', format: 'html' })).toBe('/api/books/book-1/html');
    });
  });
});

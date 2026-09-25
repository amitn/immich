import { adapterRequest, adapterUrl, ApiAdapterError } from '$lib/services/api-adapter';
import { getServerErrorMessage } from '$lib/utils/handle-error';

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

describe('api adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe(adapterUrl.name, () => {
    it('should prefix the base url and skip empty query values', () => {
      expect(adapterUrl('/books/1/pdf')).toBe('/api/books/1/pdf');
      expect(adapterUrl('/books/1/pages/2/render', { size: 1200, c: undefined, x: '' })).toBe(
        '/api/books/1/pages/2/render?size=1200',
      );
    });
  });

  describe(adapterRequest.name, () => {
    it('should send JSON with cookies', async () => {
      const fetchMock = respond(200, { id: 'session-1' });
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapterRequest('/agent/sessions', { method: 'POST', body: { title: 'Hi' } });

      expect(result).toEqual({ id: 'session-1' });
      expect(fetchMock).toHaveBeenCalledWith('/api/agent/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{"title":"Hi"}',
      });
    });

    it('should handle 204 responses', async () => {
      vi.stubGlobal('fetch', respond(204));
      await expect(adapterRequest('/agent/sessions/1/cancel', { method: 'POST' })).resolves.toBeUndefined();
    });

    it('should throw with the server message', async () => {
      vi.stubGlobal('fetch', respond(400, { message: 'Too many sessions', statusCode: 400 }));

      const error = await adapterRequest('/agent/sessions', { method: 'POST' }).catch((error: unknown) => error);

      expect(error).toBeInstanceOf(ApiAdapterError);
      expect(error).toMatchObject({ status: 400, serverMessage: 'Too many sessions' });
      expect(getServerErrorMessage(error)).toBe('Too many sessions');
    });

    it('should fall back to the status code', async () => {
      vi.stubGlobal('fetch', respond(500));

      const error = await adapterRequest('/books').catch((error: unknown) => error);

      expect(error).toMatchObject({ status: 500, message: 'HTTP 500', serverMessage: undefined });
      expect(getServerErrorMessage(error)).toBeUndefined();
    });
  });
});

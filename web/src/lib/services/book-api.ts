// TODO: replace with @immich/sdk once the open-api spec is regenerated
//
// Adapter for the /api/books endpoints. The server side is still being written; all book types
// live in $lib/types/assistant so they can be adjusted in one place.
import { adapterRequest, adapterUrl } from '$lib/services/api-adapter';
import type { BookCreateDto, BookDetailResponseDto, BookResponseDto, BookUpdateDto } from '$lib/types/assistant';

export const createBook = ({ bookCreateDto }: { bookCreateDto: BookCreateDto }) =>
  adapterRequest<BookResponseDto>('/books', { method: 'POST', body: bookCreateDto });

export const getBooks = () => adapterRequest<BookResponseDto[]>('/books');

export const getBook = ({ id }: { id: string }) => adapterRequest<BookDetailResponseDto>(`/books/${id}`);

export const updateBook = ({ id, bookUpdateDto }: { id: string; bookUpdateDto: BookUpdateDto }) =>
  adapterRequest<BookResponseDto>(`/books/${id}`, { method: 'PATCH', body: bookUpdateDto });

export const deleteBook = ({ id }: { id: string }) => adapterRequest(`/books/${id}`, { method: 'DELETE' });

/** Queues the PDF export; poll getBook until exportStatus is completed */
export const exportBook = ({ id }: { id: string }) => adapterRequest(`/books/${id}/export`, { method: 'POST' });

// URL helpers (these stay even after the SDK swap, like getAssetMediaUrl)

/** JPEG rendering of a single page; `cacheKey` only busts the browser cache and is ignored by the server */
export const getBookPageRenderUrl = ({
  id,
  pageId,
  size = 1200,
  cacheKey,
}: {
  id: string;
  pageId: string;
  size?: number;
  cacheKey?: string;
}) => adapterUrl(`/books/${id}/pages/${pageId}/render`, { size, c: cacheKey });

export const getBookPdfUrl = ({ id }: { id: string }) => adapterUrl(`/books/${id}/pdf`);

// TODO: replace with @immich/sdk once the open-api spec is regenerated
//
// Minimal fetch wrapper used by the assistant, book and art adapters until their endpoints are
// part of the generated SDK. Delete this file once all adapters call the SDK.
import { getBaseUrl } from '@immich/sdk';

type QueryValue = string | number | boolean | undefined | null;

export class ApiAdapterError extends Error {
  override name = 'ApiAdapterError';

  constructor(
    message: string,
    readonly status: number,
    readonly data?: unknown,
    /** the `message` of the server's error response, if any */
    readonly serverMessage?: string,
  ) {
    super(message);
  }
}

export const adapterUrl = (path: string, query?: Record<string, QueryValue>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return getBaseUrl() + path + (search ? `?${search}` : '');
};

export const adapterRequest = async <T = void>(
  path: string,
  { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Record<string, QueryValue> } = {},
): Promise<T> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(adapterUrl(path, query), {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = response.status === 204 ? '' : await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const serverMessage =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : undefined;
    throw new ApiAdapterError(serverMessage ?? `HTTP ${response.status}`, response.status, data, serverMessage);
  }

  return data as T;
};

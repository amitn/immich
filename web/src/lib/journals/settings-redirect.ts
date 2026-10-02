import { QueryParameter } from '$lib/constants';

/**
 * The settings accordions renamed with the journals (#24): the old key in `?isOpen=` and its new one, e.g.
 * `/admin/system-settings?isOpen=collections`, which links in the docs and the browser history still open
 */
const RENAMED_SETTINGS: Readonly<Record<string, string>> = {
  collections: 'journals',
  'collection-notifications': 'journal-notifications',
};

/**
 * Where a settings page with old accordion keys in `?isOpen=` redirects to: the same page and query with the new keys,
 * or undefined when it has none
 */
export const getRenamedSettingsRedirect = (url: URL): string | undefined => {
  const keys = url.searchParams.get(QueryParameter.IS_OPEN)?.split(' ') ?? [];
  if (keys.every((key) => !Object.hasOwn(RENAMED_SETTINGS, key))) {
    return;
  }

  const params = new URLSearchParams(url.searchParams);
  const renamed = keys.map((key) => (Object.hasOwn(RENAMED_SETTINGS, key) ? RENAMED_SETTINGS[key] : key));
  params.set(QueryParameter.IS_OPEN, [...new Set(renamed)].join(' '));
  return `${url.pathname}?${params.toString()}${url.hash}`;
};

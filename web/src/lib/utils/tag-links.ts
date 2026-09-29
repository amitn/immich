import type { TagResponseDto } from '@immich/sdk';
import { QueryParameter } from '$lib/constants';
import { Route } from '$lib/route';
import { isCollectionPhotoTag } from '$lib/utils/collections';

type Tag = Pick<TagResponseDto, 'id' | 'value'>;

/**
 * The tags of the Tags row of Explore, by name: ours (`AI Artwork/…`, `Edits/…`, the places of the collections) next to
 * noodle's classification tags (`Auto/…`). The tags of the single entries of the collections (dishes, menus) would
 * crowd the row: their place (`Food/<Restaurant>`) stands for them.
 */
export const getExploreTags = <T extends Tag>(tags: T[]) =>
  tags.filter(({ value }) => !isCollectionPhotoTag(value)).sort((a, b) => a.value.localeCompare(b.value));

/** Where a tag links to: the timeline filtered by the tag (noodle's filter state), not the deprecated /search page */
export const getTagLink = (tag: Pick<Tag, 'id'>) => Route.photos({ tagIds: [tag.id] });

/** The link of a node of the tag tree, by its path; the Tags page of the path when the tag is not known */
export const getTagPathLink = (tags: Tag[], path: string) => {
  const tag = tags.find(({ value }) => value === path);
  return tag ? getTagLink(tag) : Route.tags({ path });
};

/** The path of the tag the page shows, for the tag tree: the one tag the timeline is filtered by, or the Tags page's */
export const getActiveTagPath = (url: URL, tags: Tag[]) => {
  if (url.pathname.startsWith(Route.tags())) {
    return url.searchParams.get(QueryParameter.PATH) ?? '';
  }
  const photos = Route.photos();
  if (url.pathname === photos || url.pathname.startsWith(`${photos}/`)) {
    const tagIds = (url.searchParams.get('tags') ?? '').split(',').filter(Boolean);
    if (tagIds.length === 1) {
      return tags.find(({ id }) => id === tagIds[0])?.value ?? '';
    }
  }
  return '';
};

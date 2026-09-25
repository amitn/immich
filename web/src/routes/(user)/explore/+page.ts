import { getAllPeople, getAllTags, getExploreData, MemorySearchOrder } from '@immich/sdk';
import { memoryManager } from '$lib/managers/memory-manager.svelte';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  memoryManager.setFilters({ size: 12, order: MemorySearchOrder.Desc });
  await memoryManager.applyPreferences();

  const [explore, people, tags] = await Promise.all([
    getExploreData(),
    getAllPeople({ withHidden: false }),
    // tags are optional here, e.g. the ones the assistant adds to its artworks
    getAllTags().catch(() => []),
    memoryManager.refresh(),
  ]);
  const $t = await getFormatter();

  return {
    explore,
    people,
    tags,
    memories: memoryManager.memories,
    meta: {
      title: $t('explore'),
    },
  };
}) satisfies PageLoad;

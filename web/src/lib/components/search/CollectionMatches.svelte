<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { searchCollections, type CollectionSearchVisitDto } from '@immich/sdk';
  import { Icon, Text } from '@immich/ui';
  import { mdiTagOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    /** a question or words typed in the search bar */
    query: string;
  };

  const { query }: Props = $props();

  let visits = $state<CollectionSearchVisitDto[]>([]);
  let total = $state(0);
  let request = 0;

  const load = async (q: string) => {
    const current = ++request;
    try {
      const result = await searchCollections({ q });
      if (current === request) {
        visits = result.visits;
        total = result.total;
      }
    } catch (error) {
      if (current === request) {
        visits = [];
        handleError(error, $t('errors.unable_to_search_collections'), { notify: false });
      }
    }
  };

  $effect(() => {
    visits = [];
    void load(query);
  });

  const formatDate = (visit: CollectionSearchVisitDto) =>
    [visit.endDate ? `${visit.date} – ${visit.endDate}` : visit.date, visit.city ?? visit.country]
      .filter(Boolean)
      .join(' · ');
</script>

{#if visits.length > 0}
  <section class="flex flex-col gap-2" aria-label={$t('collection_matches')} data-testid="collection-matches">
    <Text size="small" fontWeight="semi-bold">
      {$t('collection_matches_count', { values: { count: total } })}
    </Text>
    <ul class="flex flex-col gap-3">
      {#each visits as visit (`${visit.tag}-${visit.date}`)}
        <li class="flex flex-col gap-1.5 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <a
              href={Route.tags({ path: visit.tag })}
              class="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <Icon icon={mdiTagOutline} size="14" aria-hidden />
              {visit.place}
            </a>
            <span class="text-xs text-gray-600 dark:text-gray-400">{formatDate(visit)}</span>
          </div>
          {#if visit.entries.length > 0}
            <p class="text-xs text-gray-700 dark:text-gray-300">
              {visit.entries.map(({ name }) => name).join(', ')}
            </p>
          {/if}
          <AssistantAssetStrip assetIds={visit.photoIds} size="small" limit={6} />
        </li>
      {/each}
    </ul>
  </section>
{/if}

<script lang="ts">
  import { Route } from '$lib/route';
  import { Button } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiImageAlbum } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    albumIds?: string[];
    bookIds?: string[];
  };

  const { albumIds = [], bookIds = [] }: Props = $props();
</script>

{#if albumIds.length > 0 || bookIds.length > 0}
  <div class="flex flex-wrap gap-2">
    {#each albumIds as id, index (id)}
      <Button href={Route.viewAlbum({ id })} size="small" shape="round" variant="outline" leadingIcon={mdiImageAlbum}>
        {albumIds.length > 1
          ? $t('assistant_open_album_number', { values: { index: index + 1 } })
          : $t('assistant_open_album')}
      </Button>
    {/each}
    {#each bookIds as id, index (id)}
      <Button
        href={Route.viewBook({ id })}
        size="small"
        shape="round"
        variant="outline"
        leadingIcon={mdiBookOpenPageVariantOutline}
      >
        {bookIds.length > 1
          ? $t('assistant_open_book_number', { values: { index: index + 1 } })
          : $t('assistant_open_book')}
      </Button>
    {/each}
  </div>
{/if}

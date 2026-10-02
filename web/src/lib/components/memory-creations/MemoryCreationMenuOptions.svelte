<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { getMemoryCreations } from '$lib/services/memory-creations.service';
  import { memoryLaneTitle } from '$lib/utils';
  import type { MemoryResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  type Props = {
    memory: MemoryResponseDto;
  };

  const { memory }: Props = $props();

  // named after the card, in the viewer's language
  const creations = $derived(getMemoryCreations($t, memory, $memoryLaneTitle(memory)));
</script>

{#each creations as creation (creation.id)}
  <MenuOption onClick={() => void creation.onAction()} text={creation.title} icon={creation.icon} />
{/each}

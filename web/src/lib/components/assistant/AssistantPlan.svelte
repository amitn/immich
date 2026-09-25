<script lang="ts">
  import type { AgentPlanEntryDto } from '$lib/types/assistant';
  import { Icon } from '@immich/ui';
  import { mdiCheckboxBlankOutline, mdiCheckboxMarked, mdiFormatListChecks, mdiProgressClock } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    entries: AgentPlanEntryDto[];
  };

  const { entries }: Props = $props();

  const completed = $derived(entries.filter((entry) => entry.status === 'completed').length);
</script>

<div class="rounded-xl border border-gray-200 bg-subtle px-4 py-3 text-sm dark:border-gray-700">
  <div class="mb-2 flex items-center gap-2 font-semibold">
    <Icon icon={mdiFormatListChecks} size="18" aria-hidden />
    <span>{$t('assistant_plan')}</span>
    <span class="text-xs font-normal text-gray-500 dark:text-gray-400">
      {$t('assistant_plan_progress', { values: { completed, total: entries.length } })}
    </span>
  </div>
  <ul class="flex flex-col gap-1.5">
    {#each entries as entry, index (index)}
      <li class="flex items-start gap-2">
        {#if entry.status === 'completed'}
          <Icon icon={mdiCheckboxMarked} size="18" class="mt-0.5 shrink-0 text-success" aria-hidden />
        {:else if entry.status === 'in_progress'}
          <Icon icon={mdiProgressClock} size="18" class="mt-0.5 shrink-0 text-primary" aria-hidden />
        {:else}
          <Icon icon={mdiCheckboxBlankOutline} size="18" class="mt-0.5 shrink-0 text-gray-400" aria-hidden />
        {/if}
        <span class="sr-only">
          {entry.status === 'completed'
            ? $t('assistant_tool_status_completed')
            : entry.status === 'in_progress'
              ? $t('assistant_tool_status_in_progress')
              : $t('assistant_tool_status_pending')}
        </span>
        <span class={entry.status === 'completed' ? 'text-gray-500 line-through dark:text-gray-400' : ''}>
          {entry.content}
        </span>
        {#if entry.priority === 'high'}
          <span class="ms-auto shrink-0 text-xs text-warning">{$t('assistant_plan_high_priority')}</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>

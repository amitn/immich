<script lang="ts">
  import { highlightManager } from '$lib/managers/highlight-manager.svelte';
  import { HighlightJobStatus } from '@immich/sdk';
  import { Button, Icon, ProgressBar, Text } from '@immich/ui';
  import { mdiMovieOpenOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';
</script>

{#if highlightManager.jobs.length > 0}
  <div
    class="fixed inset-e-4 bottom-4 z-50 flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2"
    role="status"
    aria-live="polite"
  >
    {#each highlightManager.jobs as job (job.id)}
      {@const percent = Math.round(job.progress * 100)}
      <!-- a rendered video stays until its thumbnail is made -->
      {@const preparing = job.status === HighlightJobStatus.Completed}
      <div
        transition:fly={{ y: 16, duration: 150 }}
        class="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-light p-4 shadow-lg dark:border-gray-700"
      >
        <div class="flex items-center gap-2">
          <Icon icon={mdiMovieOpenOutline} size="20" class="shrink-0 text-primary" aria-hidden />
          <Text size="small" fontWeight="semi-bold" class="min-w-0 flex-1 truncate">{job.title}</Text>
          {#if !preparing}
            <Button size="tiny" variant="ghost" color="secondary" onclick={() => highlightManager.cancel(job.id)}>
              {$t('cancel')}
            </Button>
          {/if}
        </div>
        <ProgressBar
          progress={job.status === HighlightJobStatus.Pending ? 0 : job.progress}
          aria-label={$t('highlight_video_rendering', { values: { title: job.title } })}
          size="tiny"
        />
        <Text size="tiny" color="muted">
          {#if job.status === HighlightJobStatus.Pending}
            {$t('highlight_video_waiting')}
          {:else if preparing}
            {$t('highlight_video_preparing')}
          {:else}
            {$t('highlight_video_progress', { values: { percent } })}
          {/if}
        </Text>
      </div>
    {/each}
  </div>
{/if}

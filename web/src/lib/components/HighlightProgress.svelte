<script lang="ts">
  import { highlightManager } from '$lib/managers/highlight-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { downloadHighlightVideo, getHighlightFileName, shareHighlightVideo } from '$lib/utils/highlight';
  import { HighlightJobStatus, type HighlightJobResponseDto } from '@immich/sdk';
  import { Button, Icon, IconButton, ProgressBar, Text, toastManager } from '@immich/ui';
  import { mdiClose, mdiDownload, mdiMovieCheckOutline, mdiMovieOpenOutline, mdiPlay, mdiShareVariant } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';

  let sharing = $state<string>();

  const onShare = async (job: HighlightJobResponseDto) => {
    if (!job.resultAssetId) {
      return;
    }
    sharing = job.id;
    try {
      const result = await shareHighlightVideo(job.resultAssetId, getHighlightFileName(job), job.title);
      if (result === 'again') {
        toastManager.primary($t('highlight_video_share_again'));
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_share_highlight_video'));
    } finally {
      sharing = undefined;
    }
  };

  const onDownload = (job: HighlightJobResponseDto) => {
    if (job.resultAssetId) {
      downloadHighlightVideo(job.resultAssetId, getHighlightFileName(job));
    }
  };
</script>

{#if highlightManager.jobs.length > 0 || highlightManager.ready.length > 0}
  <div
    class="fixed inset-e-4 bottom-4 z-50 flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2"
    role="status"
    aria-live="polite"
  >
    {#each highlightManager.ready as job (job.id)}
      <div
        transition:fly={{ y: 16, duration: 150 }}
        class="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-light p-4 shadow-lg dark:border-gray-700"
        data-testid="highlight-ready"
      >
        <div class="flex items-start gap-2">
          <Icon icon={mdiMovieCheckOutline} size="20" class="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div class="min-w-0 flex-1">
            <Text size="small" fontWeight="semi-bold">{$t('highlight_video_ready')}</Text>
            <Text size="tiny" color="muted" class="truncate">{job.title}</Text>
          </div>
          <IconButton
            icon={mdiClose}
            size="small"
            shape="round"
            variant="ghost"
            color="secondary"
            aria-label={$t('close')}
            onclick={() => highlightManager.dismiss(job.id)}
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <Button size="small" leadingIcon={mdiShareVariant} loading={sharing === job.id} onclick={() => onShare(job)}>
            {$t('share')}
          </Button>
          <Button
            size="small"
            variant="outline"
            color="secondary"
            leadingIcon={mdiDownload}
            onclick={() => onDownload(job)}
          >
            {$t('download')}
          </Button>
          <Button
            size="small"
            variant="ghost"
            color="secondary"
            leadingIcon={mdiPlay}
            onclick={() => highlightManager.open(job)}
          >
            {$t('open')}
          </Button>
        </div>
      </div>
    {/each}
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

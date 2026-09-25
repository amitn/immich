<script lang="ts">
  import { goto } from '$app/navigation';
  import { artJobManager } from '$lib/managers/art-job-manager.svelte';
  import { Route } from '$lib/route';
  import { websocketEvents } from '$lib/stores/websocket';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    ArtJobStatus,
    AssetMediaSize,
    createArtJob,
    getArtJob,
    getArtStyles,
    type ArtJobResponseDto,
    type ArtStyleDto,
    type AssetResponseDto,
  } from '@immich/sdk';
  import {
    Alert,
    Button,
    Field,
    HStack,
    Icon,
    Input,
    LoadingSpinner,
    Modal,
    ModalBody,
    ModalFooter,
    Text,
    Textarea,
  } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiCheckCircle, mdiOpenInNew, mdiPaletteOutline, mdiRefresh } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    onClose: () => void;
  };

  const { asset, onClose }: Props = $props();

  const POLL_INTERVAL = 5000;
  const MAX_IMAGE_RETRIES = 15;
  const CUSTOM = '';

  let styles = $state<ArtStyleDto[]>([]);
  let isLoadingStyles = $state(true);
  let selectedStyle = $state<string>();
  let caption = $state('');
  let prompt = $state('');
  let isSubmitting = $state(false);
  let job = $state<ArtJobResponseDto>();
  let elapsed = $state(0);
  let imageAttempt = $state(0);

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  const style = $derived(styles.find(({ id }) => id === selectedStyle));
  const isCustom = $derived(selectedStyle === CUSTOM);
  const phase = $derived.by(() => {
    if (!job) {
      return 'select';
    }
    if (job.status === ArtJobStatus.Completed && job.resultAssetId) {
      return 'done';
    }
    if (job.status === ArtJobStatus.Failed || job.status === ArtJobStatus.Completed) {
      return 'failed';
    }
    return 'running';
  });
  const canGenerate = $derived(!isSubmitting && selectedStyle !== undefined && (!isCustom || prompt.trim().length > 0));

  // this dialog shows the result; once it is closed, the app-wide toast does
  const jobId = $derived(job?.id);
  $effect(() => {
    if (jobId) {
      return artJobManager.watch(jobId);
    }
  });

  const stopTimers = () => {
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    pollTimer = undefined;
    clockTimer = undefined;
  };

  const setJob = (next: ArtJobResponseDto) => {
    job = next;
    if (next.status === ArtJobStatus.Completed || next.status === ArtJobStatus.Failed) {
      stopTimers();
    }
  };

  const poll = async () => {
    if (!job) {
      return;
    }
    try {
      setJob(await getArtJob({ id: job.id }));
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_art_job'), { notify: false });
    }
  };

  const startTimers = () => {
    stopTimers();
    const startedAt = Date.now();
    elapsed = 0;
    clockTimer = setInterval(() => (elapsed = Math.floor((Date.now() - startedAt) / 1000)), 1000);
    // polling is a fallback for missed websocket events
    pollTimer = setInterval(() => void poll(), POLL_INTERVAL);
  };

  const generate = async () => {
    if (!canGenerate) {
      return;
    }

    isSubmitting = true;
    try {
      const created = await createArtJob({
        artJobCreateDto: {
          assetId: asset.id,
          style: isCustom ? undefined : selectedStyle,
          prompt: prompt.trim() || undefined,
          caption: style?.usesCaption && caption.trim() ? caption.trim() : undefined,
        },
      });
      imageAttempt = 0;
      setJob(created);
      if (phase === 'running') {
        startTimers();
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_create_art_job'));
    } finally {
      isSubmitting = false;
    }
  };

  const tryAgain = () => {
    stopTimers();
    job = undefined;
  };

  const openResult = async () => {
    if (!job?.resultAssetId) {
      return;
    }
    const id = job.resultAssetId;
    onClose();
    await goto(Route.viewAsset({ id }));
  };

  const onResultError = () => {
    // the thumbnail of the new asset is generated asynchronously; retry for a while
    if (imageAttempt < MAX_IMAGE_RETRIES) {
      setTimeout(() => imageAttempt++, 2000);
    }
  };

  const formatElapsed = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  };

  onMount(() => {
    getArtStyles()
      .then((result) => {
        styles = result;
        selectedStyle = result[0]?.id ?? CUSTOM;
      })
      .catch((error: unknown) => {
        handleError(error, $t('errors.unable_to_load_art_styles'));
        selectedStyle = CUSTOM;
      })
      .finally(() => (isLoadingStyles = false));

    return websocketEvents.on('on_art_job_update', (update) => {
      if (job && update.id === job.id) {
        setJob(update);
      }
    });
  });

  onDestroy(() => stopTimers());
</script>

<Modal title={$t('artistic_style')} icon={mdiPaletteOutline} {onClose} size="large">
  <ModalBody>
    {#if phase === 'select'}
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <img
            src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail })}
            alt={$t('art_source_photo')}
            class="size-16 shrink-0 rounded-lg object-cover"
            draggable="false"
          />
          <Text size="small" color="muted">{$t('art_description')}</Text>
        </div>

        {#if isLoadingStyles}
          <div class="flex justify-center py-6"><LoadingSpinner size="large" /></div>
        {:else}
          <fieldset>
            <legend class="mb-2 text-sm font-medium">{$t('art_choose_style')}</legend>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {#each [...styles, { id: CUSTOM, name: $t('art_custom_style'), description: $t('art_custom_style_description'), usesCaption: false }] as option (option.id)}
                {@const checked = selectedStyle === option.id}
                <label
                  class="flex cursor-pointer flex-col gap-1 rounded-xl border-2 p-3 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
                >
                  <input type="radio" name="art-style" class="sr-only" value={option.id} bind:group={selectedStyle} />
                  <span class="flex items-center gap-2 text-sm font-medium">
                    {option.name}
                    {#if checked}
                      <Icon icon={mdiCheckCircle} size="16" class="ms-auto text-primary" aria-hidden />
                    {/if}
                  </span>
                  <span class="text-xs text-gray-600 dark:text-gray-400">{option.description}</span>
                </label>
              {/each}
            </div>
          </fieldset>

          {#if style?.usesCaption}
            <Field label={$t('art_caption')} description={$t('art_caption_description')}>
              <Input bind:value={caption} maxlength={80} placeholder={$t('art_caption_placeholder')} />
            </Field>
          {/if}

          <Field
            label={isCustom ? $t('art_prompt') : $t('art_prompt_optional')}
            description={$t('art_prompt_description')}
            required={isCustom}
          >
            <Textarea bind:value={prompt} rows={3} grow placeholder={$t('art_prompt_placeholder')} />
          </Field>

          <Text size="tiny" color="muted">{$t('art_privacy_note')}</Text>
        {/if}
      </div>
    {:else if phase === 'running'}
      <div class="flex flex-col items-center gap-4 py-8 text-center" role="status">
        <LoadingSpinner size="giant" />
        <div class="flex flex-col gap-1">
          <p class="font-medium">
            {job?.status === ArtJobStatus.Pending ? $t('art_status_pending') : $t('art_status_running')}
          </p>
          <p class="text-sm text-gray-600 tabular-nums dark:text-gray-400">
            {$t('art_elapsed', { values: { time: formatElapsed(elapsed) } })}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">{$t('art_duration_hint')}</p>
        </div>
      </div>
    {:else if phase === 'done' && job?.resultAssetId}
      <div class="flex flex-col items-center gap-3">
        {#key imageAttempt}
          <img
            src={getAssetMediaUrl({
              id: job.resultAssetId,
              size: AssetMediaSize.Preview,
              cacheKey: imageAttempt ? String(imageAttempt) : undefined,
            })}
            alt={$t('art_result')}
            class="max-h-[55vh] w-auto rounded-lg bg-gray-100 object-contain shadow-sm dark:bg-gray-800"
            onerror={onResultError}
          />
        {/key}
        <Text size="small" color="muted">{$t('art_done_description')}</Text>
      </div>
    {:else}
      <Alert color="danger" icon={mdiAlertCircleOutline} title={$t('art_failed')}>
        <p class="text-sm wrap-break-word">{job?.error || $t('art_failed_no_output')}</p>
      </Alert>
    {/if}
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth>
      {#if phase === 'select'}
        <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('cancel')}</Button>
        <Button shape="round" fullWidth loading={isSubmitting} disabled={!canGenerate} onclick={generate}>
          {$t('art_generate')}
        </Button>
      {:else if phase === 'running'}
        <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('art_close_and_continue')}</Button>
      {:else if phase === 'done'}
        <Button shape="round" color="secondary" fullWidth leadingIcon={mdiRefresh} onclick={tryAgain}>
          {$t('art_try_again')}
        </Button>
        <Button shape="round" fullWidth leadingIcon={mdiOpenInNew} onclick={openResult}>{$t('open')}</Button>
      {:else}
        <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('close')}</Button>
        <Button shape="round" fullWidth leadingIcon={mdiRefresh} onclick={tryAgain}>{$t('art_try_again')}</Button>
      {/if}
    </HStack>
  </ModalFooter>
</Modal>

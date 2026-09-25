<script lang="ts">
  import { goto } from '$app/navigation';
  import { Route } from '$lib/route';
  import {
    analyzeEnhancement,
    EnhanceApiError,
    enhanceAsset,
    getEnhancePreviewUrl,
    type EnhanceAnalysisResponseDto,
    type EnhanceResponseDto,
    type EnhanceStrength,
  } from '$lib/services/enhance-api';
  import { handleError } from '$lib/utils/handle-error';
  import type { AssetResponseDto } from '@immich/sdk';
  import { Alert, Button, HStack, Icon, LoadingSpinner, Modal, ModalBody, ModalFooter, Text } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiAutoFix, mdiCheck, mdiContentSave, mdiOpenInNew } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    onClose: () => void;
  };

  const { asset, onClose }: Props = $props();

  const strengths: EnhanceStrength[] = ['subtle', 'normal', 'strong'];

  let strength = $state<EnhanceStrength>('normal');
  let analysis = $state<EnhanceAnalysisResponseDto>();
  let isAnalyzing = $state(true);
  let isImageLoading = $state(true);
  let errorMessage = $state<string>();
  let isSaving = $state(false);
  let result = $state<EnhanceResponseDto>();
  let request = 0;

  const previewUrl = $derived(getEnhancePreviewUrl(asset.id, strength));
  const canSave = $derived(!isAnalyzing && !isSaving && !!analysis?.needed);

  const strengthLabel = (value: EnhanceStrength) =>
    ({
      subtle: $t('auto_enhance_strength_subtle'),
      normal: $t('auto_enhance_strength_normal'),
      strong: $t('auto_enhance_strength_strong'),
    })[value];

  const getMessage = (error: unknown, fallback: string) =>
    error instanceof EnhanceApiError && error.serverMessage ? error.serverMessage : fallback;

  const analyze = async (value: EnhanceStrength) => {
    const current = ++request;
    isAnalyzing = true;
    errorMessage = undefined;
    try {
      const next = await analyzeEnhancement(asset.id, { strength: value });
      if (current === request) {
        analysis = next;
      }
    } catch (error) {
      if (current === request) {
        analysis = undefined;
        errorMessage = getMessage(error, $t('errors.unable_to_load_enhance_preview'));
        handleError(error, $t('errors.unable_to_load_enhance_preview'), { notify: false });
      }
    } finally {
      if (current === request) {
        isAnalyzing = false;
      }
    }
  };

  const selectStrength = (value: EnhanceStrength) => {
    if (value === strength || isSaving) {
      return;
    }
    strength = value;
    isImageLoading = true;
    void analyze(value);
  };

  const save = async () => {
    if (!canSave) {
      return;
    }

    isSaving = true;
    try {
      result = await enhanceAsset(asset.id, { strength });
    } catch (error) {
      errorMessage = getMessage(error, $t('errors.unable_to_enhance_photo'));
      handleError(error, $t('errors.unable_to_enhance_photo'), { notify: false });
    } finally {
      isSaving = false;
    }
  };

  const openResult = async () => {
    if (!result) {
      return;
    }
    const { id } = result;
    onClose();
    await goto(Route.viewAsset({ id }));
  };

  onMount(() => void analyze(strength));
</script>

<Modal title={$t('auto_enhance')} icon={mdiAutoFix} {onClose} size="large">
  <ModalBody>
    {#if result}
      <div class="flex flex-col items-center gap-3 py-2 text-center">
        <img
          src={previewUrl}
          alt={$t('auto_enhance_preview')}
          class="max-h-[50vh] w-auto rounded-lg bg-gray-100 object-contain dark:bg-gray-800"
          draggable="false"
        />
        <Text size="small" color="muted">{$t('auto_enhance_done')}</Text>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <Text size="small" color="muted">{$t('auto_enhance_description')}</Text>

        <fieldset class="flex flex-wrap items-center gap-2" disabled={isSaving}>
          <legend class="sr-only">{$t('auto_enhance_strength')}</legend>
          <span class="me-1 text-sm font-medium" aria-hidden="true">{$t('auto_enhance_strength')}</span>
          {#each strengths as value (value)}
            {@const checked = strength === value}
            <label
              class="cursor-pointer rounded-full border-2 px-4 py-1 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
            >
              <input
                type="radio"
                name="enhance-strength"
                class="sr-only"
                {value}
                {checked}
                onchange={() => selectStrength(value)}
              />
              {strengthLabel(value)}
            </label>
          {/each}
        </fieldset>

        <div
          class="relative flex min-h-48 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
        >
          {#if errorMessage && !analysis}
            <Alert color="danger" icon={mdiAlertCircleOutline} title={errorMessage} />
          {:else}
            <img
              src={previewUrl}
              alt={$t('auto_enhance_preview')}
              class="max-h-[50vh] w-full object-contain transition-opacity {isImageLoading ? 'opacity-40' : ''}"
              draggable="false"
              onload={() => (isImageLoading = false)}
              onerror={() => (isImageLoading = false)}
            />
            {#if isImageLoading}
              <div class="absolute inset-0 flex items-center justify-center" role="status">
                <LoadingSpinner size="large" />
              </div>
            {/if}
          {/if}
        </div>

        {#if analysis && !isAnalyzing}
          {#if analysis.needed}
            <ul class="flex flex-col gap-1 text-sm">
              {#each analysis.corrections as correction (correction.type)}
                <li class="flex items-start gap-2">
                  <Icon icon={mdiCheck} size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden />
                  <span>
                    {correction.description}
                    <span class="text-xs text-gray-600 dark:text-gray-400">— {correction.reason}</span>
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <Text size="small">{$t('auto_enhance_nothing_to_do')}</Text>
          {/if}
        {/if}

        {#if errorMessage && analysis}
          <Alert color="danger" icon={mdiAlertCircleOutline} title={errorMessage} />
        {/if}
      </div>
    {/if}
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth>
      {#if result}
        <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('close')}</Button>
        <Button shape="round" fullWidth leadingIcon={mdiOpenInNew} onclick={openResult}>{$t('open')}</Button>
      {:else}
        <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('cancel')}</Button>
        <Button
          shape="round"
          fullWidth
          leadingIcon={mdiContentSave}
          loading={isSaving}
          disabled={!canSave}
          onclick={save}
        >
          {$t('auto_enhance_save')}
        </Button>
      {/if}
    </HStack>
  </ModalFooter>
</Modal>

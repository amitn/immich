<script lang="ts">
  import { goto } from '$app/navigation';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getServerErrorMessage, handleError } from '$lib/utils/handle-error';
  import {
    type DraftRegion,
    getRegionLabel,
    normalizeDrawnRect,
    toRedactionRects,
    toggleRegion,
  } from '$lib/utils/redaction';
  import {
    AssetMediaSize,
    redactAsset,
    RedactionKind,
    RedactionReason,
    RedactionStyle,
    renderRedactionPreview,
    suggestRedactions,
    type AssetResponseDto,
    type RedactionResponseDto,
  } from '@immich/sdk';
  import { Alert, Button, HStack, IconButton, LoadingSpinner, Modal, ModalBody, ModalFooter, Text } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiBlur,
    mdiClose,
    mdiContentSave,
    mdiEyeOutline,
    mdiOpenInNew,
    mdiPencilOutline,
    mdiSelectionDrag,
  } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    onClose: () => void;
  };

  const { asset, onClose }: Props = $props();

  const styles = [RedactionStyle.Blur, RedactionStyle.Pixelate];

  let regions = $state<DraftRegion[]>([]);
  let style = $state<RedactionStyle>(RedactionStyle.Blur);
  let isLoading = $state(true);
  let isDrawing = $state(false);
  let drawStart = $state<{ x: number; y: number }>();
  let drawCurrent = $state<{ x: number; y: number }>();
  let previewUrl = $state<string>();
  let isPreviewLoading = $state(false);
  let isSaving = $state(false);
  let errorMessage = $state<string>();
  let result = $state<RedactionResponseDto>();
  let container = $state<HTMLDivElement>();
  let manualCount = 0;

  // the regions are of the photo as it is shown: its edited preview
  const imageUrl = $derived(
    getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Preview, cacheKey: asset.thumbhash, edited: true }),
  );
  const selectedCount = $derived(regions.filter(({ selected }) => selected).length);
  const canSave = $derived(!isLoading && !isSaving && selectedCount > 0);
  const drawnBox = $derived(drawStart && drawCurrent ? normalizeDrawnRect(drawStart, drawCurrent) : undefined);

  const getMessage = (error: unknown, fallback: string) => getServerErrorMessage(error) || fallback;

  const load = async () => {
    isLoading = true;
    try {
      const suggestion = await suggestRedactions({ id: asset.id, redactionSuggestDto: {} });
      regions = suggestion.regions.map((region) => ({ ...region }));
    } catch (error) {
      errorMessage = getMessage(error, $t('errors.unable_to_load_redactions'));
      handleError(error, $t('errors.unable_to_load_redactions'), { notify: false });
    } finally {
      isLoading = false;
    }
  };

  const clearPreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    previewUrl = undefined;
  };

  const toggle = (id: string) => {
    regions = toggleRegion(regions, id);
  };

  const remove = (id: string) => {
    regions = regions.filter((region) => region.id !== id);
  };

  const getPoint = (event: PointerEvent) => {
    const rect = container!.getBoundingClientRect();
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isDrawing || !container) {
      return;
    }
    event.preventDefault();
    container.setPointerCapture?.(event.pointerId);
    drawStart = getPoint(event);
    drawCurrent = drawStart;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (drawStart && container) {
      drawCurrent = getPoint(event);
    }
  };

  const onPointerUp = () => {
    const box = drawnBox;
    drawStart = undefined;
    drawCurrent = undefined;
    if (!box) {
      return;
    }
    manualCount++;
    regions = [
      ...regions,
      {
        id: `manual:${manualCount}`,
        kind: RedactionKind.Manual,
        reason: RedactionReason.Manual,
        selected: true,
        ...box,
      },
    ];
  };

  const togglePreview = async () => {
    if (previewUrl) {
      clearPreview();
      return;
    }
    if (selectedCount === 0) {
      return;
    }
    isPreviewLoading = true;
    errorMessage = undefined;
    try {
      const blob = await renderRedactionPreview({
        id: asset.id,
        redactionPreviewDto: { regions: toRedactionRects(regions), style },
      });
      previewUrl = URL.createObjectURL(blob);
    } catch (error) {
      errorMessage = getMessage(error, $t('errors.unable_to_load_redaction_preview'));
      handleError(error, $t('errors.unable_to_load_redaction_preview'), { notify: false });
    } finally {
      isPreviewLoading = false;
    }
  };

  const selectStyle = (value: RedactionStyle) => {
    style = value;
    clearPreview();
  };

  const save = async () => {
    if (!canSave) {
      return;
    }
    isSaving = true;
    errorMessage = undefined;
    try {
      result = await redactAsset({ id: asset.id, redactionCreateDto: { regions: toRedactionRects(regions), style } });
    } catch (error) {
      errorMessage = getMessage(error, $t('errors.unable_to_redact_photo'));
      handleError(error, $t('errors.unable_to_redact_photo'), { notify: false });
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

  const styleLabel = (value: RedactionStyle) =>
    value === RedactionStyle.Pixelate ? $t('redact_style_pixelate') : $t('redact_style_blur');

  onMount(() => void load());
  onDestroy(clearPreview);
</script>

<Modal title={$t('redact_title')} icon={mdiBlur} {onClose} size="large">
  <ModalBody>
    {#if result}
      <div class="flex flex-col items-center gap-3 py-2 text-center">
        <Text size="small" color="muted">{$t('redact_done')}</Text>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <Text size="small" color="muted">{$t('redact_description')}</Text>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <fieldset class="flex flex-wrap items-center gap-2" disabled={isSaving}>
            <legend class="sr-only">{$t('redact_style')}</legend>
            <span class="me-1 text-sm font-medium" aria-hidden="true">{$t('redact_style')}</span>
            {#each styles as value (value)}
              {@const checked = style === value}
              <label
                class="cursor-pointer rounded-full border-2 px-4 py-1 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
              >
                <input
                  type="radio"
                  name="redact-style"
                  class="sr-only"
                  {value}
                  {checked}
                  onchange={() => selectStyle(value)}
                />
                {styleLabel(value)}
              </label>
            {/each}
          </fieldset>

          <HStack gap={2}>
            <Button
              size="small"
              shape="round"
              color={isDrawing ? 'primary' : 'secondary'}
              variant={isDrawing ? 'filled' : 'outline'}
              leadingIcon={mdiSelectionDrag}
              disabled={!!previewUrl || isLoading}
              aria-pressed={isDrawing}
              onclick={() => (isDrawing = !isDrawing)}
            >
              {$t('redact_draw')}
            </Button>
            <Button
              size="small"
              shape="round"
              color="secondary"
              variant="outline"
              leadingIcon={previewUrl ? mdiPencilOutline : mdiEyeOutline}
              loading={isPreviewLoading}
              disabled={selectedCount === 0 || isLoading}
              onclick={togglePreview}
            >
              {previewUrl ? $t('redact_edit') : $t('redact_preview')}
            </Button>
          </HStack>
        </div>

        <div class="flex min-h-48 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
          {#if previewUrl}
            <img
              src={previewUrl}
              alt={$t('redact_preview')}
              class="max-h-[55vh] w-auto object-contain"
              draggable="false"
            />
          {:else}
            <div
              bind:this={container}
              class="relative inline-block touch-none select-none {isDrawing ? 'cursor-crosshair' : ''}"
              data-testid="redact-canvas"
              role="presentation"
              onpointerdown={onPointerDown}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
              onpointercancel={onPointerUp}
            >
              <!-- the boxes are fractions of the image, which sizes the canvas -->
              <img
                src={imageUrl}
                alt={asset.originalFileName}
                class="block max-h-[55vh] max-w-full"
                draggable="false"
              />
              {#each regions as region (region.id)}
                <button
                  type="button"
                  class="absolute rounded-sm border-2 transition-colors {region.selected
                    ? 'border-primary bg-primary/10 backdrop-blur-md'
                    : 'border-dashed border-white/80 bg-black/10 hover:bg-black/20'} {isDrawing
                    ? 'pointer-events-none'
                    : ''}"
                  style:left="{region.x * 100}%"
                  style:top="{region.y * 100}%"
                  style:width="{region.width * 100}%"
                  style:height="{region.height * 100}%"
                  aria-pressed={region.selected}
                  aria-label={getRegionLabel($t, region)}
                  title={getRegionLabel($t, region)}
                  onclick={() => toggle(region.id)}
                ></button>
              {/each}
              {#if drawnBox}
                <div
                  class="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/20"
                  style:left="{drawnBox.x * 100}%"
                  style:top="{drawnBox.y * 100}%"
                  style:width="{drawnBox.width * 100}%"
                  style:height="{drawnBox.height * 100}%"
                ></div>
              {/if}
              {#if isLoading}
                <div class="absolute inset-0 flex items-center justify-center" role="status">
                  <LoadingSpinner size="large" />
                </div>
              {/if}
            </div>
          {/if}
        </div>

        {#if !isLoading && regions.length === 0 && !errorMessage}
          <Text size="small">{$t('redact_no_suggestions')}</Text>
        {/if}

        {#if regions.length > 0}
          <ul class="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm" aria-label={$t('redact_areas')}>
            {#each regions as region (region.id)}
              <li class="flex items-center gap-2">
                <label class="flex grow cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={region.selected}
                    disabled={isSaving}
                    onchange={() => toggle(region.id)}
                  />
                  <span>{getRegionLabel($t, region)}</span>
                </label>
                {#if region.kind === RedactionKind.Manual}
                  <IconButton
                    icon={mdiClose}
                    size="small"
                    shape="round"
                    color="secondary"
                    variant="ghost"
                    aria-label={$t('redact_remove_area')}
                    onclick={() => remove(region.id)}
                  />
                {/if}
              </li>
            {/each}
          </ul>
          <Text size="small" color="muted">{$t('redact_selected_count', { values: { count: selectedCount } })}</Text>
        {/if}

        {#if errorMessage}
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
          {$t('redact_save')}
        </Button>
      {/if}
    </HStack>
  </ModalFooter>
</Modal>

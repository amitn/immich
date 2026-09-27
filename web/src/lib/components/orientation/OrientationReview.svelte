<script lang="ts">
  import OrientationScanModal from '$lib/modals/OrientationScanModal.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    fixOrientation,
    getOrientationSuggestions,
    OrientationStatus,
    rejectOrientation,
    undoOrientation,
    type BulkIdResponseDto,
    type OrientationSuggestionResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, modalManager, Text, toastManager } from '@immich/ui';
  import { mdiCheck, mdiClose, mdiRefresh, mdiRotateRight, mdiUndo } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    suggestions: OrientationSuggestionResponseDto[];
    fixed: OrientationSuggestionResponseDto[];
  };

  const props: Props = $props();

  // svelte-ignore state_referenced_locally
  let suggestions = $state(props.suggestions);
  // svelte-ignore state_referenced_locally
  let fixed = $state(props.fixed);
  let tab = $state<OrientationStatus.Suggested | OrientationStatus.Fixed>(OrientationStatus.Suggested);
  let busy = $state(new Set<string>());
  let fixingAll = $state(false);

  const shown = $derived(tab === OrientationStatus.Suggested ? suggestions : fixed);

  const turnLabel = (rotate: number) =>
    rotate === 90
      ? $t('orientation_turn_right')
      : rotate === 180
        ? $t('orientation_turn_upside_down')
        : $t('orientation_turn_left');

  const refresh = async () => {
    try {
      [suggestions, fixed] = await Promise.all([
        getOrientationSuggestions({ status: OrientationStatus.Suggested }),
        getOrientationSuggestions({ status: OrientationStatus.Fixed }),
      ]);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_orientation'));
    }
  };

  /** runs a review of some photos and moves the ones it succeeded for */
  const review = async (
    assetIds: string[],
    request: (assetIds: string[]) => Promise<BulkIdResponseDto[]>,
    move?: (items: OrientationSuggestionResponseDto[]) => void,
  ) => {
    busy = new Set([...busy, ...assetIds]);
    try {
      const results = await request(assetIds);
      const done = new Set(results.filter(({ success }) => success).map(({ id }) => id));
      const failed = results.filter(({ success }) => !success);
      const moved = [...suggestions, ...fixed].filter(({ assetId }) => done.has(assetId));
      suggestions = suggestions.filter(({ assetId }) => !done.has(assetId));
      fixed = fixed.filter(({ assetId }) => !done.has(assetId));
      move?.(moved);
      if (failed.length > 0) {
        toastManager.danger(failed[0].errorMessage ?? $t('errors.unable_to_fix_orientation'));
      }
      return done.size;
    } catch (error) {
      handleError(error, $t('errors.unable_to_fix_orientation'));
      return 0;
    } finally {
      busy = new Set([...busy].filter((id) => !assetIds.includes(id)));
    }
  };

  const toFixed = (items: OrientationSuggestionResponseDto[]) =>
    (fixed = [...items.map((item) => ({ ...item, status: OrientationStatus.Fixed })), ...fixed]);
  const toSuggested = (items: OrientationSuggestionResponseDto[]) =>
    (suggestions = [...items.map((item) => ({ ...item, status: OrientationStatus.Suggested })), ...suggestions]);

  const accept = (assetId: string) =>
    review([assetId], (assetIds) => fixOrientation({ orientationFixDto: { assetIds } }), toFixed);

  const reject = (assetId: string) =>
    review([assetId], (assetIds) => rejectOrientation({ orientationAssetsDto: { assetIds } }));

  const undo = (assetId: string) =>
    review([assetId], (assetIds) => undoOrientation({ orientationAssetsDto: { assetIds } }), toSuggested);

  const fixAll = async () => {
    fixingAll = true;
    const count = await review(
      suggestions.map(({ assetId }) => assetId),
      (assetIds) => fixOrientation({ orientationFixDto: { assetIds } }),
      toFixed,
    );
    fixingAll = false;
    if (count > 0) {
      toastManager.success($t('orientation_fixed_count', { values: { count } }));
    }
  };

  const check = async () => {
    const started = await modalManager.show(OrientationScanModal, {});
    if (started) {
      await refresh();
    }
  };
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-3">
    <Text size="small" color="muted" class="min-w-0 flex-1">{$t('orientation_description')}</Text>
    <Button size="small" variant="outline" leadingIcon={mdiRotateRight} onclick={check}>
      {$t('orientation_check_photos')}
    </Button>
    <IconButton
      size="small"
      variant="ghost"
      shape="round"
      color="secondary"
      icon={mdiRefresh}
      aria-label={$t('refresh')}
      onclick={refresh}
    />
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <div class="flex gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-800" role="tablist">
      {#each [OrientationStatus.Suggested, OrientationStatus.Fixed] as value (value)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === value}
          class="rounded-full px-4 py-1 text-sm {tab === value
            ? 'bg-white font-medium shadow-sm dark:bg-gray-700'
            : 'text-gray-600 dark:text-gray-300'}"
          onclick={() => (tab = value as typeof tab)}
        >
          {value === OrientationStatus.Suggested
            ? $t('orientation_to_review', { values: { count: suggestions.length } })
            : $t('orientation_fixed', { values: { count: fixed.length } })}
        </button>
      {/each}
    </div>
    <div class="flex-1"></div>
    {#if tab === OrientationStatus.Suggested && suggestions.length > 0}
      <Button size="small" leadingIcon={mdiCheck} loading={fixingAll} disabled={fixingAll} onclick={fixAll}>
        {$t('orientation_fix_all')}
      </Button>
    {/if}
  </div>

  {#if shown.length === 0}
    <p class="py-16 text-center text-gray-600 dark:text-gray-300">
      {tab === OrientationStatus.Suggested ? $t('orientation_none') : $t('orientation_none_fixed')}
    </p>
  {:else}
    <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {#each shown as item (item.assetId)}
        {@const pending = busy.has(item.assetId)}
        <li
          class="flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
          data-testid="orientation-card"
        >
          <div
            class="relative flex aspect-square items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-800"
          >
            <img
              src={getAssetMediaUrl({ id: item.assetId, size: AssetMediaSize.Thumbnail })}
              alt={turnLabel(item.rotate)}
              class="max-h-[80%] max-w-[80%] object-contain transition-transform"
              style:transform={tab === OrientationStatus.Suggested ? `rotate(${item.rotate}deg)` : undefined}
              draggable="false"
            />
            <span
              class="absolute inset-s-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
              title={item.reasons.join('\n')}
            >
              {turnLabel(item.rotate)} · {Math.round(item.confidence * 100)}%
            </span>
          </div>
          <div class="flex items-center justify-end gap-1 p-2">
            {#if tab === OrientationStatus.Suggested}
              <IconButton
                size="small"
                shape="round"
                color="secondary"
                variant="ghost"
                icon={mdiClose}
                aria-label={$t('orientation_keep')}
                title={$t('orientation_keep')}
                disabled={pending}
                onclick={() => reject(item.assetId)}
              />
              <IconButton
                size="small"
                shape="round"
                icon={mdiCheck}
                aria-label={$t('orientation_fix')}
                title={$t('orientation_fix')}
                disabled={pending}
                onclick={() => accept(item.assetId)}
              />
            {:else}
              <Button
                size="small"
                variant="ghost"
                color="secondary"
                leadingIcon={mdiUndo}
                disabled={pending}
                onclick={() => undo(item.assetId)}
              >
                {$t('undo')}
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

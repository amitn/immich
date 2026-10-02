<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    AssetOrder,
    AssetTypeEnum,
    searchAssets,
    searchSmart,
    type AssetResponseDto,
  } from '@immich/sdk';
  import { Button, Field, Icon, Input, LoadingSpinner, Modal, ModalBody, Switch, Text } from '@immich/ui';
  import { mdiCheckCircle, mdiImageMultipleOutline, mdiMagnify } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';

  type Props = {
    title: string;
    /** the album the book is made from; its photos are shown first */
    albumId: string | null;
    /** photos already in the book, which are marked */
    usedAssetIds?: string[];
    /** the photo in the slot, which cannot be chosen again */
    currentAssetId?: string | null;
    onClose: (assetId?: string) => void;
  };

  const { title, albumId, usedAssetIds = [], currentAssetId, onClose }: Props = $props();

  const PAGE_SIZE = 60;

  const used = $derived(new Set(usedAssetIds));
  const canSearch = $derived(featureFlagsManager.value.smartSearch);

  let query = $state('');
  // svelte-ignore state_referenced_locally
  let albumOnly = $state(!!albumId);
  let assets = $state<AssetResponseDto[]>([]);
  let nextPage = $state<string | null>(null);
  let isLoading = $state(false);
  let searched = $state('');
  let request = 0;
  const failed = new SvelteSet<string>();

  const load = async (page?: string) => {
    const current = ++request;
    isLoading = true;
    const text = canSearch ? query.trim() : '';
    const albumIds = albumOnly && albumId ? [albumId] : undefined;
    try {
      const { assets: result } = text
        ? await searchSmart({
            smartSearchDto: {
              query: text,
              albumIds,
              type: AssetTypeEnum.Image,
              size: PAGE_SIZE,
              page: Number(page ?? 1),
            },
          })
        : await searchAssets({
            metadataSearchDto: {
              albumIds,
              type: AssetTypeEnum.Image,
              size: PAGE_SIZE,
              page: Number(page ?? 1),
              // the album in book order, other photos newest first
              order: albumIds ? AssetOrder.Asc : AssetOrder.Desc,
            },
          });
      if (current !== request) {
        return;
      }
      assets = page ? [...assets, ...result.items] : result.items;
      nextPage = result.nextPage;
      searched = text;
    } catch (error) {
      if (current === request) {
        handleError(error, $t('errors.unable_to_load_book_photos'));
      }
    } finally {
      if (current === request) {
        isLoading = false;
      }
    }
  };

  const onSearch = (event: SubmitEvent) => {
    event.preventDefault();
    void load();
  };

  const onScopeChange = (checked: boolean) => {
    albumOnly = checked;
    void load();
  };

  const assetLabel = (asset: AssetResponseDto) => {
    const name = asset.originalFileName;
    if (asset.id === currentAssetId) {
      return $t('book_photo_in_slot', { values: { name } });
    }
    return used.has(asset.id) ? $t('book_photo_in_book', { values: { name } }) : name;
  };

  onMount(() => void load());
</script>

<Modal {title} icon={mdiImageMultipleOutline} size="large" onClose={() => onClose()}>
  <ModalBody>
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        {#if canSearch}
          <form class="flex flex-1 items-end gap-2" onsubmit={onSearch} role="search">
            <Field label={$t('search')} class="flex-1">
              <Input bind:value={query} placeholder={$t('book_photo_search_placeholder')} leadingIcon={mdiMagnify} />
            </Field>
            <Button type="submit" color="secondary" disabled={isLoading}>{$t('search')}</Button>
          </form>
        {/if}
        {#if albumId}
          <Field label={$t('book_photo_album_only')}>
            <Switch bind:checked={albumOnly} onCheckedChange={onScopeChange} />
          </Field>
        {/if}
      </div>

      {#if isLoading && assets.length === 0}
        <div class="flex justify-center py-10"><LoadingSpinner /></div>
      {:else if assets.length === 0}
        <Text class="py-10 text-center" color="muted">
          {searched ? $t('book_photo_no_results', { values: { query: searched } }) : $t('book_photo_none')}
        </Text>
      {:else}
        <ul class="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6" aria-label={$t('photos')}>
          {#each assets as asset (asset.id)}
            {@const isCurrent = asset.id === currentAssetId}
            <li>
              <button
                type="button"
                class="relative block aspect-square w-full overflow-hidden rounded-md bg-gray-100 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 dark:bg-gray-800"
                aria-label={assetLabel(asset)}
                title={asset.originalFileName}
                disabled={isCurrent}
                onclick={() => onClose(asset.id)}
              >
                {#if !failed.has(asset.id)}
                  <img
                    src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail, cacheKey: asset.thumbhash })}
                    alt=""
                    loading="lazy"
                    draggable="false"
                    class="size-full object-cover"
                    onerror={() => failed.add(asset.id)}
                  />
                {/if}
                {#if used.has(asset.id)}
                  <span
                    class="absolute inset-e-1 top-1 flex rounded-full bg-white text-primary shadow-sm dark:bg-gray-900"
                    aria-hidden="true"
                  >
                    <Icon icon={mdiCheckCircle} size="18" />
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if nextPage}
          <div class="flex justify-center">
            <Button color="secondary" variant="ghost" loading={isLoading} onclick={() => load(nextPage ?? undefined)}>
              {$t('load_more')}
            </Button>
          </div>
        {/if}
      {/if}
    </div>
  </ModalBody>
</Modal>

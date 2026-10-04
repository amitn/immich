<script lang="ts">
  import { toastUndoResult } from '$lib/managers/activity-log.svelte';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    getBurstArchiveIds,
    getBurstReasonKey,
    getBurstSourceKey,
    loadBurstRules,
    saveBurstRules,
    type BurstRules,
  } from '$lib/utils/bursts';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    cleanBursts,
    getAllAlbums,
    searchBursts,
    undoActivities,
    type AlbumResponseDto,
    type BurstGroupResponseDto,
  } from '@immich/sdk';
  import { Button, DatePicker, Field, Icon, IconButton, modalManager, Select, Text, toastManager } from '@immich/ui';
  import { mdiArchiveArrowDownOutline, mdiCheck, mdiOpenInNew, mdiRefresh } from '@mdi/js';
  import type { DateTime } from 'luxon';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    /** start with the photos of this album, e.g. from a link */
    albumId?: string;
  };

  const props: Props = $props();

  type Scope = 'all' | 'album' | 'dates';

  const PAGE_SIZE = 20;

  // svelte-ignore state_referenced_locally
  let scope = $state<Scope>(props.albumId ? 'album' : 'all');
  // svelte-ignore state_referenced_locally
  let albumId = $state<string | undefined>(props.albumId);
  let albums = $state<AlbumResponseDto[]>([]);
  let takenAfter = $state<DateTime>();
  let takenBefore = $state<DateTime>();
  let rules = $state<BurstRules>(loadBurstRules());

  let groups = $state<BurstGroupResponseDto[]>([]);
  let total = $state(0);
  let totalToArchive = $state(0);
  let truncated = $state(false);
  let hasNextPage = $state(false);
  let page = $state(1);
  let loading = $state(false);
  let loaded = $state(false);
  /** the photo the user picked to keep, by group */
  let picks = $state<Record<string, string>>({});
  let busy = $state(new Set<string>());
  let cleaningAll = $state(false);

  const scopes = $derived<{ value: Scope; label: string }[]>([
    { value: 'all', label: $t('burst_scope_all') },
    { value: 'album', label: $t('burst_scope_album') },
    { value: 'dates', label: $t('burst_scope_dates') },
  ]);
  const ruleOptions = $derived<{ key: keyof BurstRules; label: string }[]>([
    { key: 'preferRaw', label: $t('burst_rule_prefer_raw') },
    { key: 'preferEdited', label: $t('burst_rule_prefer_edited') },
    { key: 'preferLargest', label: $t('burst_rule_prefer_largest') },
  ]);
  const albumOptions = $derived(albums.map((album) => ({ value: album.id, label: album.albumName })));

  const keeperOf = (group: BurstGroupResponseDto) => picks[group.key] ?? group.keepAssetId;
  const actionable = $derived(groups.filter((group) => !group.readOnly));
  const toArchive = $derived(
    actionable.reduce((sum, group) => sum + getBurstArchiveIds(group, keeperOf(group)).length, 0),
  );

  const getScope = () => {
    if (scope === 'album') {
      return albumId ? { albumId } : undefined;
    }
    if (scope === 'dates') {
      return {
        takenAfter: takenAfter?.startOf('day').toISO() ?? undefined,
        takenBefore: takenBefore?.plus({ days: 1 }).startOf('day').toISO() ?? undefined,
      };
    }
    return {};
  };

  const load = async (next = 1) => {
    const filters = getScope();
    if (!filters) {
      groups = [];
      total = totalToArchive = 0;
      hasNextPage = false;
      loaded = true;
      return;
    }
    loading = true;
    try {
      const result = await searchBursts({ burstSearchDto: { ...filters, rules, page: next, size: PAGE_SIZE } });
      groups =
        next === 1
          ? result.groups
          : [...groups, ...result.groups.filter(({ key }) => groups.every((group) => group.key !== key))];
      if (next === 1) {
        picks = {};
      }
      total = result.total;
      totalToArchive = result.totalToArchive;
      truncated = result.truncated;
      hasNextPage = result.hasNextPage;
      page = next;
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_bursts'));
    } finally {
      loading = false;
      loaded = true;
    }
  };

  const loadAlbums = async () => {
    if (albums.length > 0) {
      return;
    }
    try {
      albums = await getAllAlbums({});
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_albums'), { notify: false });
    }
  };

  onMount(() => {
    if (scope === 'album') {
      void loadAlbums();
    }
    void load();
  });

  const setScope = (value: Scope) => {
    scope = value;
    if (value === 'album') {
      void loadAlbums();
    }
    void load();
  };

  const toggleRule = (key: keyof BurstRules) => {
    rules = { ...rules, [key]: !rules[key] };
    saveBurstRules(rules);
    void load();
  };

  const pick = (group: BurstGroupResponseDto, assetId: string) => {
    if (group.readOnly) {
      return;
    }
    picks = { ...picks, [group.key]: assetId };
  };

  const undo = async (activityId: string) => {
    try {
      const response = await undoActivities({ activityUndoDto: { ids: [activityId] } });
      toastUndoResult(response);
      await load();
    } catch (error) {
      handleError(error, $t('errors.unable_to_undo_changes'));
    }
  };

  /** keeps the photo of each group and archives the others; the groups cleaned up leave the list */
  const clean = async (targets: BurstGroupResponseDto[]) => {
    const keys = targets.map(({ key }) => key);
    busy = new Set([...busy, ...keys]);
    try {
      const result = await cleanBursts({
        burstCleanDto: {
          groups: targets.map((group) => ({
            assetIds: group.assets.map(({ assetId }) => assetId),
            keepAssetId: keeperOf(group),
          })),
        },
      });
      const done = new Set(targets.filter((_, index) => !result.groups[index]?.error).map(({ key }) => key));
      groups = groups.filter(({ key }) => !done.has(key));
      total = Math.max(0, total - done.size);
      totalToArchive = Math.max(0, totalToArchive - result.archived);

      const failed = result.groups.find(({ error }) => error);
      if (failed && result.archived === 0) {
        toastManager.warning(failed.error ?? $t('errors.unable_to_clean_up_bursts'));
        return;
      }
      const activityId = result.activityId;
      toastManager.success(
        {
          title: $t('burst_archived', { values: { count: result.archived } }),
          ...(failed && { description: failed.error }),
          ...(activityId && {
            button: (close) => ({
              label: $t('undo'),
              onclick: () => {
                close();
                return undo(activityId);
              },
            }),
          }),
        },
        { timeout: 8000 },
      );
    } catch (error) {
      handleError(error, $t('errors.unable_to_clean_up_bursts'));
    } finally {
      busy = new Set([...busy].filter((key) => !keys.includes(key)));
    }
  };

  const skip = (group: BurstGroupResponseDto) => {
    groups = groups.filter(({ key }) => key !== group.key);
  };

  const cleanAll = async () => {
    const confirmed = await modalManager.showDialog({
      title: $t('burst_clean_all_title'),
      prompt: $t('burst_clean_all_prompt', { values: { photos: toArchive, groups: actionable.length } }),
      confirmText: $t('burst_archive'),
      icon: mdiArchiveArrowDownOutline,
    });
    if (!confirmed) {
      return;
    }
    cleaningAll = true;
    await clean(actionable);
    cleaningAll = false;
  };

  const formatDate = (value: string) => new Date(value).toLocaleString();
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-3">
    <Text size="small" color="muted" class="min-w-0 flex-1">{$t('burst_cleanup_description')}</Text>
    <IconButton
      size="small"
      variant="ghost"
      shape="round"
      color="secondary"
      icon={mdiRefresh}
      aria-label={$t('refresh')}
      onclick={() => load()}
    />
  </div>

  <div class="flex flex-col gap-3 rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
    <fieldset>
      <legend class="mb-2 text-sm font-medium">{$t('burst_scope')}</legend>
      <div class="flex flex-wrap gap-2">
        {#each scopes as item (item.value)}
          {@const checked = scope === item.value}
          <label
            class="cursor-pointer rounded-full border-2 px-3 py-1 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
          >
            <input
              type="radio"
              name="burst-scope"
              class="sr-only"
              value={item.value}
              {checked}
              onchange={() => setScope(item.value)}
            />
            {item.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if scope === 'album'}
      <Field label={$t('album')}>
        <Select
          value={albumId}
          options={albumOptions}
          placeholder={$t('burst_choose_album')}
          onChange={(value) => {
            albumId = value;
            void load();
          }}
        />
      </Field>
    {:else if scope === 'dates'}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={$t('start_date')}>
          <DatePicker
            value={takenAfter}
            onChange={(value) => {
              takenAfter = value;
              void load();
            }}
          />
        </Field>
        <Field label={$t('end_date')}>
          <DatePicker
            value={takenBefore}
            onChange={(value) => {
              takenBefore = value;
              void load();
            }}
          />
        </Field>
      </div>
    {/if}

    <fieldset>
      <legend class="mb-2 text-sm font-medium">{$t('burst_rules')}</legend>
      <div class="flex flex-wrap gap-2">
        {#each ruleOptions as rule (rule.key)}
          {@const checked = rules[rule.key]}
          <label
            class="flex cursor-pointer items-center gap-1 rounded-full border-2 px-3 py-1 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
          >
            <input type="checkbox" class="sr-only" {checked} onchange={() => toggleRule(rule.key)} />
            {rule.label}
          </label>
        {/each}
      </div>
    </fieldset>
  </div>

  {#if groups.length > 0}
    <div class="flex flex-wrap items-center gap-3">
      <Text size="small" class="min-w-0 flex-1" data-testid="burst-summary">
        {$t('burst_summary', { values: { groups: actionable.length, photos: toArchive } })}
        {#if total > groups.length}
          · {$t('burst_found', { values: { groups: total, photos: totalToArchive } })}
        {/if}
      </Text>
      {#if actionable.length > 0}
        <Button
          size="small"
          leadingIcon={mdiArchiveArrowDownOutline}
          loading={cleaningAll}
          disabled={cleaningAll || toArchive === 0}
          onclick={cleanAll}
        >
          {$t('burst_clean_all', { values: { count: actionable.length } })}
        </Button>
      {/if}
    </div>
  {/if}

  {#if truncated}
    <Text size="small" color="muted">{$t('burst_truncated')}</Text>
  {/if}

  {#if loaded && !loading && groups.length === 0}
    <p class="py-16 text-center text-gray-600 dark:text-gray-300">
      {scope === 'album' && !albumId ? $t('burst_choose_album') : $t('burst_none')}
    </p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each groups as group (group.key)}
        {@const keeper = keeperOf(group)}
        {@const archive = getBurstArchiveIds(group, keeper)}
        {@const pending = busy.has(group.key)}
        <li
          class="flex flex-col gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"
          data-testid="burst-group"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium dark:bg-gray-800">
              {$t(getBurstSourceKey(group.source))}
            </span>
            <Text size="small" color="muted">
              {formatDate(group.takenAt)} · {$t('burst_photo_count', { values: { count: group.assets.length } })}
            </Text>
            <div class="flex-1"></div>
            {#if keeper === group.keepAssetId}
              {#each group.reasons as reason (reason)}
                <span
                  class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  data-testid="burst-reason"
                >
                  {$t(getBurstReasonKey(reason))}
                </span>
              {/each}
            {:else}
              <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {$t('burst_your_pick')}
              </span>
            {/if}
          </div>

          <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {#each group.assets as photo (photo.assetId)}
              {@const isKeeper = photo.assetId === keeper}
              <div
                class="group relative aspect-square overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 {isKeeper
                  ? 'ring-4 ring-primary'
                  : ''}"
                data-testid={isKeeper ? 'burst-keeper' : 'burst-photo'}
              >
                <button
                  type="button"
                  class="size-full disabled:cursor-default"
                  aria-label={isKeeper ? $t('burst_kept_photo') : $t('burst_keep_this')}
                  aria-pressed={isKeeper}
                  disabled={group.readOnly || pending}
                  onclick={() => pick(group, photo.assetId)}
                >
                  <img
                    src={getAssetMediaUrl({ id: photo.assetId, size: AssetMediaSize.Thumbnail })}
                    alt=""
                    class="size-full object-cover transition-opacity {isKeeper
                      ? ''
                      : 'opacity-60 group-hover:opacity-100'}"
                    draggable="false"
                  />
                </button>
                <span
                  class="pointer-events-none absolute inset-s-1 top-1 rounded-full px-2 py-0.5 text-xs {isKeeper
                    ? 'bg-primary font-medium text-light'
                    : 'bg-black/60 text-white'}"
                >
                  {isKeeper
                    ? $t('keep')
                    : archive.includes(photo.assetId)
                      ? $t('burst_archive')
                      : $t('burst_not_yours')}
                </span>
                <span class="pointer-events-none absolute inset-e-1 bottom-1 flex gap-1">
                  {#if photo.isRaw}
                    <span class="rounded-sm bg-black/60 px-1 text-[10px] text-white">RAW</span>
                  {/if}
                  {#if photo.isEdited}
                    <span class="rounded-sm bg-black/60 px-1 text-[10px] text-white">{$t('edited')}</span>
                  {/if}
                </span>
                <a
                  href={Route.viewAsset({ id: photo.assetId })}
                  class="absolute inset-e-1 top-1 hidden rounded-full bg-black/60 p-1 text-white group-hover:block focus-visible:block"
                  aria-label={$t('burst_open_photo')}
                  title={$t('burst_open_photo')}
                >
                  <Icon icon={mdiOpenInNew} size="14" />
                </a>
              </div>
            {/each}
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2">
            {#if group.readOnly}
              <Text size="small" color="muted" class="flex-1">{$t('burst_read_only')}</Text>
            {:else}
              <Button size="small" variant="ghost" color="secondary" disabled={pending} onclick={() => skip(group)}>
                {$t('skip')}
              </Button>
              <Button
                size="small"
                leadingIcon={mdiCheck}
                loading={pending && !cleaningAll}
                disabled={pending || archive.length === 0}
                onclick={() => clean([group])}
              >
                {$t('burst_keep_best', { values: { count: archive.length } })}
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>

    {#if hasNextPage}
      <div class="flex justify-center">
        <Button size="small" variant="outline" {loading} onclick={() => load(page + 1)}>
          {$t('load_more')}
        </Button>
      </div>
    {/if}
  {/if}
</div>

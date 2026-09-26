<script lang="ts">
  import {
    getCollectionLabel,
    getPlaceSourceLabel,
    type CollectionLabel,
    type WebCollectionPack,
  } from '$lib/collections/pack';
  import type { CollectionEntry, CollectionVisit } from '$lib/collections/types';
  import CollectionEntryEditor from '$lib/components/collections/CollectionEntryEditor.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { sidebarTagsManager } from '$lib/managers/sidebar-tags-manager.svelte';
  import AlbumBookExportModal from '$lib/modals/AlbumBookExportModal.svelte';
  import { openAssistant } from '$lib/services/assistant.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    applyCollectionEntries,
    formatVisitPlace,
    formatVisitTime,
    getCollectionAssistantPrompt,
    getCollectionEntriesDto,
    getEntryRows,
    getVisitAssetIds,
    summarizeCollectionEntries,
    type CollectionSaveSummary,
    type EntryRow,
  } from '$lib/utils/collections';
  import { getServerErrorMessage, handleError } from '$lib/utils/handle-error';
  import { AssetMediaSize, type AlbumResponseDto } from '@immich/sdk';
  import {
    Alert,
    Button,
    Field,
    HStack,
    Icon,
    IconButton,
    Input,
    LoadingSpinner,
    Modal,
    ModalBody,
    ModalFooter,
    modalManager,
    Text,
    toastManager,
  } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiArrowLeft,
    mdiBookOpenPageVariantOutline,
    mdiChevronRight,
    mdiClose,
    mdiContentSave,
    mdiCreationOutline,
    mdiInformationOutline,
    mdiMapMarkerOutline,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';

  type Props = {
    /** the collection pack, e.g. food: the dishes of meals */
    pack: WebCollectionPack;
    /** find the visits of this album */
    album?: AlbumResponseDto;
    /** or among these photos */
    assetIds?: string[];
    onClose: () => void;
  };

  const { pack, album, assetIds = [], onClose }: Props = $props();

  const label = (key: CollectionLabel) => getCollectionLabel(pack, key);

  type VisitDraft = {
    status: 'loading' | 'ready' | 'error';
    error?: string;
    place: string;
    entries: CollectionEntry[];
    rows: EntryRow[];
    warnings: string[];
    saved?: CollectionSaveSummary;
  };

  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorMessage = $state<string>();
  let visits = $state<CollectionVisit[]>([]);
  let warnings = $state<string[]>([]);
  let current = $state<number>();
  let drafts = $state<Record<number, VisitDraft>>({});
  let enlarged = $state<string>();
  let isSaving = $state(false);
  let savedAny = $state(false);
  const placeLookup = $derived(pack.hasPlaceLookup());
  /** the visits whose subjects were matched, or are being matched */
  const opened = new SvelteSet<number>();

  const visit = $derived(current === undefined ? undefined : visits.find(({ index }) => index === current));
  const draft = $derived(current === undefined ? undefined : drafts[current]);
  const fallback = $derived(visit?.place.source === 'fallback');
  const canSave = $derived(
    !!visit &&
      !!draft &&
      draft.status === 'ready' &&
      !isSaving &&
      /[\p{L}\d]/u.test(draft.place) &&
      (visit.sourceIds.length > 0 || draft.rows.some((row) => row.name.trim())),
  );
  const skipped = $derived(draft ? draft.rows.filter((row) => !row.name.trim()).length : 0);
  const canMakeBook = $derived(!!album || featureFlagsManager.value.assistant);

  const visitTitle = (value: CollectionVisit) => {
    const type = value.type === undefined ? undefined : pack.visitTypeLabel?.(value.type);
    const time = formatVisitTime(value, $locale ?? undefined);
    return type ? `${$t(type)} · ${time}` : time;
  };

  const load = async () => {
    status = 'loading';
    errorMessage = undefined;
    try {
      const ids = assetIds.slice(0, pack.limits.assetIds);
      const result = await pack.api.findVisits(album ? { albumId: album.id } : { assetIds: ids });
      visits = result.visits;
      // only part of a large album or selection is searched
      const truncated = result.truncated || ids.length < assetIds.length;
      warnings = [
        ...(truncated ? [$t(label('truncated'), { values: { count: result.count } })] : []),
        ...result.warnings,
      ];
      status = 'ready';
      if (visits.length === 1) {
        openVisit(visits[0]);
      }
    } catch (error) {
      errorMessage = getServerErrorMessage(error) || $t(label('error_find'));
      handleError(error, $t(label('error_find')), { notify: false });
      status = 'error';
    }
  };

  const match = async (value: CollectionVisit) => {
    const index = value.index;
    drafts[index] = { ...drafts[index], status: 'loading', error: undefined };
    const subjectIds = value.subjectIds.slice(0, pack.limits.subjects);
    if (subjectIds.length === 0) {
      drafts[index] = { ...drafts[index], status: 'ready', entries: [], rows: [], warnings: [] };
      return;
    }
    try {
      const result = await pack.api.matchVisit({
        subjectIds,
        sourceIds: value.sourceIds.slice(0, pack.limits.sources),
      });
      drafts[index] = {
        ...drafts[index],
        status: 'ready',
        entries: result.entries,
        rows: getEntryRows(value, result),
        warnings: result.warnings,
      };
    } catch (error) {
      handleError(error, $t(label('error_match')), { notify: false });
      drafts[index] = {
        ...drafts[index],
        status: 'error',
        error: getServerErrorMessage(error) || $t(label('error_match')),
      };
    }
  };

  const openVisit = (value: CollectionVisit) => {
    current = value.index;
    enlarged = undefined;
    if (!opened.has(value.index)) {
      opened.add(value.index);
      drafts[value.index] = {
        status: 'loading',
        place: value.place.name,
        entries: [],
        rows: [],
        warnings: [],
      };
      void match(value);
    }
  };

  const updateRow = (row: EntryRow) => {
    if (current === undefined) {
      return;
    }
    drafts[current].rows = drafts[current].rows.map((candidate) => (candidate.key === row.key ? row : candidate));
  };

  const save = async () => {
    if (!visit || !draft || !canSave) {
      return;
    }
    const index = visit.index;
    const { dto } = getCollectionEntriesDto(draft.place, visit.sourceIds, draft.rows);
    isSaving = true;
    try {
      const response = await pack.api.saveEntries(dto);
      const summary = summarizeCollectionEntries(response, visit.sourceIds);
      const updated = applyCollectionEntries(visit, response, visit.sourceIds);
      visits = visits.map((candidate) => (candidate.index === index ? updated : candidate));
      drafts[index] = {
        ...drafts[index],
        place: response.place,
        saved: summary,
        rows: drafts[index].rows.map((row) =>
          row.name.trim() ? { ...row, savedName: row.name.trim(), unsure: false } : row,
        ),
      };
      savedAny = true;
      // the place and its entries are new tags
      void sidebarTagsManager.load({ force: true });
      toastManager.success($t(label('saved'), { values: summary }));
      if (summary.failed > 0) {
        toastManager.warning($t(label('not_saved'), { values: { count: summary.failed } }));
      }
    } catch (error) {
      handleError(error, $t(label('error_save')));
    } finally {
      isSaving = false;
    }
  };

  const askAssistant = async () => {
    if (!visit || !draft) {
      return;
    }
    const prompt = getCollectionAssistantPrompt($t, pack, visit, draft.place, $locale ?? undefined);
    const ids = getVisitAssetIds(visit);
    onClose();
    await openAssistant({ assetIds: ids, prompt });
  };

  const makeBook = async () => {
    onClose();
    if (album) {
      await modalManager.show(AlbumBookExportModal, { album, stylePreset: pack.bookStylePreset });
      return;
    }
    await openAssistant({ assetIds, prompt: $t(label('book_prompt')) });
  };

  const back = () => {
    current = undefined;
    enlarged = undefined;
  };

  onMount(() => void load());
</script>

<Modal title={$t(label('title'))} icon={pack.icon} {onClose} size="large">
  <ModalBody>
    {#if status === 'loading'}
      <div class="flex flex-col items-center gap-3 py-10" role="status">
        <LoadingSpinner size="large" />
        <Text size="small" color="muted">{$t(label('finding'))}</Text>
      </div>
    {:else if status === 'error'}
      <div class="flex flex-col items-start gap-3">
        <Alert color="danger" icon={mdiAlertCircleOutline} title={errorMessage} />
        <Button size="small" shape="round" color="secondary" onclick={load}>{$t('retry')}</Button>
      </div>
    {:else if visit && draft}
      <div class="flex flex-col gap-5">
        <div class="flex items-start gap-2">
          {#if visits.length > 1}
            <IconButton
              shape="round"
              variant="ghost"
              color="secondary"
              size="small"
              icon={mdiArrowLeft}
              aria-label={$t(label('all_visits'))}
              onclick={back}
            />
          {/if}
          <div class="min-w-0">
            <p class="font-medium">{visitTitle(visit)}</p>
            {#if formatVisitPlace(visit)}
              <p class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                <Icon icon={mdiMapMarkerOutline} size="16" aria-hidden />
                {formatVisitPlace(visit)}
              </p>
            {/if}
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <Field label={$t(label('place'))} description={$t(getPlaceSourceLabel(pack, visit.place.source))} required>
            <Input bind:value={draft.place} maxlength={100} disabled={isSaving} />
          </Field>
          {#if fallback}
            <Alert color="warning" icon={mdiInformationOutline} size="small">
              <p class="text-sm">
                {placeLookup ? $t(label('place_unknown_lookup')) : $t(label('place_unknown'))}
              </p>
            </Alert>
          {/if}
          {#if visit.candidates.length > 0}
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-gray-600 dark:text-gray-400">{$t(label('other_names'))}</span>
              {#each visit.candidates as candidate (candidate.name + candidate.source)}
                <button
                  type="button"
                  class="rounded-full border border-gray-300 px-3 py-0.5 hover:border-primary hover:text-primary dark:border-gray-600"
                  title={$t(getPlaceSourceLabel(pack, candidate.source))}
                  disabled={isSaving}
                  onclick={() => (draft.place = candidate.name)}
                >
                  {candidate.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <section class="flex flex-col gap-2" aria-labelledby="collection-source-heading">
          <h3 id="collection-source-heading" class="text-sm font-medium">{$t(label('source'))}</h3>
          {#if visit.sourceIds.length === 0}
            <Text size="small" color="muted">{$t(label('no_source'))}</Text>
          {:else}
            <div class="flex flex-wrap gap-2">
              {#each visit.sourceIds as id (id)}
                <button
                  type="button"
                  class="relative overflow-hidden rounded-lg ring-primary focus-visible:ring-2 {enlarged === id
                    ? 'ring-2'
                    : ''}"
                  aria-label={$t(label('view_source'))}
                  aria-pressed={enlarged === id}
                  onclick={() => (enlarged = enlarged === id ? undefined : id)}
                >
                  <img
                    src={getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail })}
                    alt={$t(label('source_photo'))}
                    class="size-20 bg-gray-100 object-cover sm:size-24 dark:bg-gray-800"
                    draggable="false"
                  />
                  <span class="absolute inset-x-0 bottom-0 bg-black/60 text-center text-xs text-white">
                    {$t(label('source'))}
                  </span>
                </button>
              {/each}
            </div>
            {#if enlarged}
              <div class="relative rounded-lg bg-gray-100 dark:bg-gray-800">
                <img
                  src={getAssetMediaUrl({ id: enlarged, size: AssetMediaSize.Preview })}
                  alt={$t(label('source_photo'))}
                  class="mx-auto max-h-[70vh] w-full object-contain"
                  draggable="false"
                />
                <IconButton
                  class="absolute inset-e-2 top-2"
                  shape="round"
                  color="secondary"
                  size="small"
                  icon={mdiClose}
                  aria-label={$t('close')}
                  onclick={() => (enlarged = undefined)}
                />
              </div>
            {/if}
            {#if draft.status === 'ready'}
              <Text size="small" color="muted">
                {$t(label('entries_read'), { values: { count: draft.entries.length } })}
              </Text>
            {/if}
          {/if}
        </section>

        <section class="flex flex-col gap-2" aria-labelledby="collection-subjects-heading">
          <h3 id="collection-subjects-heading" class="text-sm font-medium">{$t(label('subjects'))}</h3>
          {#if draft.status === 'loading'}
            <div class="flex items-center gap-3 py-4" role="status">
              <LoadingSpinner />
              <Text size="small" color="muted">{$t(label('matching'))}</Text>
            </div>
          {:else if draft.status === 'error'}
            <div class="flex flex-col items-start gap-2">
              <Alert color="danger" icon={mdiAlertCircleOutline} title={draft.error} />
              <Button size="small" shape="round" color="secondary" onclick={() => match(visit)}>{$t('retry')}</Button>
            </div>
          {:else}
            {#each draft.warnings as warning (warning)}
              <Text size="small" color="muted">{warning}</Text>
            {/each}
            {#if draft.rows.length === 0}
              <Text size="small" color="muted">{$t(label('no_subjects'))}</Text>
            {:else}
              <ul class="flex flex-col gap-2">
                {#each draft.rows as row (row.key)}
                  <CollectionEntryEditor
                    {pack}
                    {row}
                    entries={draft.entries}
                    disabled={isSaving}
                    onChange={updateRow}
                  />
                {/each}
              </ul>
              {#if skipped > 0}
                <Text size="small" color="muted">{$t(label('skipped'), { values: { count: skipped } })}</Text>
              {/if}
            {/if}
          {/if}
        </section>

        {#if draft.saved}
          <Alert color="success" title={$t(label('saved'), { values: draft.saved })}>
            {#if canMakeBook}
              <p class="text-sm">{$t(label('make_book_description'))}</p>
            {/if}
          </Alert>
        {/if}
      </div>
    {:else if visits.length === 0}
      <div class="flex flex-col items-center gap-2 py-10 text-center">
        <Icon icon={pack.icon} size="48" class="text-gray-400" aria-hidden />
        <Text>{album ? $t(label('no_visits_album')) : $t(label('no_visits_selection'))}</Text>
        {#each warnings as warning (warning)}
          <Text size="small" color="muted">{warning}</Text>
        {/each}
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        <Text size="small" color="muted">{$t(label('visits_found'), { values: { count: visits.length } })}</Text>
        {#each warnings as warning (warning)}
          <Text size="small" color="muted">{warning}</Text>
        {/each}
        <ul class="flex flex-col gap-2">
          {#each visits as item (item.index)}
            {@const named = item.saved.length}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-xl border border-gray-200 p-3 text-start hover:border-primary dark:border-gray-700"
                onclick={() => openVisit(item)}
              >
                <img
                  src={getAssetMediaUrl({
                    id: item.subjectIds[0] ?? getVisitAssetIds(item)[0],
                    size: AssetMediaSize.Thumbnail,
                  })}
                  alt=""
                  class="size-16 shrink-0 rounded-lg bg-gray-100 object-cover dark:bg-gray-800"
                  draggable="false"
                />
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate font-medium">{item.place.name}</span>
                  <span class="text-xs text-gray-600 dark:text-gray-400">
                    {$t(getPlaceSourceLabel(pack, item.place.source))}
                    {#if item.candidates.length > 0}
                      · {$t(label('also_read'), {
                        values: { names: item.candidates.map(({ name }) => name).join(', ') },
                      })}
                    {/if}
                  </span>
                  <span class="text-sm">{visitTitle(item)}</span>
                  {#if formatVisitPlace(item)}
                    <span class="text-sm text-gray-600 dark:text-gray-400">{formatVisitPlace(item)}</span>
                  {/if}
                  <span class="text-xs text-gray-600 dark:text-gray-400">
                    {$t(label('visit_photos'), {
                      values: { subjects: item.subjectIds.length, sources: item.sourceIds.length },
                    })}
                    {#if named > 0}
                      · <span class="text-green-700 dark:text-green-400">
                        {$t(label('visit_named'), { values: { count: named } })}
                      </span>
                    {/if}
                  </span>
                </span>
                <Icon icon={mdiChevronRight} size="20" class="shrink-0 text-gray-500" aria-hidden />
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth class="flex-wrap">
      {#if visit && draft}
        {#if featureFlagsManager.value.assistant}
          <Button shape="round" color="secondary" fullWidth leadingIcon={mdiCreationOutline} onclick={askAssistant}>
            {$t(label('ask_assistant'))}
          </Button>
        {/if}
        {#if draft.saved && canMakeBook}
          <Button
            shape="round"
            color="secondary"
            fullWidth
            leadingIcon={mdiBookOpenPageVariantOutline}
            onclick={makeBook}
          >
            {$t(label('make_book'))}
          </Button>
        {/if}
        <Button
          shape="round"
          fullWidth
          leadingIcon={mdiContentSave}
          loading={isSaving}
          disabled={!canSave}
          onclick={save}
        >
          {$t('save')}
        </Button>
      {:else}
        <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('close')}</Button>
        {#if savedAny && canMakeBook}
          <Button shape="round" fullWidth leadingIcon={mdiBookOpenPageVariantOutline} onclick={makeBook}>
            {$t(label('make_book'))}
          </Button>
        {/if}
      {/if}
    </HStack>
  </ModalFooter>
</Modal>

<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
  import { Route } from '$lib/route';
  import { discardBookDraftWithConfirm, keepBookDraftWithToast } from '$lib/services/book.service';
  import { locale } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { getYearRecapStats, getYearRecapYear } from '$lib/utils/memory-card';
  import {
    createYearRecapBook,
    getBookDrafts,
    HighlightFormat,
    type BookDraftResponseDto,
    type BookResponseDto,
    type MemoryResponseDto,
  } from '@immich/sdk';
  import { Button, modalManager, toastManager } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiCellphone, mdiCheck, mdiClose, mdiMovieOpenPlayOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  /**
   * Gallery fork (#12): what a year in review offers, never makes on its own: its stats, a highlight video (landscape
   * or vertical) and the book of the year, a draft to keep or discard like the suggested books.
   */
  type Props = {
    memory: MemoryResponseDto;
    /** the card's title in the viewer's language, which the video and the book are named after */
    title: string;
  };

  const { memory, title }: Props = $props();

  const stats = $derived(getYearRecapStats(memory, $t, $locale));
  const year = $derived(getYearRecapYear(memory));
  const hasBooks = $derived(!!featureFlagsManager.valueOrUndefined?.assistant);

  let draft = $state<BookDraftResponseDto>();
  let kept = $state<BookResponseDto>();
  let busy = $state(false);

  const isDraftOf = (candidate: BookDraftResponseDto) =>
    candidate.memoryId === memory.id || (year !== undefined && candidate.key.startsWith(`recap:${year}`));

  onMount(async () => {
    if (!hasBooks) {
      return;
    }
    try {
      draft = (await getBookDrafts()).find((candidate) => isDraftOf(candidate));
    } catch (error) {
      handleError(error, $t('errors.unable_to_make_year_recap_book'), { notify: false });
    }
  });

  const makeVideo = (format: HighlightFormat) =>
    modalManager.show(HighlightVideoModal, { memoryId: memory.id, title, format });

  const makeBook = async () => {
    if (year === undefined) {
      return;
    }
    busy = true;
    toastManager.primary($t('year_recap_book_started', { values: { title } }));
    try {
      draft = await createYearRecapBook({ year, yearRecapBookDto: { title: title || undefined } });
    } catch (error) {
      handleError(error, $t('errors.unable_to_make_year_recap_book'));
    } finally {
      busy = false;
    }
  };

  const keep = async () => {
    if (!draft) {
      return;
    }
    busy = true;
    const book = await keepBookDraftWithToast($t, draft.book);
    if (book) {
      kept = book;
      draft = undefined;
    }
    busy = false;
  };

  const discard = async () => {
    if (!draft) {
      return;
    }
    busy = true;
    if (await discardBookDraftWithConfirm($t, draft.book)) {
      draft = undefined;
    }
    busy = false;
  };
</script>

<div
  class="mt-2 flex flex-col gap-2"
  data-testid="year-recap-actions"
  aria-label={$t('year_recap_actions', { values: { title } })}
>
  {#if stats.length > 0}
    <ul class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
      {#each stats as stat (stat)}
        <li>{stat}</li>
      {/each}
    </ul>
  {/if}
  <div class="flex flex-wrap gap-2">
    <Button
      size="small"
      shape="round"
      variant="outline"
      leadingIcon={mdiMovieOpenPlayOutline}
      onclick={() => makeVideo(HighlightFormat.Landscape)}
    >
      {$t('year_recap_video')}
    </Button>
    <Button
      size="small"
      shape="round"
      variant="outline"
      leadingIcon={mdiCellphone}
      onclick={() => makeVideo(HighlightFormat.Vertical)}
    >
      {$t('year_recap_video_vertical')}
    </Button>
    {#if hasBooks}
      {#if draft}
        <Button
          size="small"
          shape="round"
          variant="outline"
          leadingIcon={mdiBookOpenPageVariantOutline}
          href={Route.viewBook(draft.book)}
        >
          {$t('year_recap_book_open')}
        </Button>
        <Button size="small" shape="round" leadingIcon={mdiCheck} disabled={busy} onclick={keep}>
          {$t('book_draft_keep')}
        </Button>
        <Button
          size="small"
          shape="round"
          variant="ghost"
          color="secondary"
          leadingIcon={mdiClose}
          disabled={busy}
          onclick={discard}
        >
          {$t('book_draft_discard')}
        </Button>
      {:else if kept}
        <Button
          size="small"
          shape="round"
          variant="outline"
          leadingIcon={mdiBookOpenPageVariantOutline}
          href={Route.viewBook(kept)}
        >
          {$t('year_recap_book_open')}
        </Button>
      {:else}
        <Button
          size="small"
          shape="round"
          variant="outline"
          leadingIcon={mdiBookOpenPageVariantOutline}
          disabled={busy || year === undefined}
          onclick={makeBook}
        >
          {$t('year_recap_make_book')}
        </Button>
      {/if}
    {/if}
  </div>
</div>

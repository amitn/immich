<script lang="ts">
  import { goto } from '$app/navigation';
  import { shortcuts } from '$lib/actions/shortcut';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { openAssistant } from '$lib/services/assistant.service';
  import { deleteBook, exportBook, getBook, getBookPageRenderUrl, getBookPdfUrl } from '$lib/services/book-api';
  import { websocketEvents } from '$lib/stores/websocket';
  import type { AgentUpdateDto, BookDetailResponseDto, BookPageDto } from '$lib/types/assistant';
  import { firstPageForView, toViews, viewIndexForPage, type BookViewMode } from '$lib/utils/book';
  import { handleError } from '$lib/utils/handle-error';
  import { Button, IconButton, LoadingSpinner, modalManager, toastManager } from '@immich/ui';
  import {
    mdiBookOpenVariantOutline,
    mdiChevronLeft,
    mdiChevronRight,
    mdiCreationOutline,
    mdiDownload,
    mdiFilePdfBox,
    mdiFileOutline,
    mdiTrashCanOutline,
  } from '@mdi/js';
  import { onDestroy, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  const POLL_INTERVAL = 3000;

  let book = $state<BookDetailResponseDto>(data.book);
  let mode = $state<BookViewMode>('single');
  let viewIndex = $state(0);
  let isStartingExport = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let strip = $state<HTMLElement>();
  const loaded = new SvelteSet<string>();

  const pages = $derived([...book.pages].sort((a, b) => a.position - b.position));
  const views = $derived(toViews(pages, mode));
  const current = $derived(views[Math.min(viewIndex, views.length - 1)] ?? []);
  const ratio = $derived(book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1);
  const isExporting = $derived(book.exportStatus === 'pending' || book.exportStatus === 'running');
  const hasPrevious = $derived(viewIndex > 0);
  const hasNext = $derived(viewIndex < views.length - 1);

  const pageNumber = (page: BookPageDto) => pages.indexOf(page) + 1;

  const renderUrl = (page: BookPageDto, size: number) =>
    getBookPageRenderUrl({ id: book.id, pageId: page.id, size, cacheKey: book.updatedAt });

  const pageLabel = $derived.by(() => {
    if (current.length === 0) {
      return '';
    }
    if (current.length === 1) {
      return $t('book_page_of', { values: { page: pageNumber(current[0]), total: pages.length } });
    }
    return $t('book_pages_of', {
      values: { from: pageNumber(current[0]), to: pageNumber(current.at(-1)!), total: pages.length },
    });
  });

  const goToView = async (index: number) => {
    viewIndex = Math.max(0, Math.min(index, views.length - 1));
    await tick();
    strip?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };

  const goToPage = (pageIndex: number) => goToView(viewIndexForPage(pageIndex, mode));

  const setMode = (next: BookViewMode) => {
    if (next === mode) {
      return;
    }
    const pageIndex = firstPageForView(viewIndex, mode);
    mode = next;
    void goToPage(pageIndex);
  };

  const refresh = async () => {
    try {
      const updated = await getBook({ id: book.id });
      book = updated;
      if (viewIndex > views.length - 1) {
        viewIndex = Math.max(0, views.length - 1);
      }
      return updated;
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_book'), { notify: false });
    }
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const pollExport = async () => {
    const updated = await refresh();
    if (!updated || updated.exportStatus === 'pending' || updated.exportStatus === 'running') {
      return;
    }
    stopPolling();
    if (updated.exportStatus === 'completed') {
      toastManager.success($t('book_pdf_ready'));
    } else if (updated.exportStatus === 'failed') {
      toastManager.danger($t('errors.unable_to_export_book'));
    }
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = setInterval(() => void pollExport(), POLL_INTERVAL);
  };

  const handleExport = async () => {
    isStartingExport = true;
    try {
      await exportBook({ id: book.id });
      book.exportStatus = 'pending';
      toastManager.primary($t('book_export_started'));
      startPolling();
    } catch (error) {
      handleError(error, $t('errors.unable_to_export_book'));
    } finally {
      isStartingExport = false;
    }
  };

  const handleEditWithAssistant = () =>
    openAssistant({ prompt: $t('book_edit_prompt', { values: { title: book.title, id: book.id } }) });

  const handleDelete = async () => {
    const confirmed = await modalManager.showDialog({
      title: $t('book_delete'),
      prompt: $t('book_delete_prompt', { values: { title: book.title } }),
      confirmText: $t('delete'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }

    try {
      await deleteBook({ id: book.id });
      toastManager.primary($t('book_deleted'));
      await goto(Route.books());
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_book'));
    }
  };

  const onAgentUpdate = ({ message }: AgentUpdateDto) => {
    // re-render when the assistant finishes changing this book
    if (
      message?.kind === 'tool_call' &&
      message.content.status === 'completed' &&
      message.content.bookIds?.includes(book.id)
    ) {
      void refresh();
    }
  };

  onMount(() => {
    if (isExporting) {
      startPolling();
    }
    return websocketEvents.on('on_agent_update', onAgentUpdate);
  });

  onDestroy(() => stopPolling());
</script>

<svelte:document
  use:shortcuts={[
    { shortcut: { key: 'ArrowLeft' }, onShortcut: () => goToView(viewIndex - 1) },
    { shortcut: { key: 'ArrowRight' }, onShortcut: () => goToView(viewIndex + 1) },
    { shortcut: { key: 'Home' }, onShortcut: () => goToView(0) },
    { shortcut: { key: 'End' }, onShortcut: () => goToView(views.length - 1) },
  ]}
/>

<UserPageLayout title={book.title} description={book.subtitle ?? undefined}>
  {#snippet buttons()}
    <div class="flex items-center gap-1">
      <Button
        variant="ghost"
        size="small"
        color="secondary"
        leadingIcon={mdiCreationOutline}
        onclick={handleEditWithAssistant}
      >
        <span class="hidden sm:inline">{$t('book_edit_with_assistant')}</span>
        <span class="sr-only sm:hidden">{$t('book_edit_with_assistant')}</span>
      </Button>
      {#if isExporting}
        <div class="flex items-center gap-2 px-2 text-sm text-gray-600 dark:text-gray-400" role="status">
          <LoadingSpinner size="small" />
          <span>{$t('book_exporting')}</span>
        </div>
      {:else}
        {#if book.exportStatus === 'completed'}
          <Button
            href={getBookPdfUrl(book)}
            download="{book.title}.pdf"
            variant="ghost"
            size="small"
            color="secondary"
            leadingIcon={mdiDownload}
          >
            {$t('book_download_pdf')}
          </Button>
        {/if}
        <Button
          variant="ghost"
          size="small"
          color="secondary"
          leadingIcon={mdiFilePdfBox}
          loading={isStartingExport}
          disabled={pages.length === 0}
          onclick={handleExport}
        >
          {book.exportStatus === 'completed' ? $t('book_export_again') : $t('book_export_pdf')}
        </Button>
      {/if}
      <IconButton
        variant="ghost"
        size="small"
        color="danger"
        shape="round"
        icon={mdiTrashCanOutline}
        aria-label={$t('book_delete')}
        title={$t('book_delete')}
        onclick={handleDelete}
      />
    </div>
  {/snippet}

  {#if pages.length === 0}
    <div class="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
      <p class="text-gray-600 dark:text-gray-400">{$t('book_no_pages')}</p>
      <Button shape="round" leadingIcon={mdiCreationOutline} onclick={handleEditWithAssistant}>
        {$t('book_edit_with_assistant')}
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-4 pb-6">
      <div class="flex items-center justify-between gap-2 px-2 pt-2">
        <p class="text-sm text-gray-600 dark:text-gray-400" aria-live="polite">{pageLabel}</p>
        <div class="flex gap-1" role="group" aria-label={$t('book_view_mode')}>
          <Button
            size="small"
            shape="round"
            variant={mode === 'single' ? 'filled' : 'ghost'}
            color="secondary"
            leadingIcon={mdiFileOutline}
            aria-pressed={mode === 'single'}
            onclick={() => setMode('single')}
          >
            {$t('book_single_page')}
          </Button>
          <Button
            size="small"
            shape="round"
            variant={mode === 'spread' ? 'filled' : 'ghost'}
            color="secondary"
            leadingIcon={mdiBookOpenVariantOutline}
            aria-pressed={mode === 'spread'}
            onclick={() => setMode('spread')}
          >
            {$t('book_spread')}
          </Button>
        </div>
      </div>

      <div class="flex items-center justify-center gap-2">
        <IconButton
          shape="round"
          variant="ghost"
          color="secondary"
          icon={mdiChevronLeft}
          directional
          disabled={!hasPrevious}
          aria-label={$t('previous')}
          onclick={() => goToView(viewIndex - 1)}
        />

        <div class="flex min-w-0 flex-1 justify-center">
          <div class="flex max-w-full shadow-lg">
            {#each current as page (page.id)}
              <figure
                class="relative bg-gray-100 dark:bg-gray-800"
                style:aspect-ratio={ratio}
                style:width="min({current.length === 1 ? '100%' : '50%'}, calc(65dvh * {ratio}))"
              >
                {#if !loaded.has(page.id)}
                  <div class="absolute inset-0 flex items-center justify-center"><LoadingSpinner /></div>
                {/if}
                <img
                  src={renderUrl(page, 1200)}
                  alt={$t('book_page_image', { values: { page: pageNumber(page) } })}
                  class="absolute inset-0 size-full object-contain"
                  draggable="false"
                  onload={() => loaded.add(page.id)}
                  onerror={() => loaded.add(page.id)}
                />
              </figure>
            {/each}
          </div>
        </div>

        <IconButton
          shape="round"
          variant="ghost"
          color="secondary"
          icon={mdiChevronRight}
          directional
          disabled={!hasNext}
          aria-label={$t('next')}
          onclick={() => goToView(viewIndex + 1)}
        />
      </div>

      {#if current.some((page) => page.sectionTitle || page.caption || page.slots.some((slot) => slot.caption))}
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 sm:flex-row">
          {#each current as page (page.id)}
            <div class="flex flex-1 flex-col gap-1 text-sm">
              {#if page.sectionTitle}
                <h2 class="font-semibold">{page.sectionTitle}</h2>
              {/if}
              {#if page.caption}
                <p class="text-gray-700 dark:text-gray-300">{page.caption}</p>
              {/if}
              {#each page.slots.filter((slot) => slot.caption) as slot (slot.slot)}
                <p class="text-xs text-gray-600 dark:text-gray-400">
                  {$t('book_slot_caption', { values: { slot: slot.slot + 1, caption: slot.caption } })}
                </p>
              {/each}
            </div>
          {/each}
        </div>
      {/if}

      <nav aria-label={$t('book_pages')}>
        <ul bind:this={strip} class="flex immich-scrollbar gap-2 overflow-x-auto p-2">
          {#each pages as page, index (page.id)}
            {@const active = current.includes(page)}
            <li class="shrink-0">
              <button
                type="button"
                class="flex flex-col items-center gap-1 rounded-md p-1 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary {active
                  ? 'bg-primary/15'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
                aria-current={active ? 'true' : undefined}
                aria-label={$t('book_go_to_page', { values: { page: index + 1 } })}
                onclick={() => goToPage(index)}
              >
                <img
                  src={renderUrl(page, 300)}
                  alt=""
                  loading="lazy"
                  draggable="false"
                  class="h-20 bg-gray-100 object-contain shadow-sm dark:bg-gray-800 {active
                    ? 'ring-2 ring-primary'
                    : ''}"
                  style:aspect-ratio={ratio}
                />
                <span class="text-xs text-gray-600 dark:text-gray-400">{index + 1}</span>
              </button>
            </li>
          {/each}
        </ul>
      </nav>
    </div>
  {/if}
</UserPageLayout>

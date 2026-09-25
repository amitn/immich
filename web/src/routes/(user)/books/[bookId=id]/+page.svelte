<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { shortcuts } from '$lib/actions/shortcut';
  import BookEditPanel from '$lib/components/books/BookEditPanel.svelte';
  import BookMenuOption from '$lib/components/books/BookMenuOption.svelte';
  import BookPageEditor from '$lib/components/books/BookPageEditor.svelte';
  import BookPageStrip from '$lib/components/books/BookPageStrip.svelte';
  import BookReviewPanel from '$lib/components/books/BookReviewPanel.svelte';
  import BookSlotHighlight from '$lib/components/books/BookSlotHighlight.svelte';
  import BookStyleMenu from '$lib/components/books/BookStyleMenu.svelte';
  import { BookReviewState } from '$lib/components/books/book-review-state.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { AgentToolCallStatus } from '$lib/managers/agent-conversation.svelte';
  import { BookEditorManager } from '$lib/managers/book-editor-manager.svelte';
  import BookPreviewModal from '$lib/modals/BookPreviewModal.svelte';
  import BookRelayoutModal from '$lib/modals/BookRelayoutModal.svelte';
  import { Route } from '$lib/route';
  import { openAssistant } from '$lib/services/assistant.service';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { websocketEvents } from '$lib/stores/websocket';
  import { getBookExportUrl, getBookPageRenderUrl } from '$lib/utils';
  import { firstPageForView, toViews, viewIndexForPage, type BookViewMode } from '$lib/utils/book';
  import {
    BOOK_EXPORT_FORMATS,
    getBookExportedAt,
    getBookExportStatus,
    getBookFileName,
    isBookExporting,
    isBookExportOutdated,
    isExportActive,
    isMapPage,
  } from '$lib/utils/book-export';
  import { getBookReviewBadgeCount } from '$lib/utils/book-review';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AgentMessageKind,
    BookExportFormat,
    BookExportStatus,
    deleteBook,
    exportBook,
    getBook,
    type AgentUpdateDto,
    type BookDetailResponseDto,
    type BookPageResponseDto,
    type BookResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, LoadingSpinner, modalManager, toastManager } from '@immich/ui';
  import {
    mdiArrowLeft,
    mdiAutoFix,
    mdiBookOpenVariantOutline,
    mdiBookshelf,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClipboardCheckOutline,
    mdiCreationOutline,
    mdiDownload,
    mdiExportVariant,
    mdiEyeOutline,
    mdiFileOutline,
    mdiFilePdfBox,
    mdiLanguageHtml5,
    mdiPencilOutline,
    mdiTrashCanOutline,
  } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  const POLL_INTERVAL = 3000;
  const REVIEW_PANEL_ID = 'book-review-panel';
  const REVIEW_BUTTON_ID = 'book-review-button';

  // a working copy: refreshed after edits and exports, and replaced by showBook when switching books
  // svelte-ignore state_referenced_locally
  let book = $state<BookDetailResponseDto>(data.book);
  let mode = $state<BookViewMode>('single');
  let viewIndex = $state(0);
  let startingExport = $state<BookExportFormat>();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let strip = $state<HTMLElement>();
  const loaded = new SvelteSet<string>();
  let editing = $state(false);
  const editor = new BookEditorManager({ getBook: () => book, refresh: () => refresh() });

  const pages = $derived([...book.pages].sort((a, b) => a.position - b.position));
  const views = $derived(toViews(pages, mode));
  const current = $derived(views[Math.min(viewIndex, views.length - 1)] ?? []);
  const ratio = $derived(book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1);
  const isExporting = $derived(isBookExporting(book));
  const activeExports = $derived(
    BOOK_EXPORT_FORMATS.filter((format) => isExportActive(getBookExportStatus(book, format))),
  );
  // the open book is the freshest copy, e.g. after the assistant renamed it
  const books = $derived(
    data.books
      .map((other) =>
        other.id === book.id
          ? { ...other, title: book.title, pageCount: pages.length, updatedAt: book.updatedAt }
          : other,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const review = new BookReviewState(() => $t('errors.unable_to_load_book_review'));
  let reviewOpen = $state(false);
  /** The slot of a review issue, until another page is shown */
  let highlight = $state<{ pageId: string; slot: number }>();
  const reviewBadge = $derived(getBookReviewBadgeCount(review.review));
  const reviewKey = $derived(pages.length > 0 ? `${book.id}@${book.updatedAt}` : undefined);

  const hasPrevious = $derived(viewIndex > 0);
  const hasNext = $derived(viewIndex < views.length - 1);

  const pageNumber = (page: BookPageResponseDto) => pages.indexOf(page) + 1;

  const pageImageLabel = (page: BookPageResponseDto) =>
    isMapPage(page)
      ? $t('book_map_page_image', { values: { page: pageNumber(page) } })
      : $t('book_page_image', { values: { page: pageNumber(page) } });

  const renderUrl = (page: BookPageResponseDto, size: number) =>
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

  const toggleEditing = () => {
    editing = !editing;
    editor.select();
    if (editing) {
      void editor.loadLayouts();
    }
  };

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

  const formatLabel = (format: BookExportFormat) =>
    format === BookExportFormat.Pdf ? $t('book_format_pdf') : $t('book_format_html');

  const pollExport = async () => {
    const previous = {
      [BookExportFormat.Pdf]: getBookExportStatus(book, BookExportFormat.Pdf),
      [BookExportFormat.Html]: getBookExportStatus(book, BookExportFormat.Html),
    };
    const updated = await refresh();
    if (!updated) {
      return;
    }
    for (const format of BOOK_EXPORT_FORMATS) {
      const status = getBookExportStatus(updated, format);
      if (!isExportActive(previous[format]) || isExportActive(status)) {
        continue;
      }
      if (status === BookExportStatus.Completed) {
        toastManager.success(format === BookExportFormat.Pdf ? $t('book_pdf_ready') : $t('book_html_ready'));
      } else if (status === BookExportStatus.Failed) {
        toastManager.danger($t('errors.unable_to_export_book_format', { values: { format: formatLabel(format) } }));
      }
    }
    if (!isBookExporting(updated)) {
      stopPolling();
    }
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = setInterval(() => void pollExport(), POLL_INTERVAL);
  };

  const handleExport = async (format: BookExportFormat) => {
    if (startingExport || isExportActive(getBookExportStatus(book, format))) {
      return;
    }
    startingExport = format;
    try {
      await exportBook({ id: book.id, bookExportDto: { format } });
      if (format === BookExportFormat.Html) {
        book.htmlExportStatus = BookExportStatus.Pending;
      } else {
        book.exportStatus = BookExportStatus.Pending;
      }
      toastManager.primary(
        format === BookExportFormat.Pdf ? $t('book_export_started') : $t('book_export_html_started'),
      );
      startPolling();
    } catch (error) {
      handleError(error, $t('errors.unable_to_export_book'));
    } finally {
      startingExport = undefined;
    }
  };

  const handleDownload = (format: BookExportFormat) => {
    const link = document.createElement('a');
    link.href = getBookExportUrl({ id: book.id, format });
    link.download = getBookFileName(book, format);
    document.body.append(link);
    link.click();
    link.remove();
  };

  const exportStatusLabel = (status: BookExportStatus | null) => {
    switch (status) {
      case BookExportStatus.Pending: {
        return $t('book_export_status_pending');
      }
      case BookExportStatus.Running: {
        return $t('book_export_status_running');
      }
      case BookExportStatus.Completed: {
        return $t('book_export_status_completed');
      }
      case BookExportStatus.Failed: {
        return $t('book_export_status_failed');
      }
      default: {
        return $t('book_export_status_none');
      }
    }
  };

  /** e.g. "Exported 5 minutes ago", or "Outdated · exported …" when the book changed since */
  const exportedLabel = (format: BookExportFormat) => {
    const exportedAt = getBookExportedAt(book, format);
    const time = exportedAt ? DateTime.fromISO(exportedAt).toRelative({ locale: $locale }) : null;
    if (isBookExportOutdated(book, format)) {
      return time ? $t('book_export_outdated_at', { values: { time } }) : $t('book_export_outdated');
    }
    return time ? $t('book_exported_at', { values: { time } }) : $t('book_export_status_completed');
  };

  const exportActionSubtitle = (format: BookExportFormat, status: BookExportStatus | null) => {
    if (status !== BookExportStatus.Completed) {
      return exportStatusLabel(status);
    }
    return isBookExportOutdated(book, format) ? $t('book_export_outdated_hint') : undefined;
  };

  const exportActionLabel = (format: BookExportFormat, status: BookExportStatus | null) => {
    if (status === BookExportStatus.Completed) {
      return format === BookExportFormat.Pdf ? $t('book_export_again') : $t('book_export_html_again');
    }
    return format === BookExportFormat.Pdf ? $t('book_export_pdf') : $t('book_export_html');
  };

  const handleRelayout = async () => {
    const updated = await modalManager.show(BookRelayoutModal, { book });
    if (!updated) {
      return;
    }
    book = updated;
    loaded.clear();
    void goToView(0);
    toastManager.success($t('book_relayout_done'));
  };

  const handlePreview = () => modalManager.show(BookPreviewModal, { book: { ...book, pageCount: pages.length } });

  const handleSwitchBook = (other: BookResponseDto) => {
    if (other.id !== book.id) {
      void goto(Route.viewBook(other));
    }
  };

  /** SvelteKit keeps this page when switching to another book, so start over with the new one */
  const showBook = (next: BookDetailResponseDto) => {
    stopPolling();
    book = next;
    viewIndex = 0;
    loaded.clear();
    editor.select();
    strip?.scrollTo({ left: 0 });
    if (isBookExporting(next)) {
      startPolling();
    }
  };

  afterNavigate(() => {
    if (data.book.id !== book.id) {
      showBook(data.book);
    }
  });

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

  const handleStyleUpdated = (updated: BookDetailResponseDto) => {
    book = updated;
    loaded.clear();
  };

  const toggleReview = () => {
    if (reviewOpen) {
      closeReview();
      return;
    }
    reviewOpen = true;
    if (!review.review && !review.loading) {
      void review.reload();
    }
  };

  const closeReview = () => {
    reviewOpen = false;
    document.querySelector<HTMLElement>(`#${REVIEW_BUTTON_ID}`)?.focus();
  };

  const handleReviewGoTo = (page: number, slot?: number) => {
    const target = pages[page - 1];
    if (!target) {
      return;
    }
    highlight = slot === undefined ? undefined : { pageId: target.id, slot: slot - 1 };
    void goToPage(page - 1);
    if (mediaQueryManager.maxMd) {
      // the panel covers the page on small screens
      closeReview();
    }
  };

  // review the book again whenever it changes: only the key is tracked, not the rest of the book
  $effect(() => {
    const key = reviewKey;
    untrack(() => (key ? void review.load(book.id) : review.clear()));
  });

  $effect(() => {
    if (highlight && current.every((page) => page.id !== highlight?.pageId)) {
      highlight = undefined;
    }
  });

  const onAgentUpdate = ({ message }: AgentUpdateDto) => {
    // re-render when the assistant finishes changing this book
    if (
      message?.kind === AgentMessageKind.ToolCall &&
      message.content.status === AgentToolCallStatus.Completed &&
      message.content.bookIds?.includes(book.id)
    ) {
      const previous = book.updatedAt;
      void refresh().then((updated) => {
        // e.g. after review_book the book is the same, so the effect does not review it again
        if (updated && updated.updatedAt === previous) {
          void review.reload();
        }
      });
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
  {#snippet leading()}
    <IconButton
      href={Route.books()}
      variant="ghost"
      size="small"
      color="secondary"
      shape="round"
      icon={mdiArrowLeft}
      directional
      aria-label={$t('book_back_to_list')}
      title={$t('book_back_to_list')}
    />
  {/snippet}

  {#snippet buttons()}
    <div class="flex items-center gap-1">
      {#if books.length > 1}
        <ButtonContextMenu
          icon={mdiBookshelf}
          title={$t('book_switch')}
          color="secondary"
          size="small"
          align="top-right"
          hideContent
        >
          {#each books as other (other.id)}
            <BookMenuOption book={other} current={other.id === book.id} onClick={handleSwitchBook} />
          {/each}
        </ButtonContextMenu>
      {/if}
      <Button
        variant="ghost"
        size="small"
        color="secondary"
        leadingIcon={mdiEyeOutline}
        disabled={pages.length === 0}
        title={pages.length === 0 ? $t('book_no_pages') : undefined}
        onclick={handlePreview}
      >
        <span class="hidden sm:inline">{$t('preview')}</span>
        <span class="sr-only sm:hidden">{$t('preview')}</span>
      </Button>
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
      <Button variant="ghost" size="small" color="secondary" leadingIcon={mdiAutoFix} onclick={handleRelayout}>
        <span class="hidden sm:inline">{$t('book_relayout')}</span>
        <span class="sr-only sm:hidden">{$t('book_relayout')}</span>
      </Button>
      <BookStyleMenu {book} onUpdated={handleStyleUpdated} />
      {#if pages.length > 0}
        <Button
          id={REVIEW_BUTTON_ID}
          variant={reviewOpen ? 'filled' : 'ghost'}
          size="small"
          color="secondary"
          leadingIcon={mdiClipboardCheckOutline}
          aria-expanded={reviewOpen}
          aria-controls={reviewOpen ? REVIEW_PANEL_ID : undefined}
          onclick={toggleReview}
        >
          <span class="hidden sm:inline">{$t('book_review')}</span>
          <span class="sr-only sm:hidden">{$t('book_review')}</span>
          {#if reviewBadge > 0}
            <span
              class="min-w-5 rounded-full px-1.5 text-center text-xs/5 font-medium text-white {review.review?.counts
                .high
                ? 'bg-red-600'
                : 'bg-amber-600'}"
              aria-hidden="true"
              data-testid="book-review-badge"
            >
              {reviewBadge}
            </span>
            <span class="sr-only">{$t('book_review_badge', { values: { count: reviewBadge } })}</span>
          {/if}
        </Button>
      {/if}
      {#if isExporting || startingExport}
        <div class="flex items-center gap-2 px-2 text-sm text-gray-600 dark:text-gray-400" role="status">
          <LoadingSpinner size="small" />
          <span class="hidden md:inline">
            {#if activeExports.length > 1}
              {$t('book_exporting_all')}
            {:else if (activeExports[0] ?? startingExport) === BookExportFormat.Html}
              {$t('book_exporting_html')}
            {:else}
              {$t('book_exporting')}
            {/if}
          </span>
        </div>
      {/if}
      {#if pages.length > 0}
        <ButtonContextMenu
          icon={mdiExportVariant}
          title={$t('export')}
          color="secondary"
          size="small"
          align="top-right"
        >
          {#each BOOK_EXPORT_FORMATS as format (format)}
            {@const status = getBookExportStatus(book, format)}
            {#if status === BookExportStatus.Completed}
              <MenuOption
                icon={mdiDownload}
                text={format === BookExportFormat.Pdf ? $t('book_download_pdf') : $t('book_download_html')}
                subtitle={exportedLabel(format)}
                onClick={() => handleDownload(format)}
              />
            {/if}
            <MenuOption
              icon={format === BookExportFormat.Pdf ? mdiFilePdfBox : mdiLanguageHtml5}
              text={exportActionLabel(format, status)}
              subtitle={exportActionSubtitle(format, status)}
              onClick={() => handleExport(format)}
            />
          {/each}
        </ButtonContextMenu>
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
      <div class="flex flex-wrap justify-center gap-2">
        <Button shape="round" leadingIcon={mdiCreationOutline} onclick={handleEditWithAssistant}>
          {$t('book_edit_with_assistant')}
        </Button>
        {#if book.albumId}
          <Button shape="round" color="secondary" leadingIcon={mdiAutoFix} onclick={handleRelayout}>
            {$t('book_relayout')}
          </Button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-4 pb-6">
      <div class="flex items-center justify-between gap-2 px-2 pt-2">
        <div class="flex items-center gap-3">
          <p class="text-sm text-gray-600 dark:text-gray-400" aria-live="polite">{pageLabel}</p>
          <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400" role="status">
            {#if editor.isSaving}
              <LoadingSpinner size="small" />
              <span>{$t('book_saving')}</span>
            {/if}
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="small"
            shape="round"
            variant={editing ? 'filled' : 'ghost'}
            color={editing ? 'primary' : 'secondary'}
            leadingIcon={mdiPencilOutline}
            aria-pressed={editing}
            onclick={toggleEditing}
          >
            {$t('book_edit_pages')}
          </Button>
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
                  alt={pageImageLabel(page)}
                  class="absolute inset-0 size-full object-contain"
                  draggable="false"
                  onload={() => loaded.add(page.id)}
                  onerror={() => loaded.add(page.id)}
                />
                <BookSlotHighlight {book} {page} slot={highlight?.pageId === page.id ? highlight.slot : undefined} />
                {#if editing}
                  <BookPageEditor {editor} {page} pageNumber={pageNumber(page)} />
                {/if}
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

      {#if editing}
        <BookEditPanel {editor} pages={current} {pageNumber} />
      {:else if current.some((page) => page.sectionTitle || page.caption || page.slots.some((slot) => slot.caption))}
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

      <BookPageStrip
        bind:element={strip}
        {pages}
        {current}
        {ratio}
        {renderUrl}
        onGoToPage={goToPage}
        editor={editing ? editor : undefined}
      />
    </div>
  {/if}

  {#if reviewOpen && pages.length > 0}
    <BookReviewPanel
      id={REVIEW_PANEL_ID}
      {book}
      review={review.review}
      loading={review.loading}
      failed={review.failed}
      onRefresh={() => review.reload()}
      onGoToPage={handleReviewGoTo}
      onClose={closeReview}
    />
  {/if}
</UserPageLayout>

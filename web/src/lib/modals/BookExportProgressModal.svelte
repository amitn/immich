<script lang="ts">
  import { goto } from '$app/navigation';
  import { Route } from '$lib/route';
  import { getBookExportUrl } from '$lib/utils';
  import { getBookExportStatus, getBookFileName, isBookExporting, isExportActive } from '$lib/utils/book-export';
  import { handleError } from '$lib/utils/handle-error';
  import { BookExportFormat, BookExportStatus, exportBook, getBook, type BookDetailResponseDto } from '@immich/sdk';
  import { Alert, Button, HStack, Icon, LoadingSpinner, Modal, ModalBody, ModalFooter, Text } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiAlertOutline,
    mdiBookOpenPageVariantOutline,
    mdiCheckCircle,
    mdiDownload,
    mdiFilePdfBox,
    mdiLanguageHtml5,
    mdiOpenInNew,
    mdiRefresh,
  } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    book: BookDetailResponseDto;
    /** the exports that were requested */
    formats: BookExportFormat[];
    /** notes from laying out the book, e.g. maps drawn as sketches for lack of a Stadia Maps key */
    warnings?: string[];
    onClose: () => void;
  };

  const { book: initialBook, formats, warnings = [], onClose }: Props = $props();

  const POLL_INTERVAL = 3000;

  // svelte-ignore state_referenced_locally
  let book = $state(initialBook);
  let starting = $state<BookExportFormat>();
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const isExporting = $derived(isBookExporting(book, formats));

  const formatLabels: Record<BookExportFormat, string> = $derived({
    [BookExportFormat.Pdf]: $t('book_format_pdf'),
    [BookExportFormat.Html]: $t('book_format_html'),
  });

  const statusLabel = (status: BookExportStatus | null) => {
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

  const stopPolling = () => {
    clearInterval(pollTimer);
    pollTimer = undefined;
  };

  const poll = async () => {
    try {
      book = await getBook({ id: book.id });
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_book'), { notify: false });
      return;
    }
    if (!isBookExporting(book, formats)) {
      stopPolling();
    }
  };

  const startPolling = () => {
    if (!pollTimer) {
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL);
    }
  };

  const retry = async (format: BookExportFormat) => {
    starting = format;
    try {
      await exportBook({ id: book.id, bookExportDto: { format } });
      if (format === BookExportFormat.Html) {
        book.htmlExportStatus = BookExportStatus.Pending;
      } else {
        book.exportStatus = BookExportStatus.Pending;
      }
      startPolling();
    } catch (error) {
      handleError(error, $t('errors.unable_to_export_book'));
    } finally {
      starting = undefined;
    }
  };

  const openBook = async () => {
    onClose();
    await goto(Route.viewBook(book));
  };

  onMount(() => {
    if (isExporting) {
      startPolling();
    }
  });

  onDestroy(() => stopPolling());
</script>

<Modal title={$t('book_export_progress_title')} icon={mdiBookOpenPageVariantOutline} {onClose} size="medium">
  <ModalBody>
    <div class="flex flex-col gap-4">
      <Text size="small" color="muted">
        {$t('book_export_progress_description', { values: { title: book.title, count: book.pages.length } })}
      </Text>

      {#if warnings.length > 0}
        <Alert color="warning" icon={mdiAlertOutline} size="small" title={$t('book_layout_warnings')}>
          <ul class="flex list-disc flex-col gap-1 ps-4 text-sm" data-testid="book-layout-warnings">
            {#each warnings as warning (warning)}
              <li>{warning}</li>
            {/each}
          </ul>
        </Alert>
      {/if}

      <ul class="flex flex-col gap-2" aria-label={$t('book_exports')}>
        {#each formats as format (format)}
          {@const status = getBookExportStatus(book, format)}
          <li
            class="flex items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"
            aria-busy={isExportActive(status)}
          >
            <Icon
              icon={format === BookExportFormat.Pdf ? mdiFilePdfBox : mdiLanguageHtml5}
              size="28"
              class="shrink-0 text-primary"
              aria-hidden
            />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="text-sm font-medium">{formatLabels[format]}</span>
              <span
                class="flex items-center gap-1 text-xs {status === BookExportStatus.Failed
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-600 dark:text-gray-400'}"
                role="status"
              >
                {#if status === BookExportStatus.Completed}
                  <Icon icon={mdiCheckCircle} size="14" class="text-green-600 dark:text-green-400" aria-hidden />
                {:else if status === BookExportStatus.Failed}
                  <Icon icon={mdiAlertCircleOutline} size="14" aria-hidden />
                {/if}
                {statusLabel(status)}
              </span>
            </div>
            {#if isExportActive(status)}
              <LoadingSpinner size="small" />
            {:else if status === BookExportStatus.Completed}
              <Button
                href={getBookExportUrl({ id: book.id, format })}
                download={getBookFileName(book, format)}
                size="small"
                shape="round"
                leadingIcon={mdiDownload}
              >
                {format === BookExportFormat.Pdf ? $t('book_download_pdf') : $t('book_download_html')}
              </Button>
            {:else}
              <Button
                size="small"
                shape="round"
                variant="ghost"
                leadingIcon={mdiRefresh}
                loading={starting === format}
                disabled={starting !== undefined}
                onclick={() => retry(format)}
              >
                {$t('retry')}
              </Button>
            {/if}
          </li>
        {/each}
      </ul>

      {#if isExporting}
        <Text size="tiny" color="muted">{$t('book_export_progress_hint')}</Text>
      {/if}
    </div>
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth>
      <Button shape="round" color="secondary" fullWidth onclick={onClose}>
        {isExporting ? $t('book_close_and_continue') : $t('close')}
      </Button>
      <Button shape="round" fullWidth leadingIcon={mdiOpenInNew} onclick={openBook}>{$t('book_open')}</Button>
    </HStack>
  </ModalFooter>
</Modal>

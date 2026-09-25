<script lang="ts">
  import { getBookPreviewUrl } from '$lib/utils';
  import type { BookResponseDto } from '@immich/sdk';
  import { Button, CloseButton, Icon, LoadingSpinner, Modal, ModalBody, ModalHeader } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiOpenInNew } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    book: Pick<BookResponseDto, 'id' | 'title' | 'pageCount' | 'updatedAt'>;
    onClose: () => void;
  };

  const { book, onClose }: Props = $props();

  let frame = $state<HTMLIFrameElement>();
  let loaded = $state(false);

  // the server builds the preview on demand; the version makes the frame reload after edits
  const url = $derived(getBookPreviewUrl({ id: book.id, cacheKey: book.updatedAt }));
  const hasPages = $derived(book.pageCount > 0);

  // the modal body renders after the dialog opens: focus the frame (not the first button) once it is there
  const preventAutoFocus = (event: Event) => event.preventDefault();
  $effect(() => frame?.focus());

  const handleLoad = () => {
    loaded = true;
    // let ←/→ turn the pages right away, unless the user moved on to the header buttons meanwhile
    const active = document.activeElement;
    if (!active || active === document.body || active === frame) {
      frame?.contentWindow?.focus();
    }
  };
</script>

<Modal size="full" onClose={() => onClose()} onOpenAutoFocus={preventAutoFocus}>
  <ModalHeader>
    <div class="flex items-center gap-2">
      <Icon icon={mdiBookOpenPageVariantOutline} size="1.5rem" class="shrink-0" aria-hidden />
      <div class="flex min-w-0 grow flex-col">
        <p class="truncate text-lg font-semibold text-dark/90" title={book.title}>{book.title}</p>
        <p class="text-xs text-gray-600 dark:text-gray-400">{$t('preview')}</p>
      </div>
      {#if hasPages}
        <Button
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost"
          size="small"
          color="secondary"
          leadingIcon={mdiOpenInNew}
        >
          <span class="hidden sm:inline">{$t('open_in_new_tab')}</span>
          <span class="sr-only sm:hidden">{$t('open_in_new_tab')}</span>
        </Button>
      {/if}
      <CloseButton class="-me-2" translations={{ close: $t('close') }} onclick={() => onClose()} />
    </div>
  </ModalHeader>
  <ModalBody class="relative overflow-hidden p-0">
    {#if hasPages}
      {#if !loaded}
        <div
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-600 dark:text-gray-400"
          role="status"
        >
          <LoadingSpinner size="giant" />
          <p class="text-sm">{$t('book_preview_loading')}</p>
        </div>
      {/if}
      <!-- never allow-same-origin: the page runs its own script, and must not reach the user's session -->
      <iframe
        bind:this={frame}
        src={url}
        title={$t('book_preview_of', { values: { title: book.title } })}
        sandbox="allow-scripts"
        class="block size-full border-0 {loaded ? '' : 'opacity-0'}"
        onload={handleLoad}
      ></iframe>
    {:else}
      <div class="flex h-full items-center justify-center p-6 text-center">
        <p class="text-gray-600 dark:text-gray-400" role="alert">{$t('book_no_pages')}</p>
      </div>
    {/if}
  </ModalBody>
</Modal>

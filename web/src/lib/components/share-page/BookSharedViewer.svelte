<script lang="ts">
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import ThemeButton from '$lib/components/shared-components/ThemeButton.svelte';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { getBookPdfUrl, getBookPreviewUrl } from '$lib/utils';
  import type { SharedLinkBookResponseDto, SharedLinkResponseDto } from '@immich/sdk';
  import { Button, IconButton, LoadingSpinner, Logo } from '@immich/ui';
  import { mdiDownload } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    sharedLink: SharedLinkResponseDto;
    /** how the page was opened: the key of the link, or its custom slug */
    key?: string;
    slug?: string;
  }

  let { sharedLink, key, slug }: Props = $props();

  const book = $derived(sharedLink.book as SharedLinkBookResponseDto);
  // the key or slug in the address authenticates the frame and the download as this link, and nothing else
  const auth = $derived(slug ? { slug } : { key: key ?? sharedLink.key });
  const previewUrl = $derived(getBookPreviewUrl({ id: book.id, ...auth }));
  const pdfUrl = $derived(getBookPdfUrl({ id: book.id, ...auth }));
  const canDownload = $derived(sharedLink.allowDownload && book.hasPdf);

  let loaded = $state(false);
</script>

<main class="flex h-dvh flex-col pt-(--navbar-height) max-md:pt-(--navbar-height-md)">
  <section class="flex items-baseline gap-3 px-4 pt-2 pb-3 md:px-8">
    <h1 class="truncate text-xl text-primary md:text-3xl" title={book.title}>{book.title}</h1>
    {#if book.subtitle}
      <p class="hidden truncate text-sm text-gray-600 sm:block dark:text-gray-400">{book.subtitle}</p>
    {/if}
  </section>

  <div class="relative min-h-0 grow">
    {#if book.pageCount > 0}
      {#if !loaded}
        <div
          class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-600 dark:text-gray-400"
          role="status"
        >
          <LoadingSpinner size="giant" />
          <p class="text-sm">{$t('book_shared_loading')}</p>
        </div>
      {/if}
      <!-- never allow-same-origin: the book runs its own script, and must not reach this page or its session -->
      <iframe
        src={previewUrl}
        title={$t('book_shared_frame_title', { values: { title: book.title } })}
        sandbox="allow-scripts"
        class="block size-full border-0 {loaded ? '' : 'opacity-0'}"
        onload={() => (loaded = true)}
      ></iframe>
    {:else}
      <div class="flex h-full items-center justify-center p-6 text-center">
        <p class="text-gray-600 dark:text-gray-400" role="alert">{$t('book_no_pages')}</p>
      </div>
    {/if}
  </div>
</main>

<header>
  <ControlAppBar>
    {#snippet leading()}
      <a data-sveltekit-preload-data="hover" class="ms-4" href="/">
        <Logo variant={mediaQueryManager.maxMd ? 'icon' : 'inline'} class="min-w-10" />
      </a>
    {/snippet}

    {#snippet trailing()}
      {#if canDownload}
        {#if mediaQueryManager.maxMd}
          <IconButton
            href={pdfUrl}
            download=""
            shape="round"
            color="secondary"
            variant="ghost"
            aria-label={$t('book_download_pdf')}
            icon={mdiDownload}
          />
        {:else}
          <Button
            href={pdfUrl}
            download=""
            size="small"
            shape="round"
            color="secondary"
            variant="ghost"
            leadingIcon={mdiDownload}
          >
            {$t('book_download_pdf')}
          </Button>
        {/if}
      {/if}
      <ThemeButton />
    {/snippet}
  </ControlAppBar>
</header>

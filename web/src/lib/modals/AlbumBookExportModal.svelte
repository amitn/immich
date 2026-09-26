<script lang="ts">
  import BookMapOptions from '$lib/components/books/BookMapOptions.svelte';
  import BookStylePresetPicker from '$lib/components/books/BookStylePresetPicker.svelte';
  import BookExportProgressModal from '$lib/modals/BookExportProgressModal.svelte';
  import {
    BOOK_MAX_PAGES,
    BOOK_PAGE_SIZE_PRESETS,
    DEFAULT_BOOK_PAGE_SIZE,
    getBookPageSizePreset,
    getDefaultBookPageCount,
    normalizeBookPageCount,
    toExportFormats,
    type BookExportChoice,
    type BookPageSizePresetId,
  } from '$lib/utils/book-export';
  import { DEFAULT_BOOK_STYLE_PRESET } from '$lib/utils/book-style';
  import { handleError } from '$lib/utils/handle-error';
  import {
    BookExportFormat,
    BookExportStatus,
    BookMapStyleOption,
    BookStylePreset,
    createBookFromAlbum,
    exportBook,
    type AlbumResponseDto,
    type BookFromAlbumDto,
  } from '@immich/sdk';
  import { Field, FormModal, Icon, Input, modalManager, NumberInput, Switch, Text } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiCheckCircle } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    album: AlbumResponseDto;
    /** the style chosen when the dialog opens, e.g. food after naming the dishes of the album */
    stylePreset?: BookStylePreset;
    onClose: () => void;
  };

  const { album, stylePreset: initialStylePreset = DEFAULT_BOOK_STYLE_PRESET, onClose }: Props = $props();

  // svelte-ignore state_referenced_locally
  let title = $state(album.albumName);
  let subtitle = $state('');
  let pageSize = $state<BookPageSizePresetId>(DEFAULT_BOOK_PAGE_SIZE);
  // svelte-ignore state_referenced_locally
  let stylePreset = $state<BookStylePreset>(initialStylePreset);
  let targetPageCount = $state<number>();
  let includeMaps = $state(true);
  let mapStyle = $state<BookMapStyleOption>(BookMapStyleOption.Auto);
  let illustratedMaps = $state(false);
  let exportChoice = $state<BookExportChoice>(BookExportFormat.Pdf);
  let improvePhotos = $state(true);

  const suggestedPageCount = $derived(getDefaultBookPageCount(album.assetCount));

  const exportChoices: { value: BookExportChoice; label: string }[] = $derived([
    { value: BookExportFormat.Pdf, label: $t('book_format_pdf') },
    { value: BookExportFormat.Html, label: $t('book_format_html') },
    { value: 'both', label: $t('book_format_both') },
  ]);

  const onSubmit = async () => {
    const { widthMm, heightMm } = getBookPageSizePreset(pageSize);

    const bookFromAlbumDto: BookFromAlbumDto = {
      albumId: album.id,
      title: title.trim() || album.albumName,
      subtitle: subtitle.trim() || undefined,
      pageWidthMm: widthMm,
      pageHeightMm: heightMm,
      stylePreset,
      targetPageCount: normalizeBookPageCount(targetPageCount),
      includeMaps,
      mapStyle: includeMaps ? mapStyle : undefined,
      illustratedMaps: includeMaps && illustratedMaps,
      improvePhotos,
    };

    let book;
    try {
      book = await createBookFromAlbum({ bookFromAlbumDto });
    } catch (error) {
      handleError(error, $t('errors.unable_to_create_book'));
      return;
    }

    const formats = toExportFormats(exportChoice);
    for (const format of formats) {
      try {
        await exportBook({ id: book.id, bookExportDto: { format } });
        if (format === BookExportFormat.Html) {
          book.htmlExportStatus = BookExportStatus.Pending;
        } else {
          book.exportStatus = BookExportStatus.Pending;
        }
      } catch (error) {
        // the book exists; the export can be retried from the progress dialog
        handleError(error, $t('errors.unable_to_export_book'));
      }
    }

    onClose();
    void modalManager.show(BookExportProgressModal, { book, formats, warnings: book.warnings });
  };
</script>

<FormModal
  title={$t('book_export_album')}
  icon={mdiBookOpenPageVariantOutline}
  size="medium"
  submitText={$t('book_create')}
  disabled={album.assetCount === 0}
  {onClose}
  {onSubmit}
>
  <div class="flex flex-col gap-5">
    <Text size="small" color="muted">{$t('book_export_album_description')}</Text>

    <div class="grid gap-4 sm:grid-cols-2">
      <Field label={$t('book_title')} required>
        <Input bind:value={title} maxlength={200} />
      </Field>
      <Field label={$t('book_subtitle')}>
        <Input bind:value={subtitle} maxlength={200} placeholder={$t('book_subtitle_placeholder')} />
      </Field>
    </div>

    <fieldset>
      <legend class="mb-2 text-sm font-medium">{$t('book_page_size')}</legend>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {#each BOOK_PAGE_SIZE_PRESETS as preset (preset.id)}
          {@const checked = pageSize === preset.id}
          <label
            class="relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-3 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
              ? 'border-primary bg-primary/5'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
          >
            <input type="radio" name="book-page-size" class="sr-only" value={preset.id} bind:group={pageSize} />
            <span class="flex h-10 items-end" aria-hidden="true">
              <span
                class="block rounded-sm border-2 {checked
                  ? 'border-primary bg-primary/20'
                  : 'border-gray-400 bg-gray-100 dark:border-gray-500 dark:bg-gray-800'}"
                style:height="{(preset.heightMm / 300) * 40}px"
                style:width="{(preset.widthMm / 300) * 40}px"
              ></span>
            </span>
            <span class="flex flex-col text-xs">
              <span class="font-medium">{$t(preset.labelKey)}</span>
              <span class="whitespace-nowrap text-gray-500 dark:text-gray-400">
                {$t('book_page_size_dimensions', {
                  values: { width: preset.widthMm / 10, height: preset.heightMm / 10 },
                })}
              </span>
            </span>
            {#if checked}
              <Icon icon={mdiCheckCircle} size="16" class="absolute inset-e-2 top-2 text-primary" aria-hidden />
            {/if}
          </label>
        {/each}
      </div>
    </fieldset>

    <BookStylePresetPicker bind:value={stylePreset} pageWidthMm={getBookPageSizePreset(pageSize).widthMm} />

    <Field
      label={$t('book_target_page_count')}
      description={$t('book_target_page_count_description', {
        values: { pages: suggestedPageCount, photos: album.assetCount },
      })}
    >
      <NumberInput
        bind:value={targetPageCount}
        min={1}
        max={BOOK_MAX_PAGES}
        step={1}
        placeholder={$t('book_target_page_count_placeholder')}
      />
    </Field>

    <BookMapOptions bind:includeMaps bind:mapStyle bind:illustratedMaps />

    <Field label={$t('book_improve_photos')} description={$t('book_improve_photos_description')}>
      <Switch bind:checked={improvePhotos} />
    </Field>

    <fieldset>
      <legend class="mb-2 text-sm font-medium">{$t('book_export_format')}</legend>
      <div class="flex flex-wrap gap-2">
        {#each exportChoices as choice (choice.value)}
          {@const checked = exportChoice === choice.value}
          <label
            class="cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
          >
            <input
              type="radio"
              name="book-export-format"
              class="sr-only"
              value={choice.value}
              bind:group={exportChoice}
            />
            {choice.label}
          </label>
        {/each}
      </div>
    </fieldset>
  </div>
</FormModal>

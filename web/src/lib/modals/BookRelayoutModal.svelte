<script lang="ts">
  import BookMapOptions from '$lib/components/books/BookMapOptions.svelte';
  import {
    BOOK_MAX_PAGES,
    getDefaultBookPageCount,
    isMapPage,
    normalizeBookPageCount,
    toBookMapStyleOption,
  } from '$lib/utils/book-export';
  import { handleError } from '$lib/utils/handle-error';
  import { autoLayoutBook, type BookDetailResponseDto } from '@immich/sdk';
  import { Alert, Field, FormModal, NumberInput } from '@immich/ui';
  import { mdiAlertOutline, mdiAutoFix } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    book: BookDetailResponseDto;
    onClose: (updated?: BookDetailResponseDto) => void;
  };

  const { book, onClose }: Props = $props();

  const mapPages = $derived(book.pages.filter((page) => isMapPage(page)));
  const photoCount = $derived(
    new Set(book.pages.flatMap((page) => page.slots.flatMap(({ assetId }) => (assetId ? [assetId] : [])))).size,
  );
  const suggestedPageCount = $derived(book.pages.length || getDefaultBookPageCount(photoCount));

  let targetPageCount = $state<number>();
  // svelte-ignore state_referenced_locally
  let includeMaps = $state(book.pages.length === 0 || book.pages.some((page) => isMapPage(page)));
  // svelte-ignore state_referenced_locally
  let mapStyle = $state(toBookMapStyleOption(book.pages.find((page) => page.map)?.map?.style));
  // svelte-ignore state_referenced_locally
  let illustratedMaps = $state(book.pages.some((page) => page.map?.illustratedAssetId || page.map?.artJobId));

  const onSubmit = async () => {
    try {
      const updated = await autoLayoutBook({
        id: book.id,
        bookAutoLayoutDto: {
          targetPageCount: normalizeBookPageCount(targetPageCount),
          includeMaps,
          mapStyle: includeMaps ? mapStyle : undefined,
          illustratedMaps: includeMaps && illustratedMaps,
          keepExisting: false,
        },
      });
      onClose(updated);
    } catch (error) {
      handleError(error, $t('errors.unable_to_layout_book'));
    }
  };
</script>

<FormModal
  title={$t('book_relayout')}
  icon={mdiAutoFix}
  size="medium"
  submitText={$t('book_relayout_submit')}
  onClose={() => onClose()}
  {onSubmit}
>
  <div class="flex flex-col gap-5">
    {#if book.pages.length > 0}
      <Alert color="warning" icon={mdiAlertOutline} size="small">
        <p class="text-sm">{$t('book_relayout_warning')}</p>
      </Alert>
    {/if}

    <Field
      label={$t('book_target_page_count')}
      description={$t('book_relayout_page_count_description', {
        values: { pages: book.pages.length, maps: mapPages.length },
      })}
    >
      <NumberInput
        bind:value={targetPageCount}
        min={1}
        max={BOOK_MAX_PAGES}
        step={1}
        placeholder={String(suggestedPageCount)}
      />
    </Field>

    <BookMapOptions bind:includeMaps bind:mapStyle bind:illustratedMaps />
  </div>
</FormModal>

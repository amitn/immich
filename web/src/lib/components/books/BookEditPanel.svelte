<script lang="ts">
  import BookCaptionField from '$lib/components/books/BookCaptionField.svelte';
  import BookSlotActions from '$lib/components/books/BookSlotActions.svelte';
  import type { BookEditorManager, BookSlotRef } from '$lib/managers/book-editor-manager.svelte';
  import BookLayoutPickerModal from '$lib/modals/BookLayoutPickerModal.svelte';
  import { countPhotos } from '$lib/utils/book-geometry';
  import { isMapPage } from '$lib/utils/book-export';
  import type { BookPageResponseDto } from '@immich/sdk';
  import { Button, Text, modalManager } from '@immich/ui';
  import { mdiViewDashboardEditOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    editor: BookEditorManager;
    /** the pages in view */
    pages: BookPageResponseDto[];
    pageNumber: (page: BookPageResponseDto) => number;
  };

  const { editor, pages, pageNumber }: Props = $props();

  // every slot in view, for moving a photo without dragging it
  const slotsInView = $derived(
    pages.flatMap((page) =>
      page.slots.map((slot) => ({
        ref: { pageId: page.id, slot: slot.slot } as BookSlotRef,
        label: slot.assetId
          ? $t('book_edit_slot', { values: { page: pageNumber(page), slot: slot.slot + 1 } })
          : $t('book_edit_empty_slot', { values: { page: pageNumber(page), slot: slot.slot + 1 } }),
      })),
    ),
  );

  const handleChangeLayout = async (page: BookPageResponseDto) => {
    const layoutId = await modalManager.show(BookLayoutPickerModal, {
      title: $t('book_change_layout'),
      description: $t('book_change_layout_description', { values: { page: pageNumber(page) } }),
      layouts: editor.layouts,
      size: editor.book,
      style: editor.book.style,
      photoCount: countPhotos(page.slots),
      isMap: isMapPage(page),
      current: page.layout,
    });
    if (layoutId) {
      await editor.setLayout(page.id, layoutId);
    }
  };
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4" data-testid="book-edit-panel">
  <Text size="small" color="muted">{$t('book_edit_hint')}</Text>
  <div class="flex flex-col gap-4 sm:flex-row">
    {#each pages as page (page.id)}
      {@const number = pageNumber(page)}
      {@const layout = editor.getLayout(page.layout)}
      {@const selected = editor.selected?.pageId === page.id ? editor.getSlot(editor.selected) : undefined}
      <section class="flex min-w-0 flex-1 flex-col gap-3" aria-labelledby="book-edit-page-{page.id}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 id="book-edit-page-{page.id}" class="font-semibold">
            {$t('book_page_image', { values: { page: number } })}
            {#if layout}
              <span class="text-sm font-normal text-gray-600 dark:text-gray-400">· {layout.name}</span>
            {/if}
          </h3>
          <Button
            size="small"
            shape="round"
            color="secondary"
            variant="ghost"
            leadingIcon={mdiViewDashboardEditOutline}
            disabled={editor.layouts.length === 0}
            onclick={() => handleChangeLayout(page)}
          >
            {$t('book_change_layout')}
          </Button>
        </div>

        <BookCaptionField
          label={$t('book_section_title')}
          value={page.sectionTitle}
          maxlength={200}
          onSave={(sectionTitle) => editor.updatePage(page.id, { sectionTitle })}
        />
        <BookCaptionField
          label={$t('book_page_caption')}
          value={page.caption}
          maxlength={2000}
          multiline
          onSave={(caption) => editor.updatePage(page.id, { caption })}
        />

        {#if selected && editor.selected}
          <BookSlotActions
            {editor}
            slotRef={editor.selected}
            slot={selected}
            pageNumber={number}
            targets={slotsInView.filter(
              ({ ref }) => ref.pageId !== editor.selected?.pageId || ref.slot !== editor.selected?.slot,
            )}
          />
        {/if}
      </section>
    {/each}
  </div>
</div>

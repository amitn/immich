<script lang="ts">
  import { isSameSlot, type BookEditorManager, type BookSlotRef } from '$lib/managers/book-editor-manager.svelte';
  import { getSlotFrames, toFrameStyle } from '$lib/utils/book-geometry';
  import type { BookPageResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiImagePlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    editor: BookEditorManager;
    page: BookPageResponseDto;
    /** one-based */
    pageNumber: number;
  };

  const { editor, page, pageNumber }: Props = $props();

  const DRAG_TYPE = 'application/x-immich-book-slot';

  const layout = $derived(editor.getLayout(page.layout));
  const frames = $derived(layout ? getSlotFrames(layout, editor.book, editor.book.style) : []);

  const refOf = (slot: number): BookSlotRef => ({ pageId: page.id, slot });

  const slotLabel = (slot: number, hasPhoto: boolean) =>
    hasPhoto
      ? $t('book_edit_slot', { values: { page: pageNumber, slot: slot + 1 } })
      : $t('book_edit_empty_slot', { values: { page: pageNumber, slot: slot + 1 } });

  const ondragstart = (event: DragEvent, ref: BookSlotRef) => {
    editor.dragging = ref;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ref));
    }
  };

  const canDrop = (ref: BookSlotRef) => !!editor.dragging && !isSameSlot(editor.dragging, ref);

  const ondragover = (event: DragEvent, ref: BookSlotRef) => {
    if (!canDrop(ref)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    editor.dropTarget = ref;
  };

  const ondragleave = (ref: BookSlotRef) => {
    if (isSameSlot(editor.dropTarget, ref)) {
      editor.dropTarget = undefined;
    }
  };

  const ondrop = (event: DragEvent, ref: BookSlotRef) => {
    event.preventDefault();
    const from = editor.dragging;
    editor.dragging = undefined;
    editor.dropTarget = undefined;
    if (from && !isSameSlot(from, ref)) {
      void editor.swap(from, ref);
    }
  };

  const ondragend = () => {
    editor.dragging = undefined;
    editor.dropTarget = undefined;
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && editor.selected) {
      event.preventDefault();
      editor.select();
    }
  };
</script>

<!-- the page image is drawn by the server; these buttons sit on top of its photo slots -->
<div
  class="absolute inset-0"
  role="group"
  aria-label={$t('book_edit_page_photos', { values: { page: pageNumber } })}
  data-testid="book-page-editor"
>
  {#each page.slots as slot (slot.slot)}
    {@const frame = frames[slot.slot]}
    {@const ref = refOf(slot.slot)}
    {@const selected = isSameSlot(editor.selected, ref)}
    {@const target = isSameSlot(editor.dropTarget, ref)}
    {@const source = isSameSlot(editor.dragging, ref)}
    {#if frame}
      <button
        type="button"
        class="group absolute flex items-center justify-center transition-colors outline-none
          {selected
          ? 'ring-4 ring-primary ring-inset'
          : 'ring-2 ring-white/70 ring-inset hover:ring-primary/70 focus-visible:ring-4 focus-visible:ring-primary'}
          {target ? 'bg-primary/30' : ''} {source ? 'opacity-50' : ''}"
        style={toFrameStyle(frame)}
        aria-label={slotLabel(slot.slot, !!slot.assetId)}
        aria-pressed={selected}
        draggable={!!slot.assetId && !editor.isSaving}
        onclick={() => editor.select(ref)}
        {onkeydown}
        ondragstart={(event) => ondragstart(event, ref)}
        ondragover={(event) => ondragover(event, ref)}
        ondragenter={(event) => ondragover(event, ref)}
        ondragleave={() => ondragleave(ref)}
        ondrop={(event) => ondrop(event, ref)}
        {ondragend}
      >
        {#if !slot.assetId}
          <span
            class="flex size-8 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm dark:bg-gray-900/90"
            aria-hidden="true"
          >
            <Icon icon={mdiImagePlusOutline} size="18" />
          </span>
        {/if}
        <span
          class="absolute inset-s-1 top-1 rounded-full bg-black/60 px-1.5 text-xs font-medium text-white {selected
            ? ''
            : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}"
          aria-hidden="true"
        >
          {slot.slot + 1}
        </span>
      </button>
    {/if}
  {/each}
</div>

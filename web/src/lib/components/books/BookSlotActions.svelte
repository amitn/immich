<script lang="ts">
  import BookCaptionField from '$lib/components/books/BookCaptionField.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import type { BookEditorManager, BookSlotRef } from '$lib/managers/book-editor-manager.svelte';
  import BookAssetPickerModal from '$lib/modals/BookAssetPickerModal.svelte';
  import BookCropModal from '$lib/modals/BookCropModal.svelte';
  import type { BookSlotResponseDto } from '@immich/sdk';
  import { Button, modalManager } from '@immich/ui';
  import {
    mdiCropRotate,
    mdiImageEditOutline,
    mdiImagePlusOutline,
    mdiImageRemoveOutline,
    mdiRestore,
    mdiSwapHorizontal,
  } from '@mdi/js';
  import { tick } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    editor: BookEditorManager;
    slotRef: BookSlotRef;
    slot: BookSlotResponseDto;
    pageNumber: number;
    /** the other slots a photo can move to, e.g. the slots of the pages in view */
    targets: { ref: BookSlotRef; label: string }[];
  };

  const { editor, slotRef, slot, pageNumber, targets }: Props = $props();

  let container = $state<HTMLElement>();

  const usedAssetIds = $derived(
    editor.book.pages.flatMap((page) => page.slots.flatMap(({ assetId }) => (assetId ? [assetId] : []))),
  );

  const focusFirstAction = async () => {
    await tick();
    container?.querySelector<HTMLElement>('button')?.focus();
  };

  const handlePick = async () => {
    const assetId = await modalManager.show(BookAssetPickerModal, {
      title: slot.assetId ? $t('book_replace_photo') : $t('book_add_photo'),
      albumId: editor.book.albumId,
      usedAssetIds,
      currentAssetId: slot.assetId,
    });
    if (assetId) {
      await editor.replace(slotRef, assetId);
    }
  };

  const handleCrop = async () => {
    if (!slot.assetId) {
      return;
    }
    const result = await modalManager.show(BookCropModal, {
      assetId: slot.assetId,
      crop: slot.crop,
      slotAspect: slot.aspectRatio,
    });
    if (result) {
      await editor.updateCrop(slotRef, result.crop);
    }
  };

  const handleRemove = async () => {
    await editor.remove(slotRef);
    await focusFirstAction();
  };
</script>

<div class="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700" bind:this={container}>
  <h4 class="text-sm font-semibold">
    {slot.assetId
      ? $t('book_edit_slot', { values: { page: pageNumber, slot: slot.slot + 1 } })
      : $t('book_edit_empty_slot', { values: { page: pageNumber, slot: slot.slot + 1 } })}
  </h4>
  <div class="flex flex-wrap items-center gap-2">
    <Button
      size="small"
      shape="round"
      color="secondary"
      leadingIcon={slot.assetId ? mdiImageEditOutline : mdiImagePlusOutline}
      onclick={handlePick}
    >
      {slot.assetId ? $t('book_replace_photo') : $t('book_add_photo')}
    </Button>
    {#if slot.assetId}
      <Button size="small" shape="round" color="secondary" leadingIcon={mdiCropRotate} onclick={handleCrop}>
        {$t('book_adjust_crop')}
      </Button>
      <Button
        size="small"
        shape="round"
        color="secondary"
        variant="ghost"
        leadingIcon={mdiRestore}
        onclick={() => editor.updateCrop(slotRef, null)}
      >
        {$t('book_reset_crop')}
      </Button>
      {#if targets.length > 0}
        <ButtonContextMenu
          icon={mdiSwapHorizontal}
          title={$t('book_move_photo_to')}
          size="small"
          align="top-left"
          hideContent
        >
          {#each targets as target (`${target.ref.pageId}:${target.ref.slot}`)}
            <MenuOption text={target.label} onClick={() => editor.swap(slotRef, target.ref)} />
          {/each}
        </ButtonContextMenu>
      {/if}
      <Button
        size="small"
        shape="round"
        color="danger"
        variant="ghost"
        leadingIcon={mdiImageRemoveOutline}
        onclick={handleRemove}
      >
        {$t('book_remove_photo')}
      </Button>
    {/if}
  </div>
  {#if slot.assetId}
    {#key `${slotRef.pageId}:${slotRef.slot}`}
      <BookCaptionField
        label={$t('book_photo_caption')}
        value={slot.caption}
        maxlength={500}
        onSave={(caption) => editor.updateSlotCaption(slotRef, caption)}
      />
    {/key}
  {/if}
</div>

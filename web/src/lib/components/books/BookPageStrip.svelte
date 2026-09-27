<script lang="ts">
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import type { BookEditorManager } from '$lib/managers/book-editor-manager.svelte';
  import BookLayoutPickerModal from '$lib/modals/BookLayoutPickerModal.svelte';
  import { isMapPage } from '$lib/utils/book-export';
  import type { BookPageResponseDto } from '@immich/sdk';
  import { Icon, modalManager } from '@immich/ui';
  import {
    mdiArrowLeft,
    mdiArrowRight,
    mdiDotsVertical,
    mdiMapOutline,
    mdiPlusBoxOutline,
    mdiTrashCanOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    pages: BookPageResponseDto[];
    /** the pages in view */
    current: BookPageResponseDto[];
    /** width / height of a page */
    ratio: number;
    renderUrl: (page: BookPageResponseDto, size: number) => string;
    onGoToPage: (index: number) => void;
    /** set while editing: pages can be reordered, added and deleted */
    editor?: BookEditorManager;
    element?: HTMLElement;
  };

  let { pages, current, ratio, renderUrl, onGoToPage, editor, element = $bindable() }: Props = $props();

  const DRAG_TYPE = 'application/x-immich-book-page';

  let dragging = $state<string>();
  let dropIndex = $state<number>();

  const move = async (page: BookPageResponseDto, index: number, to: number) => {
    if (!editor || to < 0 || to >= pages.length || to === index) {
      return;
    }
    if (await editor.movePage(page.id, to)) {
      onGoToPage(to);
    }
  };

  const handleAddAfter = async (index: number) => {
    if (!editor) {
      return;
    }
    await editor.loadLayouts();
    const layout = await modalManager.show(BookLayoutPickerModal, {
      title: $t('book_add_page'),
      description: $t('book_add_page_description', { values: { page: index + 1 } }),
      layouts: editor.layouts,
      size: editor.book,
      style: editor.book.style,
    });
    if (layout && (await editor.addPage(index + 1, layout))) {
      onGoToPage(index + 1);
    }
  };

  const handleDelete = async (page: BookPageResponseDto, index: number) => {
    if (!editor) {
      return;
    }
    const confirmed = await modalManager.showDialog({
      title: $t('book_delete_page'),
      prompt: $t('book_delete_page_prompt', { values: { page: index + 1 } }),
      confirmText: $t('delete'),
      confirmColor: 'danger',
    });
    if (confirmed && (await editor.removePage(page.id))) {
      onGoToPage(Math.max(0, Math.min(index, pages.length - 1)));
    }
  };

  const ondragstart = (event: DragEvent, page: BookPageResponseDto) => {
    dragging = page.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_TYPE, page.id);
    }
  };

  const ondragover = (event: DragEvent, index: number) => {
    if (!dragging) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    dropIndex = index;
  };

  const ondrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    const pageId = dragging;
    dragging = undefined;
    dropIndex = undefined;
    const from = pages.findIndex((page) => page.id === pageId);
    if (from !== -1) {
      void move(pages[from], from, index);
    }
  };

  const ondragend = () => {
    dragging = undefined;
    dropIndex = undefined;
  };
</script>

<nav aria-label={$t('book_pages')}>
  <ul bind:this={element} class="flex immich-scrollbar gap-2 overflow-x-auto p-2">
    {#each pages as page, index (page.id)}
      {@const active = current.includes(page)}
      {@const isMap = isMapPage(page)}
      {@const isTarget = dropIndex === index && dragging !== page.id}
      <li
        class="relative shrink-0 rounded-md {isTarget ? 'ring-2 ring-primary' : ''} {dragging === page.id
          ? 'opacity-50'
          : ''}"
        draggable={!!editor && !editor.isSaving}
        ondragstart={(event) => ondragstart(event, page)}
        ondragover={(event) => ondragover(event, index)}
        ondragenter={(event) => ondragover(event, index)}
        ondragleave={() => dropIndex === index && (dropIndex = undefined)}
        ondrop={(event) => ondrop(event, index)}
        {ondragend}
      >
        <button
          type="button"
          class="flex flex-col items-center gap-1 rounded-md p-1 outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary {active
            ? 'bg-primary/15'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
          aria-current={active ? 'true' : undefined}
          aria-label={isMap
            ? $t('book_go_to_map_page', { values: { page: index + 1 } })
            : $t('book_go_to_page', { values: { page: index + 1 } })}
          onclick={() => onGoToPage(index)}
        >
          <span class="relative block">
            <img
              src={renderUrl(page, 300)}
              alt=""
              loading="lazy"
              draggable="false"
              class="h-20 bg-gray-100 object-contain shadow-sm dark:bg-gray-800 {active ? 'ring-2 ring-primary' : ''}"
              style:aspect-ratio={ratio}
            />
            {#if isMap}
              <span
                class="absolute inset-e-1 bottom-1 flex size-5 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm dark:bg-gray-900/90"
                aria-hidden="true"
              >
                <Icon icon={mdiMapOutline} size="14" />
              </span>
            {/if}
          </span>
          <span class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
            {index + 1}
            {#if isMap}
              <span class="font-medium text-primary">· {$t('book_map_page')}</span>
            {/if}
          </span>
        </button>
        {#if editor}
          <div class="absolute inset-e-0 top-0">
            <ButtonContextMenu
              icon={mdiDotsVertical}
              title={$t('book_page_actions', { values: { page: index + 1 } })}
              size="tiny"
              align="top-right"
              buttonClass="bg-white/90 dark:bg-gray-900/90 shadow-sm"
              hideContent
            >
              {#if index > 0}
                <MenuOption
                  icon={mdiArrowLeft}
                  text={$t('book_move_page_earlier')}
                  onClick={() => move(page, index, index - 1)}
                />
              {/if}
              {#if index < pages.length - 1}
                <MenuOption
                  icon={mdiArrowRight}
                  text={$t('book_move_page_later')}
                  onClick={() => move(page, index, index + 1)}
                />
              {/if}
              <MenuOption
                icon={mdiPlusBoxOutline}
                text={$t('book_add_page_after')}
                onClick={() => handleAddAfter(index)}
              />
              <MenuOption
                icon={mdiTrashCanOutline}
                text={$t('book_delete_page')}
                textColor="text-danger"
                onClick={() => handleDelete(page, index)}
              />
            </ButtonContextMenu>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</nav>

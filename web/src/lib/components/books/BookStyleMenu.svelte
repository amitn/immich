<script lang="ts">
  import BookStyleMenuAction from '$lib/components/books/BookStyleMenuAction.svelte';
  import BookStyleMenuOption from '$lib/components/books/BookStyleMenuOption.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import StyleCreatorModal from '$lib/modals/StyleCreatorModal.svelte';
  import {
    BOOK_STYLE_PRESET_LABEL_KEYS,
    findBookStylePreset,
    findBookUserStyle,
    loadBookStylePresets,
    loadBookUserStyles,
  } from '$lib/utils/book-style';
  import { handleError } from '$lib/utils/handle-error';
  import {
    updateBook,
    type BookDetailResponseDto,
    type BookStylePresetResponseDto,
    type BookUpdateDto,
    type BookUserStyleResponseDto,
  } from '@immich/sdk';
  import { modalManager, toastManager } from '@immich/ui';
  import { mdiCreationOutline, mdiPaletteSwatchOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    book: BookDetailResponseDto;
    /** Called with the book after its style changed */
    onUpdated: (book: BookDetailResponseDto) => void;
    /** Called with the name of the style being applied, and without one when applying it failed */
    onApplying?: (name?: string) => void;
  };

  const { book, onUpdated, onApplying }: Props = $props();

  let presets = $state<BookStylePresetResponseDto[]>([]);
  let userStyles = $state<BookUserStyleResponseDto[]>([]);
  let saving = $state(false);

  const current = $derived(findBookStylePreset(book.style, presets));
  // a preset wins when a style of the user's own looks exactly like it
  const currentUserStyle = $derived(current ? undefined : findBookUserStyle(book.style, userStyles));
  // the server's English texts cover presets this version does not know yet
  const presetName = (preset: BookStylePresetResponseDto) => {
    const keys = BOOK_STYLE_PRESET_LABEL_KEYS[preset.id];
    return keys ? $t(keys.name) : preset.name;
  };
  const presetDescription = (preset: BookStylePresetResponseDto) => {
    const keys = BOOK_STYLE_PRESET_LABEL_KEYS[preset.id];
    return keys ? $t(keys.description) : preset.description;
  };
  const currentName = $derived(current ? presetName(current) : (currentUserStyle?.name ?? $t('book_style_custom')));
  const canCreate = $derived(featureFlagsManager.value.assistant);

  const apply = async (name: string, bookUpdateDto: BookUpdateDto) => {
    if (saving) {
      return;
    }

    if (!current && !currentUserStyle) {
      const confirmed = await modalManager.showDialog({
        title: $t('book_style_apply'),
        prompt: $t('book_style_replace_custom_prompt', { values: { name } }),
        confirmText: $t('book_style_apply'),
      });
      if (!confirmed) {
        return;
      }
    }

    saving = true;
    onApplying?.(name);
    try {
      const updated = await updateBook({ id: book.id, bookUpdateDto });
      onUpdated(updated);
      if (!onApplying) {
        toastManager.success($t('book_style_changed', { values: { name } }));
      }
    } catch (error) {
      onApplying?.();
      handleError(error, $t('errors.unable_to_update_book'));
    } finally {
      saving = false;
    }
  };

  const handleSelect = async (preset: BookStylePresetResponseDto) => {
    if (preset.id !== current?.id) {
      await apply(presetName(preset), { stylePreset: preset.id });
    }
  };

  const handleSelectUserStyle = async (style: BookUserStyleResponseDto) => {
    if (style.id !== currentUserStyle?.id) {
      await apply(style.name, { styleId: style.id });
    }
  };

  const createWithAssistant = () => modalManager.show(StyleCreatorModal, { target: { kind: 'book', book } });

  onMount(async () => {
    try {
      presets = await loadBookStylePresets();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_book_style_presets'), { notify: false });
    }
    try {
      userStyles = await loadBookUserStyles();
    } catch (error) {
      // the presets still work without the user's own styles
      handleError(error, $t('errors.unable_to_load_book_styles'), { notify: false });
    }
  });
</script>

{#if presets.length > 0}
  <ButtonContextMenu
    icon={mdiPaletteSwatchOutline}
    title={$t('book_style_current', { values: { name: currentName } })}
    label={$t('book_style')}
    color="secondary"
    size="small"
    align="top-right"
    menuClass="dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-700 max-h-[70vh] overflow-y-auto"
    hideContent
  >
    {#if !current && !currentUserStyle}
      <BookStyleMenuOption
        name={$t('book_style_custom')}
        description={$t('book_style_custom_description')}
        style={book.style}
        pageWidthMm={book.pageWidthMm}
        checked
        disabled
      />
    {/if}
    {#each presets as preset (preset.id)}
      <BookStyleMenuOption
        name={presetName(preset)}
        description={presetDescription(preset)}
        style={preset.style}
        pageWidthMm={book.pageWidthMm}
        checked={preset.id === current?.id}
        disabled={saving}
        onClick={() => handleSelect(preset)}
      />
    {/each}
    {#if userStyles.length > 0}
      <li
        role="presentation"
        class="border-t border-gray-200 bg-slate-100 px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-400"
      >
        {$t('book_style_yours')}
      </li>
      {#each userStyles as style (style.id)}
        <BookStyleMenuOption
          name={style.name}
          description={style.description || undefined}
          style={style.style}
          pageWidthMm={book.pageWidthMm}
          checked={style.id === currentUserStyle?.id}
          disabled={saving}
          onClick={() => handleSelectUserStyle(style)}
        />
      {/each}
    {/if}
    {#if canCreate}
      <BookStyleMenuAction
        text={$t('style_creator_create_with_assistant')}
        icon={mdiCreationOutline}
        onClick={createWithAssistant}
      />
    {/if}
  </ButtonContextMenu>
{/if}

<script lang="ts">
  import BookStyleMenuOption from '$lib/components/books/BookStyleMenuOption.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import { BOOK_STYLE_PRESET_LABEL_KEYS, findBookStylePreset, loadBookStylePresets } from '$lib/utils/book-style';
  import { handleError } from '$lib/utils/handle-error';
  import { updateBook, type BookDetailResponseDto, type BookStylePresetResponseDto } from '@immich/sdk';
  import { modalManager, toastManager } from '@immich/ui';
  import { mdiPaletteSwatchOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    book: BookDetailResponseDto;
    /** Called with the book after its style changed */
    onUpdated: (book: BookDetailResponseDto) => void;
  };

  const { book, onUpdated }: Props = $props();

  let presets = $state<BookStylePresetResponseDto[]>([]);
  let saving = $state(false);

  const current = $derived(findBookStylePreset(book.style, presets));
  // the server's English texts cover presets this version does not know yet
  const presetName = (preset: BookStylePresetResponseDto) => {
    const keys = BOOK_STYLE_PRESET_LABEL_KEYS[preset.id];
    return keys ? $t(keys.name) : preset.name;
  };
  const presetDescription = (preset: BookStylePresetResponseDto) => {
    const keys = BOOK_STYLE_PRESET_LABEL_KEYS[preset.id];
    return keys ? $t(keys.description) : preset.description;
  };
  const currentName = $derived(current ? presetName(current) : $t('book_style_custom'));

  const handleSelect = async (preset: BookStylePresetResponseDto) => {
    if (saving || preset.id === current?.id) {
      return;
    }

    if (!current) {
      const confirmed = await modalManager.showDialog({
        title: $t('book_style_apply'),
        prompt: $t('book_style_replace_custom_prompt', { values: { name: presetName(preset) } }),
        confirmText: $t('book_style_apply'),
      });
      if (!confirmed) {
        return;
      }
    }

    saving = true;
    try {
      const updated = await updateBook({ id: book.id, bookUpdateDto: { stylePreset: preset.id } });
      onUpdated(updated);
      toastManager.success($t('book_style_changed', { values: { name: presetName(preset) } }));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_book'));
    } finally {
      saving = false;
    }
  };

  onMount(async () => {
    try {
      presets = await loadBookStylePresets();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_book_style_presets'), { notify: false });
    }
  });
</script>

{#if presets.length > 0}
  <ButtonContextMenu
    icon={mdiPaletteSwatchOutline}
    title={$t('book_style_current', { values: { name: currentName } })}
    color="secondary"
    size="small"
    align="top-right"
    hideContent
  >
    {#if !current}
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
  </ButtonContextMenu>
{/if}

<script lang="ts">
  import BookStyleSwatch from '$lib/components/books/BookStyleSwatch.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import StyleCreatorModal from '$lib/modals/StyleCreatorModal.svelte';
  import { loadBookUserStyles } from '$lib/utils/book-style';
  import { handleError } from '$lib/utils/handle-error';
  import { deleteBookUserStyle, updateBookUserStyle, type BookUserStyleResponseDto } from '@immich/sdk';
  import {
    Button,
    IconButton,
    Input,
    LoadingSpinner,
    Modal,
    ModalBody,
    Text,
    modalManager,
    toastManager,
  } from '@immich/ui';
  import { mdiContentSaveOutline, mdiCreationOutline, mdiDeleteOutline, mdiPaletteSwatchOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    onClose: () => void;
  };

  const { onClose }: Props = $props();

  let styles = $state<BookUserStyleResponseDto[]>([]);
  let names = $state<Record<string, string>>({});
  let isLoading = $state(true);
  let busy = $state<string>();

  const isRenamed = (style: BookUserStyleResponseDto) => {
    const name = names[style.id]?.trim();
    return !!name && name !== style.name;
  };

  const rename = async (style: BookUserStyleResponseDto) => {
    if (!isRenamed(style) || busy) {
      return;
    }
    busy = style.id;
    try {
      const updated = await updateBookUserStyle({
        id: style.id,
        bookUserStyleUpdateDto: { name: names[style.id].trim() },
      });
      styles = styles.map((item) => (item.id === updated.id ? updated : item));
      names[updated.id] = updated.name;
      toastManager.success($t('book_style_renamed', { values: { name: updated.name } }));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_book_style'));
    } finally {
      busy = undefined;
    }
  };

  const remove = async (style: BookUserStyleResponseDto) => {
    const confirmed = await modalManager.showDialog({
      title: $t('book_style_delete'),
      prompt: $t('book_style_delete_prompt', { values: { name: style.name } }),
      confirmText: $t('delete'),
    });
    if (!confirmed) {
      return;
    }
    busy = style.id;
    try {
      await deleteBookUserStyle({ id: style.id });
      styles = styles.filter(({ id }) => id !== style.id);
      toastManager.success($t('book_style_deleted', { values: { name: style.name } }));
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_book_style'));
    } finally {
      busy = undefined;
    }
  };

  const createWithAssistant = () => {
    onClose();
    void modalManager.show(StyleCreatorModal, { target: { kind: 'book' } });
  };

  onMount(async () => {
    try {
      styles = await loadBookUserStyles();
      names = Object.fromEntries(styles.map(({ id, name }) => [id, name]));
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_book_styles'));
    } finally {
      isLoading = false;
    }
  });
</script>

<Modal title={$t('book_style_manage')} icon={mdiPaletteSwatchOutline} {onClose} size="medium">
  <ModalBody>
    {#if isLoading}
      <div class="flex justify-center py-6"><LoadingSpinner size="large" /></div>
    {:else if styles.length === 0}
      <div class="flex flex-col items-center gap-3 py-4 text-center">
        <Text size="small" color="muted">{$t('book_style_manage_empty')}</Text>
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        <Text size="small" color="muted">{$t('book_style_manage_description')}</Text>
        <ul class="flex flex-col gap-2">
          {#each styles as style (style.id)}
            <li class="flex items-center gap-3">
              <BookStyleSwatch style={style.style} size={40} />
              <form
                class="flex min-w-0 grow items-center gap-1"
                onsubmit={(event) => {
                  event.preventDefault();
                  void rename(style);
                }}
              >
                <Input
                  bind:value={names[style.id]}
                  maxlength={100}
                  aria-label={$t('book_style_name_of', { values: { name: style.name } })}
                  disabled={busy === style.id}
                />
                {#if isRenamed(style)}
                  <IconButton
                    type="submit"
                    icon={mdiContentSaveOutline}
                    size="small"
                    shape="round"
                    color="primary"
                    variant="ghost"
                    aria-label={$t('book_style_rename_named', { values: { name: style.name } })}
                    disabled={busy === style.id}
                  />
                {/if}
              </form>
              <IconButton
                icon={mdiDeleteOutline}
                size="small"
                shape="round"
                color="secondary"
                variant="ghost"
                aria-label={$t('book_style_delete_named', { values: { name: style.name } })}
                disabled={busy === style.id}
                onclick={() => remove(style)}
              />
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if featureFlagsManager.value.assistant}
      <div class="mt-4 flex justify-center">
        <Button
          size="small"
          variant="ghost"
          shape="round"
          leadingIcon={mdiCreationOutline}
          onclick={createWithAssistant}
        >
          {$t('style_creator_create_with_assistant')}
        </Button>
      </div>
    {/if}
  </ModalBody>
</Modal>

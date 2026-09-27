<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon, IconButton, Textarea } from '@immich/ui';
  import { mdiClose, mdiSend, mdiStop } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    value: string;
    contextAssetIds: string[];
    running?: boolean;
    sending?: boolean;
    disabled?: boolean;
    textarea?: HTMLTextAreaElement | null;
    onSend: () => void;
    onStop: () => void;
  };

  let {
    value = $bindable(''),
    contextAssetIds = $bindable([]),
    running = false,
    sending = false,
    disabled = false,
    textarea = $bindable(null),
    onSend,
    onStop,
  }: Props = $props();

  const CHIP_LIMIT = 12;

  const canSend = $derived(!disabled && !running && !sending && value.trim().length > 0);
  const hiddenChips = $derived(Math.max(0, contextAssetIds.length - CHIP_LIMIT));

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  };

  const onsubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  };

  const removeAsset = (id: string) => {
    contextAssetIds = contextAssetIds.filter((assetId) => assetId !== id);
  };
</script>

<form class="flex flex-col gap-2 px-3 pt-2 pb-3" {onsubmit}>
  {#if contextAssetIds.length > 0}
    <div class="flex flex-wrap items-center gap-1.5" role="list" aria-label={$t('assistant_attached_photos')}>
      <span class="me-1 text-xs text-gray-600 dark:text-gray-400">
        {$t('assistant_photos_count', { values: { count: contextAssetIds.length } })}
      </span>
      {#each contextAssetIds.slice(0, CHIP_LIMIT) as id, index (id)}
        <div role="listitem" class="group relative">
          <img
            src={getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail })}
            alt={$t('assistant_attached_photo', { values: { index: index + 1 } })}
            class="size-10 rounded-md bg-gray-200 object-cover dark:bg-gray-700"
            draggable="false"
          />
          <button
            type="button"
            class="absolute -inset-e-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-dark text-light opacity-80 hover:opacity-100 focus-visible:opacity-100"
            aria-label={$t('assistant_remove_attached_photo', { values: { index: index + 1 } })}
            onclick={() => removeAsset(id)}
          >
            <Icon icon={mdiClose} size="14" aria-hidden />
          </button>
        </div>
      {/each}
      {#if hiddenChips > 0}
        <span class="text-xs text-gray-600 dark:text-gray-400">+{hiddenChips}</span>
      {/if}
      <button
        type="button"
        class="ms-1 text-xs text-primary underline-offset-2 hover:underline"
        onclick={() => (contextAssetIds = [])}
      >
        {$t('clear_all')}
      </button>
    </div>
  {/if}

  <div
    class="flex items-end gap-1 rounded-3xl border border-gray-200 bg-gray-50 p-1.5 ps-4 focus-within:border-primary dark:border-gray-700 dark:bg-gray-900"
  >
    <Textarea
      bind:ref={textarea}
      bind:value
      rows={1}
      grow
      variant="ghost"
      {disabled}
      {onkeydown}
      aria-label={$t('assistant_message_input')}
      placeholder={$t('assistant_input_placeholder')}
      class="max-h-48 w-full resize-none overflow-y-auto bg-transparent py-2 text-sm ring-0! outline-none"
    />
    {#if running}
      <IconButton
        shape="round"
        color="danger"
        icon={mdiStop}
        aria-label={$t('assistant_stop')}
        title={$t('assistant_stop')}
        onclick={onStop}
      />
    {:else}
      <IconButton
        type="submit"
        shape="round"
        icon={mdiSend}
        loading={sending}
        disabled={!canSend}
        aria-label={$t('send_message')}
        title={$t('send_message')}
      />
    {/if}
  </div>
  <p class="px-4 text-xs text-gray-500 dark:text-gray-400">{$t('assistant_input_hint')}</p>
</form>

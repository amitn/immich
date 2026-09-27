<script lang="ts">
  import { Button, Icon } from '@immich/ui';
  import { mdiBookPlusOutline, mdiCheck, mdiClose, mdiCreationOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    /** the assistant is available to polish the draft */
    assistant: boolean;
    busy?: boolean;
    onKeep: () => void;
    onDiscard: () => void;
    onPolish: () => void;
  };

  const { assistant, busy = false, onKeep, onDiscard, onPolish }: Props = $props();
</script>

<div
  class="mx-2 mt-2 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between"
  role="region"
  aria-label={$t('book_draft_banner_label')}
  data-testid="book-draft-banner"
>
  <div class="flex items-center gap-3">
    <Icon icon={mdiBookPlusOutline} size="24" class="shrink-0 text-primary" aria-hidden />
    <p class="text-sm">{$t('book_draft_banner')}</p>
  </div>
  <div class="flex flex-wrap gap-2">
    <Button size="small" shape="round" leadingIcon={mdiCheck} disabled={busy} onclick={onKeep}>
      {$t('book_draft_keep')}
    </Button>
    <Button
      size="small"
      shape="round"
      variant="ghost"
      color="secondary"
      leadingIcon={mdiClose}
      disabled={busy}
      onclick={onDiscard}
    >
      {$t('book_draft_discard')}
    </Button>
    {#if assistant}
      <Button
        size="small"
        shape="round"
        variant="outline"
        color="secondary"
        leadingIcon={mdiCreationOutline}
        disabled={busy}
        onclick={onPolish}
      >
        {$t('book_draft_polish')}
      </Button>
    {/if}
  </div>
</div>

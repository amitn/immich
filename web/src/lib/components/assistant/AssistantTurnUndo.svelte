<script lang="ts">
  import type { ActivityLogResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { mdiUndo } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    /** the changes of the turn */
    changes: ActivityLogResponseDto[];
    busy?: boolean;
    onUndo: () => unknown;
  };

  const { changes, busy = false, onUndo }: Props = $props();

  const undoable = $derived(changes.filter((change) => change.canUndo).length);
</script>

{#if undoable > 0}
  <div
    class="flex items-center justify-between gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-400"
    data-testid="assistant-turn-undo"
  >
    <span>{$t('activity_log_turn_changes', { values: { count: changes.length } })}</span>
    <Button
      size="tiny"
      variant="ghost"
      color="secondary"
      leadingIcon={mdiUndo}
      loading={busy}
      disabled={busy}
      onclick={onUndo}
    >
      {$t('activity_log_undo_turn')}
    </Button>
  </div>
{/if}

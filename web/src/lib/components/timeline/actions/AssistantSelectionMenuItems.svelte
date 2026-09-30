<script lang="ts">
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import type { AssistantSelectionActions } from '$lib/services/assistant-selection.service';

  /** The assistant's actions of a selection in the ⋮ menu of its bar; its Ask assistant is a button of the bar */
  type Props = {
    actions: AssistantSelectionActions;
  };

  const { actions }: Props = $props();
</script>

{#each actions.NameActions as action (action.title)}
  <ActionMenuItem {action} />
{/each}
<ActionMenuItem action={actions.MakeHighlightVideo} />
<ActionMenuItem action={actions.MakeCollage} />
<ActionMenuItem action={actions.ArtisticStyle} />
<ActionMenuItem action={actions.AutoEnhance} />

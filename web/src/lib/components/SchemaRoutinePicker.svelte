<script lang="ts">
  import { Route } from '$lib/route';
  import { getRoutines, type RoutineResponseDto } from '@immich/sdk';
  import { Field, HelperText, Select } from '@immich/ui';
  import { t } from 'svelte-i18n';

  /** The routine of the "Send to assistant routine" workflow step (#15): one of the user's routines */
  type Props = {
    label: string;
    description?: string;
    routineId: string;
  };

  let { label, description, routineId = $bindable('') }: Props = $props();

  let routines = $state<RoutineResponseDto[]>([]);
  let loaded = $state(false);

  $effect(() => {
    const load = async () => {
      try {
        routines = await getRoutines();
      } catch {
        // a workflow outlives its routine: the step keeps its id until another is picked
        routines = [];
      } finally {
        loaded = true;
      }
    };
    void load();
  });

  const options = $derived([
    { value: '', label: $t('routine_select'), disabled: true },
    ...routines.map((routine) => ({ value: routine.id, label: routine.name })),
    ...(routineId && loaded && routines.every(({ id }) => id !== routineId)
      ? [{ value: routineId, label: $t('routine_unavailable') }]
      : []),
  ]);
</script>

<Field {label} {description}>
  <Select {options} bind:value={routineId} />
  {#if loaded && routines.length === 0}
    <HelperText>
      <a class="underline" href={Route.routines()}>{$t('routine_select_none')}</a>
    </HelperText>
  {/if}
</Field>

<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import RoutineChangeList from '$lib/components/routines/RoutineChangeList.svelte';
  import RoutineSummary from '$lib/components/routines/RoutineSummary.svelte';
  import { Route } from '$lib/route';
  import { decideRoutineChanges, openRoutineEditor, runRoutineNow } from '$lib/services/routine.service';
  import { handleError } from '$lib/utils/handle-error';
  import { getRoutineInbox, getRoutines, type RoutineApprovalResponseDto, type RoutineResponseDto } from '@immich/sdk';
  import { Alert, Button, Card, CardBody, Container, Heading, Text } from '@immich/ui';
  import { mdiFlaskOutline, mdiPlay, mdiPlus } from '@mdi/js';
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  // svelte-ignore state_referenced_locally
  let routines = $state<RoutineResponseDto[]>(data.routines);
  // svelte-ignore state_referenced_locally
  let inbox = $state<RoutineApprovalResponseDto[]>(data.inbox);
  const deciding = new SvelteSet<string>();
  let inboxSection = $state<HTMLElement>();

  const refresh = async () => {
    try {
      [routines, inbox] = await Promise.all([getRoutines(), getRoutineInbox()]);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_routines'));
    }
  };

  const create = async () => {
    if (await openRoutineEditor()) {
      await refresh();
    }
  };

  const decide = async (ids: string[], approve: boolean) => {
    for (const id of ids) {
      deciding.add(id);
    }
    try {
      if (await decideRoutineChanges({ ids }, approve)) {
        await refresh();
      }
    } finally {
      for (const id of ids) {
        deciding.delete(id);
      }
    }
  };

  onMount(async () => {
    if (data.loadError) {
      handleError(data.loadError, $t('errors.unable_to_load_routines'));
    }
    if (data.showInbox) {
      await tick();
      inboxSection?.scrollIntoView({ behavior: 'smooth' });
    }
  });
</script>

<UserPageLayout title={data.meta.title} description={$t('routines_description')}>
  {#snippet buttons()}
    {#if data.config}
      <Button size="small" variant="ghost" color="secondary" leadingIcon={mdiPlus} onclick={create}>
        {$t('routine_new')}
      </Button>
    {/if}
  {/snippet}

  <section class="flex place-content-center sm:mx-4">
    <Container center size="large" class="flex flex-col gap-6 pt-4 pb-28">
      {#if !data.config}
        <Alert color="info" title={$t('assistant_disabled_title')}>
          <p class="text-sm">{$t('assistant_disabled_description')}</p>
        </Alert>
      {:else}
        {#if !data.config.enabled}
          <Alert color="warning">{$t('routines_disabled')}</Alert>
        {/if}

        <section bind:this={inboxSection} class="flex flex-col gap-3" aria-labelledby="routines-inbox">
          <Heading size="tiny" tag="h2" id="routines-inbox">
            {$t('routines_inbox')}
            {#if inbox.length > 0}
              <span class="text-primary">({inbox.length})</span>
            {/if}
          </Heading>
          {#if inbox.length === 0}
            <Text size="small" color="muted">{$t('routines_inbox_empty')}</Text>
          {:else}
            <RoutineChangeList changes={inbox} busy={deciding} showRun onDecide={decide} />
          {/if}
        </section>

        <section class="flex flex-col gap-3" aria-labelledby="routines-list">
          <Heading size="tiny" tag="h2" id="routines-list">{$t('routines')}</Heading>
          {#if routines.length === 0}
            <Card>
              <CardBody class="flex flex-col items-start gap-3">
                <Text fontWeight="semi-bold">{$t('routines_empty_title')}</Text>
                <Text size="small" color="muted">{$t('routines_empty_description')}</Text>
                <Button size="small" leadingIcon={mdiPlus} onclick={create}>{$t('routine_new')}</Button>
              </CardBody>
            </Card>
          {:else}
            <ul class="flex flex-col gap-3">
              {#each routines as routine (routine.id)}
                <li>
                  <Card>
                    <CardBody class="flex flex-col gap-3">
                      <RoutineSummary {routine} href={Route.viewRoutine(routine)} />
                      <div class="flex flex-wrap gap-2">
                        <Button
                          size="small"
                          leadingIcon={mdiPlay}
                          disabled={!data.config.enabled || !!routine.pausedAt}
                          onclick={() => runRoutineNow(routine).then(refresh)}
                        >
                          {$t('routine_run_now')}
                        </Button>
                        <Button
                          size="small"
                          variant="outline"
                          color="secondary"
                          leadingIcon={mdiFlaskOutline}
                          disabled={!data.config.enabled || !!routine.pausedAt}
                          onclick={() => runRoutineNow(routine, { dryRun: true }).then(refresh)}
                        >
                          {$t('routine_dry_run')}
                        </Button>
                        <Button size="small" variant="ghost" color="secondary" href={Route.viewRoutine(routine)}>
                          {$t('routine_history')}
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </Container>
  </section>
</UserPageLayout>

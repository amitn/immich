<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import { Route } from '$lib/route';
  import { changeStatusKeys } from '$lib/utils/routines';
  import { RoutineApprovalStatus, type RoutineApprovalResponseDto } from '@immich/sdk';
  import { Badge, Button } from '@immich/ui';
  import { mdiCheck, mdiClose } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    /** the changes, grouped by their run in the order given */
    changes: RoutineApprovalResponseDto[];
    /** the changes being decided */
    busy?: ReadonlySet<string>;
    /** show the routine and a link to the run of each group (the inbox) */
    showRun?: boolean;
    onDecide: (ids: string[], approve: boolean) => unknown;
  };

  const { changes, busy = new Set<string>(), showRun = false, onDecide }: Props = $props();

  const groups = $derived.by(() => {
    const byRun: Array<{ runId: string; routineName?: string; items: RoutineApprovalResponseDto[] }> = [];
    for (const change of changes) {
      const group = byRun.find(({ runId }) => runId === change.runId);
      if (group) {
        group.items.push(change);
      } else {
        byRun.push({ runId: change.runId, routineName: change.routineName, items: [change] });
      }
    }
    return byRun;
  });

  const pendingIds = (items: RoutineApprovalResponseDto[]) =>
    items.filter(({ status }) => status === RoutineApprovalStatus.Pending).map(({ id }) => id);

  const statusColor = (status: RoutineApprovalStatus) =>
    status === RoutineApprovalStatus.Applied
      ? 'success'
      : status === RoutineApprovalStatus.Failed
        ? 'danger'
        : status === RoutineApprovalStatus.Pending
          ? 'warning'
          : 'secondary';

  const formatDate = (value: string) => DateTime.fromISO(value).toLocaleString(DateTime.DATETIME_MED);
</script>

<div class="flex flex-col gap-4" data-testid="routine-changes">
  {#each groups as group (group.runId)}
    {@const pending = pendingIds(group.items)}
    <section class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        {#if showRun}
          <a href={Route.viewRoutineRun({ id: group.runId })} class="text-sm font-medium underline">
            {group.routineName ?? $t('routine_run')}
          </a>
        {:else}
          <span></span>
        {/if}
        {#if pending.length > 1}
          <div class="flex gap-1">
            <Button
              size="tiny"
              color="success"
              leadingIcon={mdiCheck}
              disabled={pending.some((id) => busy.has(id))}
              onclick={() => onDecide(pending, true)}
            >
              {$t('routine_approve_all')}
            </Button>
            <Button
              size="tiny"
              variant="ghost"
              color="secondary"
              leadingIcon={mdiClose}
              disabled={pending.some((id) => busy.has(id))}
              onclick={() => onDecide(pending, false)}
            >
              {$t('routine_deny_all')}
            </Button>
          </div>
        {/if}
      </div>
      <ul class="flex flex-col gap-2">
        {#each group.items as change (change.id)}
          <li
            class="flex flex-col gap-2 rounded-xl border border-gray-200 bg-subtle px-3 py-2.5 text-sm dark:border-gray-700"
            data-testid="routine-change"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="font-medium">{change.title}</span>
                {#if change.summary}
                  <span class="text-xs text-gray-600 dark:text-gray-400">{change.summary}</span>
                {/if}
              </div>
              <Badge size="small" color={statusColor(change.status)}>{$t(changeStatusKeys[change.status])}</Badge>
            </div>
            <AssistantAssetStrip assetIds={change.assetIds} size="small" limit={8} />
            {#if change.result && change.status !== RoutineApprovalStatus.Pending}
              <p class="text-xs wrap-break-word text-gray-600 dark:text-gray-400">{change.result}</p>
            {/if}
            {#if change.status === RoutineApprovalStatus.Pending}
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {$t('routine_expires', { values: { date: formatDate(change.expiresAt) } })}
                </span>
                <div class="flex gap-1">
                  <Button
                    size="tiny"
                    color="success"
                    leadingIcon={mdiCheck}
                    loading={busy.has(change.id)}
                    disabled={busy.has(change.id)}
                    onclick={() => onDecide([change.id], true)}
                  >
                    {$t('routine_approve')}
                  </Button>
                  <Button
                    size="tiny"
                    variant="ghost"
                    color="secondary"
                    leadingIcon={mdiClose}
                    disabled={busy.has(change.id)}
                    onclick={() => onDecide([change.id], false)}
                  >
                    {$t('routine_deny')}
                  </Button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<script lang="ts">
  import { Route } from '$lib/route';
  import { describeTrigger, runStatusColors, runStatusKeys } from '$lib/utils/routines';
  import { RoutineApprovalMode, type RoutineResponseDto } from '@immich/sdk';
  import { Badge, Text } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    routine: RoutineResponseDto;
    /** the name links here */
    href?: string;
  };

  const { routine, href }: Props = $props();

  const formatDate = (value: string) => DateTime.fromISO(value).toLocaleString(DateTime.DATETIME_MED);

  const approvalKeys = {
    [RoutineApprovalMode.Ask]: 'routine_approval_ask',
    [RoutineApprovalMode.AutoSafe]: 'routine_approval_auto_safe',
    [RoutineApprovalMode.DryRun]: 'routine_approval_dry_run',
  } as const;
</script>

<div class="flex flex-col gap-1.5" data-testid="routine-summary">
  <div class="flex flex-wrap items-center gap-2">
    {#if href}
      <a {href} class="font-medium hover:underline">{routine.name}</a>
    {:else}
      <span class="font-medium">{routine.name}</span>
    {/if}
    <Badge size="small" color="secondary">{$t(approvalKeys[routine.approvalMode])}</Badge>
    {#if routine.pausedAt}
      <Badge size="small" color="danger">
        {$t('routine_paused', { values: { count: routine.consecutiveFailures } })}
      </Badge>
    {:else if !routine.enabled}
      <Badge size="small" color="secondary">{$t('routine_off')}</Badge>
    {/if}
  </div>
  <Text size="small">{describeTrigger($t, routine.trigger, $locale ?? undefined)}</Text>
  <Text size="tiny" color="muted" class="line-clamp-2">{routine.instruction}</Text>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
    {#if routine.lastRun}
      <a href={Route.viewRoutineRun(routine.lastRun)} class="flex items-center gap-1 hover:underline">
        {$t('routine_last_run', { values: { date: formatDate(routine.lastRun.createdAt) } })}
        <Badge size="tiny" color={runStatusColors[routine.lastRun.status]}>
          {$t(runStatusKeys[routine.lastRun.status])}
        </Badge>
      </a>
    {:else}
      <span>{$t('routine_never_ran')}</span>
    {/if}
    {#if routine.nextRunAt && routine.enabled && !routine.pausedAt}
      <span>{$t('routine_next_run', { values: { date: formatDate(routine.nextRunAt) } })}</span>
    {/if}
    {#if routine.pendingEvents > 0}
      <span>{$t('routine_pending_events', { values: { count: routine.pendingEvents } })}</span>
    {/if}
    {#if routine.pendingApprovals > 0}
      <a href={Route.routines({ tab: 'inbox' })} class="font-medium text-primary hover:underline">
        {$t('routine_run_pending', { values: { count: routine.pendingApprovals } })}
      </a>
    {/if}
  </div>
</div>

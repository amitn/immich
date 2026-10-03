import {
  RoutineApprovalStatus,
  RoutineEvent,
  RoutineRunStatus,
  RoutineTriggerType,
  type RoutineTriggerDto,
} from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

/**
 * Assistant routines (#15) in the web: the schedule of the editor (every day, every week at a time, or a cron
 * expression) and how a trigger, a run and a change are described.
 */

export type ScheduleKind = 'daily' | 'weekly' | 'custom';

export type Schedule = {
  kind: ScheduleKind;
  /** HH:MM */
  time: string;
  /** 0 is Sunday, as in cron */
  weekday: number;
  /** the expression of a custom schedule */
  cron: string;
};

export const DEFAULT_SCHEDULE: Schedule = { kind: 'daily', time: '02:00', weekday: 0, cron: '0 2 * * *' };

const pad = (value: number) => String(value).padStart(2, '0');

/** the cron expression of a schedule */
export const toCron = ({ kind, time, weekday, cron }: Schedule) => {
  if (kind === 'custom') {
    return cron.trim();
  }
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return `${minute} ${hour} * * ${kind === 'weekly' ? weekday : '*'}`;
};

const SIMPLE = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/;

/** the schedule of a cron expression: every day or every week at a time, or custom */
export const parseCron = (cron: string | undefined): Schedule => {
  if (!cron) {
    return { ...DEFAULT_SCHEDULE };
  }
  const match = SIMPLE.exec(cron.trim().replaceAll(/\s+/g, ' '));
  const minute = Number(match?.[1]);
  const hour = Number(match?.[2]);
  if (!match || minute > 59 || hour > 23) {
    return { ...DEFAULT_SCHEDULE, kind: 'custom', cron };
  }
  const time = `${pad(hour)}:${pad(minute)}`;
  return match[3] === '*'
    ? { kind: 'daily', time, weekday: 0, cron }
    : { kind: 'weekly', time, weekday: Number(match[3]), cron };
};

/** the time zone of the browser, which a schedule runs in */
export const getBrowserTimeZone = () => {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/** a Sunday, to name the days of the week */
const SUNDAY = Date.UTC(2026, 9, 4, 12);

export const getWeekdayName = (weekday: number, locale?: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(SUNDAY + weekday * 86_400_000));

export const formatTime = (time: string, locale?: string) => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 0, 1, hour, minute)),
  );
};

export const routineEventKeys: Record<RoutineEvent, Translations> = {
  [RoutineEvent.Upload]: 'routine_event_upload',
  [RoutineEvent.JournalVisit]: 'routine_event_journal_visit',
  [RoutineEvent.Tag]: 'routine_event_tag',
  [RoutineEvent.Trip]: 'routine_event_trip',
  [RoutineEvent.BookDraft]: 'routine_event_book_draft',
  [RoutineEvent.Workflow]: 'routine_event_workflow',
};

type Translate = (key: Translations, options?: { values?: Record<string, string | number> }) => string;

/** "Every day at 2:00 AM", "Every Sunday at 9:00 AM", "After: new photos uploaded (tag print)", "Only when I run it" */
export const describeTrigger = (t: Translate, trigger: RoutineTriggerDto, locale?: string) => {
  switch (trigger.type) {
    case RoutineTriggerType.Schedule: {
      const schedule = parseCron(trigger.cron);
      if (schedule.kind === 'daily') {
        return t('routine_schedule_daily_at', { values: { time: formatTime(schedule.time, locale) } });
      }
      if (schedule.kind === 'weekly') {
        return t('routine_schedule_weekly_at', {
          values: { day: getWeekdayName(schedule.weekday, locale), time: formatTime(schedule.time, locale) },
        });
      }
      return t('routine_schedule_cron_at', { values: { cron: trigger.cron ?? '' } });
    }
    case RoutineTriggerType.Event: {
      const event = trigger.event ? t(routineEventKeys[trigger.event]) : '';
      const filter = trigger.tag ?? trigger.pack;
      return filter ? `${event} (${filter})` : event;
    }
    default: {
      return t('routine_trigger_manual');
    }
  }
};

export const runStatusKeys: Record<RoutineRunStatus, Translations> = {
  [RoutineRunStatus.Queued]: 'routine_run_status_queued',
  [RoutineRunStatus.Running]: 'routine_run_status_running',
  [RoutineRunStatus.Succeeded]: 'routine_run_status_succeeded',
  [RoutineRunStatus.Failed]: 'routine_run_status_failed',
  [RoutineRunStatus.Cancelled]: 'routine_run_status_cancelled',
  [RoutineRunStatus.Skipped]: 'routine_run_status_skipped',
};

export const runStatusColors: Record<RoutineRunStatus, 'primary' | 'success' | 'danger' | 'secondary' | 'warning'> = {
  [RoutineRunStatus.Queued]: 'secondary',
  [RoutineRunStatus.Running]: 'primary',
  [RoutineRunStatus.Succeeded]: 'success',
  [RoutineRunStatus.Failed]: 'danger',
  [RoutineRunStatus.Cancelled]: 'secondary',
  [RoutineRunStatus.Skipped]: 'warning',
};

export const changeStatusKeys: Record<RoutineApprovalStatus, Translations> = {
  [RoutineApprovalStatus.Pending]: 'routine_change_status_pending',
  [RoutineApprovalStatus.Applying]: 'routine_change_status_applying',
  [RoutineApprovalStatus.Applied]: 'routine_change_status_applied',
  [RoutineApprovalStatus.Failed]: 'routine_change_status_failed',
  [RoutineApprovalStatus.Denied]: 'routine_change_status_denied',
  [RoutineApprovalStatus.Expired]: 'routine_change_status_expired',
  [RoutineApprovalStatus.DryRun]: 'routine_change_status_dry_run',
};

/** whether a run may still change: the run page polls it */
export const isRunActive = (status: RoutineRunStatus) =>
  status === RoutineRunStatus.Queued || status === RoutineRunStatus.Running;

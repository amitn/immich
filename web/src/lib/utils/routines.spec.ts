import { RoutineEvent, RoutineRunStatus, RoutineTriggerType } from '@immich/sdk';
import { describeTrigger, formatTime, getWeekdayName, isRunActive, parseCron, toCron } from '$lib/utils/routines';

const t = (key: string, options?: { values?: Record<string, string | number> }) =>
  options?.values ? `${key} ${JSON.stringify(options.values)}` : key;

describe('routines (#15)', () => {
  it('turns a schedule into a cron expression', () => {
    expect(toCron({ kind: 'daily', time: '02:30', weekday: 0, cron: '' })).toBe('30 2 * * *');
    expect(toCron({ kind: 'weekly', time: '09:00', weekday: 0, cron: '' })).toBe('0 9 * * 0');
    expect(toCron({ kind: 'custom', time: '', weekday: 0, cron: ' 0 */6 * * * ' })).toBe('0 */6 * * *');
  });

  it('reads a cron expression back as a schedule', () => {
    expect(parseCron('30 2 * * *')).toMatchObject({ kind: 'daily', time: '02:30' });
    expect(parseCron('0 9 * * 6')).toMatchObject({ kind: 'weekly', time: '09:00', weekday: 6 });
    expect(parseCron('0 */6 * * *')).toMatchObject({ kind: 'custom', cron: '0 */6 * * *' });
    expect(parseCron('99 2 * * *')).toMatchObject({ kind: 'custom' });
    expect(parseCron(undefined)).toMatchObject({ kind: 'daily', time: '02:00' });
  });

  it('round-trips the schedules of the editor', () => {
    for (const cron of ['0 2 * * *', '15 20 * * 3']) {
      expect(toCron(parseCron(cron))).toBe(cron);
    }
  });

  it('names the days and times', () => {
    expect(getWeekdayName(0, 'en-US')).toBe('Sunday');
    expect(getWeekdayName(6, 'en-US')).toBe('Saturday');
    expect(formatTime('21:05', 'en-GB')).toBe('21:05');
  });

  it('describes a trigger', () => {
    expect(describeTrigger(t, { type: RoutineTriggerType.Manual })).toBe('routine_trigger_manual');
    expect(describeTrigger(t, { type: RoutineTriggerType.Schedule, cron: '0 2 * * *' }, 'en-GB')).toMatch(
      /^routine_schedule_daily_at {"time":"0?2:00"}$/,
    );
    expect(describeTrigger(t, { type: RoutineTriggerType.Schedule, cron: '0 9 * * 0' }, 'en-GB')).toMatch(
      /^routine_schedule_weekly_at {"day":"Sunday","time":"0?9:00"}$/,
    );
    expect(describeTrigger(t, { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'print' })).toBe(
      'routine_event_tag (print)',
    );
  });

  it('knows the runs that may still change', () => {
    expect(isRunActive(RoutineRunStatus.Running)).toBe(true);
    expect(isRunActive(RoutineRunStatus.Queued)).toBe(true);
    expect(isRunActive(RoutineRunStatus.Succeeded)).toBe(false);
  });
});

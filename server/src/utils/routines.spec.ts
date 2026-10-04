import { RoutineApprovalMode, RoutineEvent, RoutineTriggerType } from 'src/enum.js';
import {
  ROUTINE_SAFE_TOOLS,
  buildRoutinePrompt,
  describeRunOutcome,
  getNextRunAt,
  getRoutineToolDecision,
  hashRoutineToken,
  isTagUnder,
  validateCron,
} from 'src/utils/routines.js';

const limits = { runsPerDay: 4, minutes: 15, toolCalls: 100 };

describe('routines (#15)', () => {
  describe(getRoutineToolDecision.name, () => {
    const read = { name: 'search_photos', mutating: false };
    const album = { name: 'create_album', mutating: true };
    const archive = { name: 'clean_up_bursts', mutating: true };
    const book = { name: 'create_book', mutating: false };

    it('runs the read-only tools in every mode', () => {
      for (const mode of Object.values(RoutineApprovalMode)) {
        expect(getRoutineToolDecision(mode, read)).toBe('run');
      }
    });

    it('queues every change in Ask me, and lets the run shape its own book drafts like the chat', () => {
      expect(getRoutineToolDecision(RoutineApprovalMode.Ask, album)).toBe('queue');
      expect(getRoutineToolDecision(RoutineApprovalMode.Ask, archive)).toBe('queue');
      expect(getRoutineToolDecision(RoutineApprovalMode.Ask, book)).toBe('run');
    });

    it('runs only the allow-list in Auto-approve safe actions', () => {
      expect(getRoutineToolDecision(RoutineApprovalMode.AutoSafe, album)).toBe('run');
      expect(getRoutineToolDecision(RoutineApprovalMode.AutoSafe, archive)).toBe('queue');
      expect(getRoutineToolDecision(RoutineApprovalMode.AutoSafe, { name: 'share_book', mutating: true })).toBe(
        'queue',
      );
    });

    it('reports every write in a dry run, the book drafts included', () => {
      expect(getRoutineToolDecision(RoutineApprovalMode.DryRun, album)).toBe('report');
      expect(getRoutineToolDecision(RoutineApprovalMode.DryRun, book)).toBe('report');
    });

    it('keeps archiving, sharing, exports, artworks and undo out of the allow-list', () => {
      for (const name of ['clean_up_bursts', 'share_book', 'export_pdf', 'stylize_photo', 'undo_activity']) {
        expect(ROUTINE_SAFE_TOOLS.has(name)).toBe(false);
      }
    });
  });

  describe(validateCron.name, () => {
    it('accepts 5-field expressions and time zones', () => {
      expect(() => validateCron('0 2 * * *')).not.toThrow();
      expect(() => validateCron('30 9 * * 0', 'Europe/London')).not.toThrow();
    });

    it('rejects bad expressions, seconds and unknown time zones', () => {
      expect(() => validateCron('nightly')).toThrow();
      expect(() => validateCron('* * * * * *')).toThrow('5 fields');
      expect(() => validateCron('0 2 * * *', 'Mars/Olympus')).toThrow();
    });
  });

  describe(getNextRunAt.name, () => {
    it('gives the next time of a schedule, in its time zone', () => {
      const trigger = { type: RoutineTriggerType.Schedule as const, cron: '0 2 * * *', timezone: 'UTC' };
      expect(getNextRunAt(trigger, new Date('2026-10-03T01:00:00Z'))?.toISOString()).toBe('2026-10-03T02:00:00.000Z');
      expect(getNextRunAt(trigger, new Date('2026-10-03T03:00:00Z'))?.toISOString()).toBe('2026-10-04T02:00:00.000Z');
      expect(
        getNextRunAt({ ...trigger, timezone: 'Europe/London' }, new Date('2026-10-03T03:00:00Z'))?.toISOString(),
      ).toBe('2026-10-04T01:00:00.000Z');
    });

    it('gives nothing for events, manual routines and bad expressions', () => {
      expect(getNextRunAt({ type: RoutineTriggerType.Manual }, new Date())).toBeUndefined();
      expect(getNextRunAt({ type: RoutineTriggerType.Event, event: RoutineEvent.Upload }, new Date())).toBeUndefined();
      expect(getNextRunAt({ type: RoutineTriggerType.Schedule, cron: 'bad' }, new Date())).toBeUndefined();
    });
  });

  it('matches a tag and the tags under it', () => {
    expect(isTagUnder('Print', 'print')).toBe(true);
    expect(isTagUnder('Food/Noma/Tartare', 'Food/Noma')).toBe(true);
    expect(isTagUnder('Food/Nomad', 'Food/Noma')).toBe(false);
    expect(isTagUnder('Food', '')).toBe(false);
  });

  it('hashes the token of a run', () => {
    expect(hashRoutineToken('a')).toMatch(/^[\da-f]{64}$/);
    expect(hashRoutineToken('a')).not.toBe(hashRoutineToken('b'));
  });

  describe(buildRoutinePrompt.name, () => {
    const base = {
      name: 'Name dishes',
      instruction: 'Name the dishes of new restaurant visits',
      trigger: RoutineTriggerType.Event,
      scope: {},
      context: {},
      limits,
    };

    it('tells the agent nobody is watching, the approval mode and the limits, then the instruction', () => {
      const prompt = buildRoutinePrompt({ ...base, mode: RoutineApprovalMode.Ask });
      expect(prompt).toContain('“Name dishes”');
      expect(prompt).toContain('Nobody is watching');
      expect(prompt).toContain('Approval mode: Ask me');
      expect(prompt).toContain('at most 100 tool calls and 15 minutes');
      expect(prompt.trimEnd().endsWith('Name the dishes of new restaurant visits')).toBe(true);
    });

    it('lists the scope, the events and the photos handed over', () => {
      const prompt = buildRoutinePrompt({
        ...base,
        mode: RoutineApprovalMode.DryRun,
        scope: { albumIds: ['album-1'], sinceLastRun: true, pack: 'food' },
        context: {
          assetIds: ['a', 'b'],
          moreAssets: 3,
          since: '2026-10-02T02:00:00.000Z',
          events: [{ kind: RoutineEvent.JournalVisit, at: '2026-10-03T01:00:00Z', data: { journal: 'food' } }],
        },
      });
      expect(prompt).toContain('Dry run');
      expect(prompt).toContain('albums (album ids): album-1');
      expect(prompt).toContain('journal: food');
      expect(prompt).toContain('since the last run, 2026-10-02T02:00:00.000Z');
      expect(prompt).toContain('a new journal visit was found {"journal":"food"}');
      expect(prompt).toContain('(and 3 more, not listed: find them with search_photos): a, b');
    });

    it('names the safe tools in Auto-approve safe actions', () => {
      const prompt = buildRoutinePrompt({ ...base, mode: RoutineApprovalMode.AutoSafe });
      expect(prompt).toContain('create_album');
      expect(prompt).not.toContain('clean_up_bursts');
    });
  });

  it('describes the outcome of a run', () => {
    expect(describeRunOutcome({ changes: 12, pending: 2, reported: 0 })).toBe('12 changes · 2 need your OK');
    expect(describeRunOutcome({ changes: 1, pending: 1, reported: 0 })).toBe('1 change · 1 needs your OK');
    expect(describeRunOutcome({ changes: 0, pending: 0, reported: 0 })).toBe('0 changes');
    expect(describeRunOutcome({ changes: 0, pending: 0, reported: 5 })).toBe('Dry run: 5 changes proposed');
    expect(describeRunOutcome({ changes: 0, pending: 3, reported: 0 })).toBe('3 need your OK');
  });
});

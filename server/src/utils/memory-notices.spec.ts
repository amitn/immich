import { MemoryType, UserMetadataKey } from 'src/enum.js';
import {
  getDraftNoticeFallbackTitle,
  getMemoryNoticeFallbackTitle,
  isDigestDue,
  isMemoryNoticeDue,
  isTimeOfDay,
  rankMemoryNotices,
  toLocalDay,
  toLocalWeek,
  toMemoryNoticeData,
  wantsCreationNotices,
} from 'src/utils/memory-notices.js';
import { getPreferences } from 'src/utils/preferences.js';

const memory = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    ownerId: 'owner',
    type: MemoryType.Rule,
    data: { ruleId: 'trip_anniversary', score: 100, context: { placeLabel: 'Lisbon' } },
    memoryAt: new Date('2023-10-03T00:00:00Z'),
    assets: [{ id: `${id}-a` }, { id: `${id}-b` }],
    ...overrides,
  }) as never;

const preferencesWith = (memoryNotifications: Record<string, unknown>, other: Record<string, unknown> = {}) =>
  getPreferences([{ key: UserMetadataKey.Preferences, value: { memoryNotifications, ...other } }]);

describe('memory notices', () => {
  describe('the time of day', () => {
    // Saturday 3 October 2026, 08:30 UTC: 09:30 in London, 17:30 in Tokyo, 04:30 in New York
    const now = new Date('2026-10-03T08:30:00Z');

    it('is due from the hour the user chose, in their time zone', () => {
      expect(isTimeOfDay({ hour: 9, timeZone: 'Europe/London' }, now)).toBe(true);
      expect(isTimeOfDay({ hour: 9, timeZone: 'America/New_York' }, now)).toBe(false);
      expect(isTimeOfDay({ hour: 18, timeZone: 'Asia/Tokyo' }, now)).toBe(false);
      expect(isTimeOfDay({ hour: 17, timeZone: 'Asia/Tokyo' }, now)).toBe(true);
    });

    it("falls back to the server's time zone for an unknown one", () => {
      expect(() => isTimeOfDay({ hour: 9, timeZone: 'Mars/Olympus_Mons' }, now)).not.toThrow();
      expect(toLocalDay(now, 'Mars/Olympus_Mons')).toMatch(/^2026-10-0[23]$/);
    });

    it('counts the days and the weeks in the time zone of the user', () => {
      const lateFriday = new Date('2026-10-02T23:30:00Z');
      expect(toLocalDay(lateFriday, 'Europe/London')).toBe('2026-10-03');
      expect(toLocalDay(lateFriday, 'America/New_York')).toBe('2026-10-02');
      expect(toLocalWeek(now, 'Europe/London')).toBe('2026-W40');
      // Sunday 4 January 2026 is still in the first ISO week of 2026; 28 December 2026 is in week 53
      expect(toLocalWeek(new Date('2026-01-04T12:00:00Z'), 'UTC')).toBe('2026-W01');
      expect(toLocalWeek(new Date('2026-12-28T12:00:00Z'), 'UTC')).toBe('2026-W53');
    });

    it('sends the digest on the digest day only, from the time of day', () => {
      const settings = { digest: true, digestDay: 6, hour: 9, timeZone: 'Europe/London' };
      expect(isDigestDue(settings, now)).toBe(true);
      expect(isDigestDue({ ...settings, digestDay: 7 }, now)).toBe(false);
      expect(isDigestDue({ ...settings, hour: 10 }, now)).toBe(false);
      expect(isDigestDue({ ...settings, digest: false }, now)).toBe(false);
    });
  });

  describe('isMemoryNoticeDue', () => {
    const now = new Date('2026-10-03T10:00:00Z');
    const on = { enabled: true, digest: true };

    it('is due by default from 9 in the morning', () => {
      expect(isMemoryNoticeDue(on, preferencesWith({ timeZone: 'UTC' }), now)).toBe(true);
      expect(isMemoryNoticeDue(on, preferencesWith({ timeZone: 'UTC', hour: 11 }), now)).toBe(false);
    });

    it('is not due when the user turned off the memories and the drafts, unless the digest is due', () => {
      const off = { timeZone: 'UTC', memories: false, drafts: false };
      expect(isMemoryNoticeDue(on, preferencesWith(off), now)).toBe(false);
      expect(isMemoryNoticeDue(on, preferencesWith({ ...off, digest: true, digestDay: 6 }), now)).toBe(true);
    });

    it('is not due for a user without memories, unless they want the drafts', () => {
      const prefs = preferencesWith({ timeZone: 'UTC', drafts: false }, { memories: { enabled: false } });
      expect(isMemoryNoticeDue(on, prefs, now)).toBe(false);
      expect(isMemoryNoticeDue(on, preferencesWith({ timeZone: 'UTC' }, { memories: { enabled: false } }), now)).toBe(
        true,
      );
    });

    it('follows the admin switches', () => {
      const prefs = preferencesWith({ timeZone: 'UTC', digest: true, digestDay: 6 });
      expect(isMemoryNoticeDue({ enabled: false, digest: true }, prefs, now)).toBe(true);
      expect(isMemoryNoticeDue({ enabled: false, digest: false }, prefs, now)).toBe(false);
      expect(isMemoryNoticeDue({ enabled: true, digest: false }, prefs, now)).toBe(true);
    });
  });

  describe('rankMemoryNotices', () => {
    it("puts a rule's memory by its score above the plain years ago, and those by their photos", () => {
      const ranked = rankMemoryNotices(
        [
          memory('years-ago-small', { type: MemoryType.OnThisDay, data: { year: 2020 } }),
          memory('anniversary', { data: { ruleId: 'trip_anniversary', score: 120 } }),
          memory('years-ago-big', {
            type: MemoryType.OnThisDay,
            data: { year: 2019 },
            assets: [{ id: '1' }, { id: '2' }, { id: '3' }],
          }),
          memory('place', { data: { ruleId: 'on_this_day_place', score: 200 } }),
        ],
        'owner',
      );
      expect(ranked.map(({ id }) => id)).toEqual(['place', 'anniversary', 'years-ago-big', 'years-ago-small']);
    });

    it("leaves out the year recap (it has its own notification), someone else's memories and empty ones", () => {
      const ranked = rankMemoryNotices(
        [
          memory('recap', { data: { ruleId: 'year_recap', score: 999 } }),
          memory('partner', { ownerId: 'partner' }),
          memory('empty', { assets: [] }),
          memory('kept'),
        ],
        'owner',
      );
      expect(ranked.map(({ id }) => id)).toEqual(['kept']);
    });
  });

  describe('toMemoryNoticeData', () => {
    it('keeps the facts of a rule, never prose', () => {
      expect(toMemoryNoticeData(memory('m1'))).toEqual({
        memoryId: 'm1',
        memoryNotice: {
          type: MemoryType.Rule,
          data: { ruleId: 'trip_anniversary', context: { placeLabel: 'Lisbon' } },
          memoryAt: '2023-10-03T00:00:00.000Z',
          assetCount: 2,
        },
      });
    });

    it('keeps the year of an on this day memory, and the old title of a memory made before the rules stored none', () => {
      expect(
        toMemoryNoticeData(memory('m2', { type: MemoryType.OnThisDay, data: { year: 2019 } })).memoryNotice.data,
      ).toEqual({ year: 2019 });
      expect(toMemoryNoticeData(memory('m3', { title: 'Lisbon, 2 years ago' })).memoryNotice.data.title).toBe(
        'Lisbon, 2 years ago',
      );
    });
  });

  it('has fallback titles for the clients that do not word the notification', () => {
    expect(getMemoryNoticeFallbackTitle({ type: MemoryType.OnThisDay, data: { year: 2020 } })).toBe('On this day');
    expect(getMemoryNoticeFallbackTitle({ type: MemoryType.Rule, data: { ruleId: 'trip_anniversary' } })).toBe(
      'A trip anniversary',
    );
    expect(getMemoryNoticeFallbackTitle({ type: MemoryType.Rule, data: { ruleId: 'birthday' } })).toBe(
      'A memory for you',
    );
    expect(getDraftNoticeFallbackTitle('trip' as never)).toBe('Your trip book is ready');
  });

  it('tells of the ready creations unless the user turned them off', () => {
    expect(wantsCreationNotices(undefined)).toBe(true);
    expect(
      wantsCreationNotices([
        { key: UserMetadataKey.Preferences, value: { memoryNotifications: { creations: false } } },
      ]),
    ).toBe(false);
  });
});

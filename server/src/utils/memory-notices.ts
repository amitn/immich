import { DateTime } from 'luxon';
import type { MemoryResponseDto } from 'src/dtos/memory.dto.js';
import type { BookDraftKind } from 'src/enum.js';
import type { UserMetadataItem, UserPreferences } from 'src/types.js';
import { MemoryType } from 'src/enum.js';
import { YEAR_RECAP_RULE_ID } from 'src/services/memory-rules/year-recap.rule.js';
import { getPreferences } from 'src/utils/preferences.js';

/**
 * The scheduling and the choices of the memory notifier (#6), kept pure: when a user's notification of the day and
 * weekly digest are due (the hour they chose, in their time zone), which memory is worth a notification, and the data
 * the notifications carry. A notification stores facts, never prose: the web words it in the viewer's language
 * (`web/src/lib/utils/memory-notice.ts`), like the memory cards (`memory-card.ts`).
 */

type NoticePreferences = UserPreferences['memoryNotifications'];

/** the memory notifier runs every hour, a few minutes past it */
export const MEMORY_NOTICES_CRON = '5 * * * *';

/** the digest covers the week before it */
export const DIGEST_DAYS = 7;

/** each section of the digest lists at most this many items */
export const DIGEST_MAX_ITEMS = 6;

/** what was sent is remembered this long (a memory is kept a year, unless saved) */
export const MEMORY_NOTICE_RETENTION_DAYS = 400;

/** "now" in the user's time zone; the server's when they have none or it is unknown */
export const toLocalNow = (now: Date, timeZone: string) => {
  const local = DateTime.fromJSDate(now, timeZone ? { zone: timeZone } : {});
  return local.isValid ? local : DateTime.fromJSDate(now);
};

/** the day in the user's time zone, e.g. `2026-10-03` */
export const toLocalDay = (now: Date, timeZone: string) => toLocalNow(now, timeZone).toISODate()!;

/** the ISO week of the day in the user's time zone, e.g. `2026-W40`: the digest is sent once a week */
export const toLocalWeek = (now: Date, timeZone: string) => toLocalNow(now, timeZone).toFormat("kkkk-'W'WW");

/** whether the user's time of day has come today, in their time zone */
export const isTimeOfDay = (preferences: Pick<NoticePreferences, 'hour' | 'timeZone'>, now: Date) =>
  toLocalNow(now, preferences.timeZone).hour >= preferences.hour;

/** whether today is the user's digest day, and its time has come */
export const isDigestDue = (
  preferences: Pick<NoticePreferences, 'digest' | 'digestDay' | 'hour' | 'timeZone'>,
  now: Date,
) =>
  preferences.digest &&
  toLocalNow(now, preferences.timeZone).weekday === preferences.digestDay &&
  isTimeOfDay(preferences, now);

/** whether the user wants a notification of the day: of a memory or of a waiting draft */
export const wantsNoticeOfTheDay = (preferences: Pick<UserPreferences, 'memories' | 'memoryNotifications'>) =>
  (preferences.memories.enabled && preferences.memoryNotifications.memories) || preferences.memoryNotifications.drafts;

/** whether the notifier has something to do for the user now: the admin switches and the user's choices */
export const isMemoryNoticeDue = (
  config: { enabled: boolean; digest: boolean },
  preferences: Pick<UserPreferences, 'memories' | 'memoryNotifications'>,
  now: Date,
) =>
  (config.enabled && wantsNoticeOfTheDay(preferences) && isTimeOfDay(preferences.memoryNotifications, now)) ||
  (config.digest && isDigestDue(preferences.memoryNotifications, now));

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

const getRuleData = (memory: Pick<MemoryResponseDto, 'data'>) =>
  (memory.data ?? {}) as { ruleId?: unknown; score?: unknown; context?: unknown };

/**
 * How much a memory is worth a notification, like the memory engine ranks the cards of a day: a rule's memory by its
 * score (a trip anniversary, a place on this day, a birthday) above the plain "N years ago", and of those the one with
 * the most photos
 */
export const getMemoryNoticeRank = (memory: Pick<MemoryResponseDto, 'type' | 'data' | 'assets'>) => {
  if (memory.type === MemoryType.Rule) {
    const score = getRuleData(memory).score;
    return 1_000_000 + (typeof score === 'number' && Number.isFinite(score) ? score : 0);
  }
  return memory.assets.length;
};

/** whether a memory can be a notification: the user's own, with photos left, and not a year recap (it has its own) */
export const isNotifiableMemory = (
  memory: Pick<MemoryResponseDto, 'type' | 'data' | 'assets' | 'ownerId'>,
  userId: string,
) => memory.ownerId === userId && memory.assets.length > 0 && getRuleData(memory).ruleId !== YEAR_RECAP_RULE_ID;

/** the memories worth a notification, the best first */
export const rankMemoryNotices = <T extends Pick<MemoryResponseDto, 'id' | 'type' | 'data' | 'assets' | 'ownerId'>>(
  memories: T[],
  userId: string,
) =>
  memories
    .filter((memory) => isNotifiableMemory(memory, userId))
    .toSorted((a, b) => getMemoryNoticeRank(b) - getMemoryNoticeRank(a) || a.id.localeCompare(b.id));

/**
 * The facts a memory notification carries, which the web words like the card: the type, the rule and its context (or
 * the year of an "N years ago"), and the old prose of a memory made before the rules stored none
 */
export type MemoryNoticeFacts = {
  type: MemoryType;
  data: { ruleId?: string; context?: Record<string, unknown>; year?: number; title?: string; subtitle?: string };
  memoryAt: string;
  assetCount: number;
};

/** the data of a memory notification: the web opens the memory (`memoryId`) */
export type MemoryNoticeData = { memoryId: string; memoryNotice: MemoryNoticeFacts };

/** the data of a waiting draft's notification: the web opens the book (`bookId`) */
export type DraftNoticeData = { bookId: string; draftNotice: { draftId: string; kind: BookDraftKind; title: string } };

export const toMemoryNoticeData = (
  memory: Pick<MemoryResponseDto, 'id' | 'type' | 'data' | 'memoryAt' | 'assets' | 'title' | 'subtitle'>,
): MemoryNoticeData => {
  const data = getRuleData(memory);
  const year = (memory.data as { year?: unknown } | undefined)?.year;
  const facts: MemoryNoticeFacts['data'] =
    memory.type === MemoryType.Rule
      ? {
          ...(typeof data.ruleId === 'string' && { ruleId: data.ruleId }),
          ...(isObject(data.context) && { context: data.context }),
          ...(memory.title && { title: memory.title }),
          ...(memory.subtitle && { subtitle: memory.subtitle }),
        }
      : { ...(typeof year === 'number' && { year }) };
  return {
    memoryId: memory.id,
    memoryNotice: {
      type: memory.type,
      data: facts,
      memoryAt: new Date(memory.memoryAt).toISOString(),
      assetCount: memory.assets.length,
    },
  };
};

/**
 * The title stored with a memory notification, for the clients that do not word it from its data (the web does); the
 * plain kind of the memory, never its facts
 */
export const getMemoryNoticeFallbackTitle = (facts: Pick<MemoryNoticeFacts, 'type' | 'data'>) => {
  if (facts.type === MemoryType.OnThisDay || facts.data.ruleId === 'on_this_day_place') {
    return 'On this day';
  }
  return facts.data.ruleId === 'trip_anniversary' ? 'A trip anniversary' : 'A memory for you';
};

/** see `getMemoryNoticeFallbackTitle` */
export const getDraftNoticeFallbackTitle = (kind: BookDraftKind) =>
  kind === 'trip' ? 'Your trip book is ready' : 'A photo book is waiting for you';

/**
 * The push hook (#3): every notification of the day is emitted as a `MemoryNoticeSend` event after it is stored and
 * sent to the open web clients. A push channel (the Android app's) subscribes to it with `@OnEvent`, and words the
 * notification from the same data as the web.
 */
export type MemoryNoticeEvent = {
  userId: string;
  kind: 'memory' | 'draft';
  notificationId: string;
  data: MemoryNoticeData | DraftNoticeData;
};

/**
 * For the services of the creations a user asks for (a highlight video, a book export, an artwork): whether they want
 * to be told when one is ready. Not limited to one a day, and a failure is always told.
 */
export const wantsCreationNotices = (metadata: UserMetadataItem[] | undefined) =>
  getPreferences(metadata ?? []).memoryNotifications.creations;

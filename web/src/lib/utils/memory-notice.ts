import { MemoryType, type MemoryResponseDto, type NotificationDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import { getMemorySubtitle, getMemoryTitle } from '$lib/utils/memory-card';
import { parseNotificationData } from '$lib/utils/notification';

/**
 * Gallery fork (#6): the words of the memory notifications. The server stores the facts of the memory the notification
 * is about (its type, its rule and the rule's context) and of a suggested book waiting for the user, never prose, so
 * the notification reads in the viewer's language, like the memory card it opens (`memory-card.ts`). Its stored title
 * is only a fallback for the clients that do not word it.
 */

type MessageKey = Parameters<MessageFormatter>[0];

export type NotificationText = { title: string; description?: string; kind: 'memory' | 'draft' };

const asObject = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

/** the facts of the memory a notification is about, as a memory the card text can be built from */
export const getMemoryNotice = (data: unknown) => {
  const notice = asObject(parseNotificationData(data)?.memoryNotice);
  const type = notice?.type;
  if (type !== MemoryType.OnThisDay && type !== MemoryType.Rule) {
    return;
  }
  const facts = asObject(notice?.data) ?? {};
  return {
    type,
    data: facts,
    title: typeof facts.title === 'string' ? facts.title : undefined,
    subtitle: typeof facts.subtitle === 'string' ? facts.subtitle : undefined,
  } as unknown as MemoryResponseDto;
};

/** the suggested book a notification is about */
export const getDraftNotice = (data: unknown) => {
  const notice = asObject(parseNotificationData(data)?.draftNotice);
  if (!notice) {
    return;
  }
  return {
    kind: typeof notice.kind === 'string' ? notice.kind : undefined,
    title: typeof notice.title === 'string' ? notice.title : undefined,
  };
};

const getMemoryNoticeKey = (memory: MemoryResponseDto): MessageKey => {
  const ruleId = (memory.data as Record<string, unknown>).ruleId;
  if (memory.type === MemoryType.OnThisDay || ruleId === 'on_this_day_place') {
    return 'memory_notice_on_this_day';
  }
  if (ruleId === 'trip_anniversary') {
    return 'memory_notice_trip_anniversary';
  }
  return ruleId === 'birthday' ? 'memory_notice_birthday' : 'memory_notice_title';
};

/**
 * The title and the line of a memory notification ("On this day" / "3 years ago · 12 photos") or of a waiting draft
 * ("Your trip book is ready" / "Crete 2026"), in the viewer's language; undefined for the other notifications
 */
export const getNotificationText = (
  notification: Pick<NotificationDto, 'data' | 'createdAt'>,
  translate: MessageFormatter,
  locale?: string,
): NotificationText | undefined => {
  const memory = getMemoryNotice(notification.data);
  if (memory) {
    // "3 years ago" counts from the day it was sent, not from the day it is read
    const sentAt = new Date(notification.createdAt);
    const title = getMemoryTitle(memory, translate, Number.isNaN(sentAt.getTime()) ? new Date() : sentAt, locale);
    const subtitle = getMemorySubtitle(memory, translate, locale);
    return {
      kind: 'memory',
      title: translate(getMemoryNoticeKey(memory)),
      description: [title, subtitle].filter(Boolean).join(' · '),
    };
  }

  const draft = getDraftNotice(notification.data);
  if (draft) {
    return {
      kind: 'draft',
      title: translate(draft.kind === 'trip' ? 'draft_notice_trip' : 'draft_notice_title'),
      ...(draft.title && { description: draft.title }),
    };
  }
};

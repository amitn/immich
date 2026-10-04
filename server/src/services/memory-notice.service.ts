import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { JobOf, UserPreferences } from 'src/types.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { BookDraftResponseDto } from 'src/dtos/book.dto.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { MemoryResponseDto } from 'src/dtos/memory.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  BookDraftKind,
  CronJob,
  DatabaseLock,
  ImmichWorker,
  JobName,
  JobStatus,
  MemoryType,
  NotificationLevel,
  NotificationType,
  QueueName,
} from 'src/enum.js';
import { EmailTemplate, MemoryDigestItem } from 'src/repositories/email.repository.js';
import { MemoryNoticeKind } from 'src/repositories/memory-notice.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { BookDraftService } from 'src/services/book-draft.service.js';
import { MemoryService } from 'src/services/memory.service.js';
import {
  DIGEST_DAYS,
  DIGEST_MAX_ITEMS,
  DraftNoticeData,
  MEMORY_NOTICES_CRON,
  MEMORY_NOTICE_RETENTION_DAYS,
  MemoryNoticeData,
  getDraftNoticeFallbackTitle,
  getMemoryNoticeFallbackTitle,
  isDigestDue,
  isMemoryNoticeDue,
  isTimeOfDay,
  rankMemoryNotices,
  toLocalDay,
  toLocalNow,
  toLocalWeek,
  toMemoryNoticeData,
} from 'src/utils/memory-notices.js';
import { getMemorySource } from 'src/utils/memory-source.js';
import { getExternalDomain, handlePromiseError } from 'src/utils/misc.js';
import { getPreferences } from 'src/utils/preferences.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type NoticeUser = {
  id: string;
  isAdmin: boolean;
  name: string;
  email: string;
  quotaUsageInBytes: number;
  quotaSizeInBytes: number | null;
  metadata: Parameters<typeof getPreferences>[0];
};

/** the notification of the day that was sent */
export type SentNotice =
  | { kind: 'memory'; notificationId: string; data: MemoryNoticeData }
  | { kind: 'draft'; notificationId: string; data: DraftNoticeData };

/** what a weekly digest tells */
export type MemoryDigest = { memories: MemoryDigestItem[]; drafts: MemoryDigestItem[]; visits: MemoryDigestItem[] };

const isEmptyDigest = ({ memories, drafts, visits }: MemoryDigest) =>
  memories.length === 0 && drafts.length === 0 && visits.length === 0;

/**
 * Memory notifications (#6). Every hour, and right after the memories of the night are made, each user whose time of
 * day has come (in their time zone) gets at most one notification of the day: the best memory of the day they were not
 * notified of (a trip anniversary, a place on this day, an "N years ago"…, never one about a person they keep out of
 * their memories nor one whose photos they all keep out — see `MemoryService.search`), or else a suggested photo book
 * waiting for them ("Your trip book is ready"). On their digest day they also get a weekly email of the week's
 * memories, waiting drafts and unread journal visits, when there is something to tell and email is set up. Ready
 * creations they asked for (a video, a book, an artwork) are notified when ready, outside this limit, by their own
 * services (see `wantsCreationNotices`). Every notification of the day is also emitted as `MemoryNoticeSend`, the hook
 * of a push channel (#3).
 */
@Injectable()
export class MemoryNoticeService extends BaseService {
  private cronLock = false;

  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit() {
    this.cronLock = await this.databaseRepository.tryLock(DatabaseLock.MemoryNotices);
    if (!this.cronLock) {
      return;
    }
    this.cronRepository.create({
      name: CronJob.MemoryNotices,
      expression: MEMORY_NOTICES_CRON,
      start: true,
      onTick: () => handlePromiseError(this.jobRepository.queue({ name: JobName.MemoryNoticesQueueAll }), this.logger),
    });
  }

  @OnJob({ name: JobName.MemoryNoticesQueueAll, queue: QueueName.BackgroundTask })
  async handleQueueAll(): Promise<JobStatus> {
    const { memoryNotifications } = await this.getConfig({ withCache: false });
    if (!memoryNotifications.enabled && !memoryNotifications.digest) {
      return JobStatus.Skipped;
    }

    const now = new Date();
    await this.memoryNoticeRepository.cleanup(new Date(now.getTime() - MEMORY_NOTICE_RETENTION_DAYS * DAY_MS));
    const users = await this.userRepository.getList({ withDeleted: false });
    await this.jobRepository.queueAll(
      users
        .filter((user) => isMemoryNoticeDue(memoryNotifications, getPreferences(user.metadata ?? []), now))
        .map((user) => ({ name: JobName.MemoryNoticesSend, data: { id: user.id } })),
    );
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.MemoryNoticesSend, queue: QueueName.BackgroundTask })
  async handleSend({ id }: JobOf<JobName.MemoryNoticesSend>): Promise<JobStatus> {
    const user = await this.userRepository.get(id, {});
    if (!user) {
      return JobStatus.Skipped;
    }
    const config = await this.getConfig({ withCache: true });
    const { notice, digest } = await this.sendNotices(user, config, new Date());
    return notice || digest ? JobStatus.Success : JobStatus.Skipped;
  }

  /** the notification of the day and the weekly digest of a user, when due and not sent yet */
  async sendNotices(
    user: NoticeUser,
    config: Pick<SystemConfig, 'memoryNotifications' | 'notifications' | 'server'>,
    now: Date,
  ): Promise<{ notice?: SentNotice; digest?: MemoryDigest }> {
    const preferences = getPreferences(user.metadata ?? []);
    const auth = this.getAuth(user);
    let notice: SentNotice | undefined;
    let digest: MemoryDigest | undefined;
    try {
      if (config.memoryNotifications.enabled) {
        notice = await this.sendNoticeOfTheDay(auth, preferences, now);
      }
    } catch (error: any) {
      this.logger.warn(`Unable to send the notification of the day to ${user.id}: ${error?.message ?? error}`);
    }
    try {
      if (config.memoryNotifications.digest) {
        digest = await this.sendDigest(user, preferences, config, now);
      }
    } catch (error: any) {
      this.logger.warn(`Unable to send the weekly digest to ${user.id}: ${error?.message ?? error}`);
    }
    return { notice, digest };
  }

  /**
   * The notification of the day, once the user's time of day has come and when they got none today: the best memory
   * of the day they were not notified of, or else the newest suggested book waiting for them they were not notified of
   */
  async sendNoticeOfTheDay(auth: AuthDto, preferences: UserPreferences, now: Date): Promise<SentNotice | undefined> {
    const settings = preferences.memoryNotifications;
    if (!isTimeOfDay(settings, now)) {
      return;
    }
    const day = toLocalDay(now, settings.timeZone);
    if (await this.memoryNoticeRepository.hasDay(auth.user.id, day)) {
      return;
    }

    if (preferences.memories.enabled && settings.memories) {
      const memories = rankMemoryNotices(await this.getMemoriesOfDay(auth, day), auth.user.id);
      const sent = await this.memoryNoticeRepository.getSent(
        auth.user.id,
        'memory',
        memories.map(({ id }) => id),
      );
      const memory = memories.find(({ id }) => !sent.has(id));
      if (memory) {
        const data = toMemoryNoticeData(memory);
        const notificationId = await this.deliver(auth.user.id, 'memory', memory.id, day, {
          title: getMemoryNoticeFallbackTitle(data.memoryNotice),
          data,
        });
        // undefined: the day was taken meanwhile (another job), or the notification failed and is tried the next hour
        return notificationId ? { kind: 'memory', notificationId, data } : undefined;
      }
    }

    if (settings.drafts) {
      // the book of a year recap is told of by the recap's own notification
      const waiting = await this.getDrafts(auth);
      const drafts = waiting.filter((draft) => draft.kind !== BookDraftKind.Recap);
      const sent = await this.memoryNoticeRepository.getSent(
        auth.user.id,
        'draft',
        drafts.map(({ id }) => id),
      );
      const draft = drafts.find(({ id }) => !sent.has(id));
      if (draft) {
        const data: DraftNoticeData = {
          bookId: draft.book.id,
          draftNotice: { draftId: draft.id, kind: draft.kind, title: draft.book.title },
        };
        const notificationId = await this.deliver(auth.user.id, 'draft', draft.id, day, {
          title: getDraftNoticeFallbackTitle(draft.kind),
          description: draft.book.title,
          data,
        });
        if (notificationId) {
          return { kind: 'draft', notificationId, data };
        }
      }
    }
  }

  /**
   * The weekly digest, on the user's digest day once their time of day has come, when email is set up, the user gets
   * emails, the digest of the week was not sent yet, and there is something to tell
   */
  async sendDigest(
    user: NoticeUser,
    preferences: UserPreferences,
    config: Pick<SystemConfig, 'notifications' | 'server'>,
    now: Date,
  ): Promise<MemoryDigest | undefined> {
    const settings = preferences.memoryNotifications;
    if (!config.notifications.smtp.enabled || !preferences.emailNotifications.enabled || !isDigestDue(settings, now)) {
      return;
    }
    const week = toLocalWeek(now, settings.timeZone);
    const sent = await this.memoryNoticeRepository.getSent(user.id, 'digest', [week]);
    if (sent.has(week)) {
      return;
    }

    const baseUrl = getExternalDomain(config.server);
    const digest = await this.getDigest(this.getAuth(user), preferences, now, baseUrl);
    if (isEmptyDigest(digest)) {
      return;
    }

    const claimed = await this.memoryNoticeRepository.claim({
      userId: user.id,
      kind: 'digest',
      refId: week,
      day: toLocalDay(now, settings.timeZone),
    });
    if (!claimed) {
      return;
    }
    try {
      const { html, text } = await this.emailRepository.renderEmail({
        template: EmailTemplate.MEMORY_DIGEST,
        data: { baseUrl, recipientName: user.name, ...digest },
        customTemplate: '',
      });
      await this.jobRepository.queue({
        name: JobName.SendMail,
        data: { to: user.email, subject: 'Your week in memories', html, text },
      });
      return digest;
    } catch (error) {
      // sent the next hour
      await this.memoryNoticeRepository.delete(claimed.id);
      throw error;
    }
  }

  /**
   * What the digest of the week before `now` tells, with links: the user's memories of those days (the best first),
   * the suggested books waiting for them, and the journal visits whose notification they have not opened yet
   */
  async getDigest(auth: AuthDto, preferences: UserPreferences, now: Date, baseUrl: string): Promise<MemoryDigest> {
    const timeZone = preferences.memoryNotifications.timeZone;
    const memories: MemoryResponseDto[] = [];
    if (preferences.memories.enabled) {
      const today = toLocalNow(now, timeZone);
      const seen = new Set<string>();
      for (let offset = DIGEST_DAYS - 1; offset >= 0; offset--) {
        const day = today.minus({ days: offset }).toISODate()!;
        for (const memory of await this.getMemoriesOfDay(auth, day)) {
          if (seen.has(memory.id)) {
            continue;
          }
          seen.add(memory.id);
          memories.push(memory);
        }
      }
    }

    // the suggested books waiting for the user, whoever made them
    const drafts = await this.getDrafts(auth);
    const visits = preferences.collectionNotifications.enabled
      ? await this.collectionNoticeRepository.getUnreadSince(
          auth.user.id,
          new Date(now.getTime() - DIGEST_DAYS * DAY_MS),
        )
      : [];

    return {
      memories: rankMemoryNotices(memories, auth.user.id)
        .slice(0, DIGEST_MAX_ITEMS)
        .map((memory) => {
          const source = getMemorySource(
            {
              id: memory.id,
              type: memory.type,
              data: memory.data,
              memoryAt: new Date(memory.memoryAt),
              assetIds: memory.assets.map(({ id }) => id),
            },
            now,
          );
          return {
            title: memory.title || source.title,
            ...((memory.subtitle || source.subtitle) && { subtitle: memory.subtitle || source.subtitle }),
            url: `${baseUrl}/memories/${memory.id}`,
          };
        }),
      drafts: drafts.slice(0, DIGEST_MAX_ITEMS).map((draft) => ({
        title: draft.book.title,
        ...(draft.reason && { subtitle: draft.reason }),
        url: `${baseUrl}/books/${draft.book.id}`,
      })),
      visits: visits
        .filter(({ assetIds }) => assetIds.length > 0)
        .slice(0, DIGEST_MAX_ITEMS)
        .map((visit) => ({
          title: visit.title,
          ...(visit.description && { subtitle: visit.description }),
          url: `${baseUrl}/photos/${visit.assetIds[0]}`,
        })),
    };
  }

  /**
   * The memories of a day (in the user's time zone), as the memory lane shows them: without what the user keeps out
   * of their memories (a memory about an excluded person, or with no photos left, is not there), and only the types
   * the admin and the user have on
   */
  private async getMemoriesOfDay(auth: AuthDto, day: string): Promise<MemoryResponseDto[]> {
    const memories = await BaseService.create(MemoryService, this).search(auth, {
      for: DateTime.fromISO(day, { zone: 'utc' }).toJSDate(),
    });
    return memories.filter((memory) => memory.type === MemoryType.OnThisDay || memory.type === MemoryType.Rule);
  }

  private getDrafts(auth: AuthDto): Promise<BookDraftResponseDto[]> {
    return BaseService.create(BookDraftService, this).getDrafts(auth);
  }

  /**
   * Claims the notice (once per memory or draft, one a day) and notifies the user; the id of the notification, or
   * undefined when the day or the memory was taken meanwhile or the notification failed (the claim is then undone)
   */
  private async deliver(
    userId: string,
    kind: Exclude<MemoryNoticeKind, 'digest'>,
    refId: string,
    day: string,
    notification: { title: string; description?: string; data: MemoryNoticeData | DraftNoticeData },
  ): Promise<string | undefined> {
    const claimed = await this.memoryNoticeRepository.claim({ userId, kind, refId, day });
    if (!claimed) {
      return;
    }

    try {
      const item = await this.notificationRepository.create({
        userId,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: notification.title,
        description: notification.description ?? null,
        data: JSON.stringify(notification.data),
      });
      await this.memoryNoticeRepository.setNotification(claimed.id, item.id);
      this.websocketRepository.clientSend('on_notification', userId, mapNotification(item));
      await this.eventRepository.emit('MemoryNoticeSend', {
        userId,
        kind,
        notificationId: item.id,
        data: notification.data,
      });
      return item.id;
    } catch (error: any) {
      this.logger.warn(`Unable to notify user ${userId} of a ${kind}: ${error?.message ?? error}`);
      await this.memoryNoticeRepository.delete(claimed.id);
      return;
    }
  }

  private getAuth(user: NoticeUser): AuthDto {
    return {
      user: {
        id: user.id,
        isAdmin: user.isAdmin,
        name: user.name,
        email: user.email,
        quotaUsageInBytes: user.quotaUsageInBytes,
        quotaSizeInBytes: user.quotaSizeInBytes,
      },
    };
  }
}

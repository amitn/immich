import { Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { COLLECTION_LIMITS, CollectionVisitResponse } from 'src/dtos/collection.dto.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import { JobName, JobStatus, NotificationLevel, NotificationType, QueueName } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { toLocalDay } from 'src/utils/agent/events.js';
import {
  CollectionPack,
  DEFAULT_NOTICE_MIN_SUBJECTS,
  formatNoticeDate,
  getCollectionMessages,
  redactText,
} from 'src/utils/collections/pack.js';
import { getCollectionPacks } from 'src/utils/collections/registry.js';
import { isSmartSearchEnabled } from 'src/utils/misc.js';
import { getPreferences } from 'src/utils/preferences.js';

type NoticesConfig = SystemConfig['collections']['notifications'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** what became of a visit found in the new uploads */
export type NewVisitStatus =
  /** new, unnamed and large enough: worth a notification */
  | 'new'
  /** some of its photos already have tags of the pack */
  | 'named'
  /** fewer subject photos than the pack's minimum, or no source photo when the pack needs one (a ticket) */
  | 'small'
  /** notified before: its key, or one of its photos */
  | 'notified'
  /** the same photos are a named visit of another pack (the dishes of a named meal, taken for cooking photos) */
  | 'named-elsewhere'
  /** the same photos are a new visit of another pack, which is notified instead */
  | 'duplicate';

export type NewVisit = {
  pack: string;
  key: string;
  status: NewVisitStatus;
  /** the photos of the visit: its subjects, sources, signs and receipts */
  assetIds: string[];
  subjects: number;
  start: string;
  /** the name of the place in the notification, when it is sure enough */
  place?: string;
  /** the question of the notification, e.g. "Name the dishes from last night at Taormina?" (redacted) */
  title: string;
  /** e.g. "12 dishes · Taormina, 26 September 2026" (redacted) */
  description: string;
};

/** the notification data of a new visit: the web opens the naming dialog of the pack on these photos */
export type CollectionNoticeData = { collectionPack: string; assetIds: string[]; visitKey: string };

/** a place read on the photos is named in a notification from this confidence on (a tag of another pack always is) */
const MIN_PLACE_CONFIDENCE = 0.5;

/**
 * The key of a visit: the hour it started, its kind (the meal) and its city (or where it was, to about a kilometre),
 * e.g. `2026-09-26T20|Dinner|Taormina`. A photo of the visit uploaded later that moves its start is caught by the
 * photos of the notice instead.
 */
export const getVisitKey = (
  visit: Pick<CollectionVisitResponse, 'start' | 'type' | 'city' | 'latitude' | 'longitude'>,
) => {
  const where =
    visit.city ??
    (visit.latitude === undefined || visit.longitude === undefined
      ? ''
      : `${visit.latitude.toFixed(2)},${visit.longitude.toFixed(2)}`);
  return `${visit.start.slice(0, 13)}|${visit.type ?? ''}|${where}`;
};

/** the name of the place of a visit when it is sure enough for a notification: a tag, or a name read clearly */
export const getNoticePlace = (visit: Pick<CollectionVisitResponse, 'place'>) =>
  visit.place.source === 'tag' || (visit.place.source !== 'fallback' && visit.place.confidence >= MIN_PLACE_CONFIDENCE)
    ? visit.place.name
    : undefined;

/** the question and the line of a notification of a visit, in the words of its pack, redacted by the pack */
export const getNoticeText = (pack: CollectionPack, visit: CollectionVisitResponse, today: string) => {
  const subjects = visit.subjectIds.length;
  const place = getNoticePlace(visit);
  const title = getCollectionMessages(pack).newVisit({
    type: visit.type,
    place,
    city: visit.city,
    day: visit.day,
    today,
    subjects,
  });
  const count = `${subjects} ${subjects === 1 ? pack.names.subject : pack.names.subjects}`;
  const where = [place, visit.city].filter((value, index, values) => value && values.indexOf(value) === index);
  const description = `${count} · ${[...where, formatNoticeDate(visit.day)].join(', ')}`;
  return { title: redactText(pack, title), description: redactText(pack, description) };
};

/**
 * "New collection found" notifications: every night, and when asked, the photos each user uploaded since the last
 * check (at most `windowDays` ago) are grouped into the visits of every collection pack (`findVisits`: a meal, a museum
 * visit, a tasting). A visit that nobody named yet (no tags of the pack), with enough subject photos, and never
 * notified gets a notification in the words of its pack ("Name the dishes from last night at Taormina?"), which opens
 * the pack's naming dialog on its photos. At most `maxPerRun` per user and run, the newest first; the others wait for
 * the next run. A visit is notified once (`collection_notice`), even when its notification is dismissed.
 */
@Injectable()
export class CollectionNoticeService extends BaseService {
  @OnJob({ name: JobName.CollectionNoticesQueueAll, queue: QueueName.BackgroundTask })
  async handleQueueAll(): Promise<JobStatus> {
    const { collections, machineLearning } = await this.getConfig({ withCache: false });
    if (!collections.notifications.enabled || !isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const users = await this.userRepository.getList({ withDeleted: false });
    await this.jobRepository.queueAll(
      users
        .filter((user) => getPreferences(user.metadata).collectionNotifications.enabled)
        .map((user) => ({ name: JobName.CollectionNoticesCheck, data: { id: user.id } })),
    );
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.CollectionNoticesCheck, queue: QueueName.BackgroundTask })
  async handleCheck({ id }: JobOf<JobName.CollectionNoticesCheck>): Promise<JobStatus> {
    const { collections, machineLearning } = await this.getConfig({ withCache: true });
    if (!collections.notifications.enabled || !isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const user = await this.userRepository.get(id, {});
    if (!user || !getPreferences(user.metadata).collectionNotifications.enabled) {
      return JobStatus.Skipped;
    }

    const auth: AuthDto = {
      user: {
        id: user.id,
        isAdmin: user.isAdmin,
        name: user.name,
        email: user.email,
        quotaUsageInBytes: user.quotaUsageInBytes,
        quotaSizeInBytes: user.quotaSizeInBytes,
      },
    };
    const notified = await this.notifyNewVisits(auth, collections.notifications, new Date());
    this.logger.log(`Found ${notified.length} new collection visit(s) to name for user ${id}`);
    return JobStatus.Success;
  }

  /**
   * Notifies the user of the new visits in their uploads since the last check, and returns them. The check is moved
   * on once every new visit was notified; while some wait (over `maxPerRun`), the same uploads are looked at again.
   */
  async notifyNewVisits(auth: AuthDto, config: NoticesConfig, now: Date): Promise<NewVisit[]> {
    const found = await this.findNewVisits(auth, config, now);
    const fresh = found.filter((visit) => visit.status === 'new');
    const notified: NewVisit[] = [];
    for (const visit of fresh.slice(0, config.maxPerRun)) {
      if (await this.notify(auth.user.id, visit)) {
        notified.push(visit);
      }
    }
    if (fresh.length <= config.maxPerRun) {
      await this.collectionNoticeRepository.setCheckedAt(auth.user.id, now);
    }
    return notified;
  }

  /**
   * Every visit of every pack in the photos the user uploaded since the last check (at most `windowDays` ago), the
   * newest first, with what became of it; nothing is written (see `collection-notice.dry-run.spec.ts`)
   */
  async findNewVisits(auth: AuthDto, config: Pick<NoticesConfig, 'windowDays'>, now: Date): Promise<NewVisit[]> {
    const windowStart = new Date(now.getTime() - config.windowDays * DAY_MS);
    const checkedAt = await this.collectionNoticeRepository.getCheckedAt(auth.user.id);
    const since = checkedAt && checkedAt > windowStart ? checkedAt : windowStart;
    const uploads = await this.collectionNoticeRepository.getUploads(auth.user.id, since, COLLECTION_LIMITS.assetIds);
    if (uploads.length === 0) {
      return [];
    }

    // "today" where the user takes photos: the local time of their newest photo, less its UTC time
    const newest = uploads[0];
    const offset = new Date(newest.localDateTime).getTime() - new Date(newest.fileCreatedAt).getTime();
    const today = toLocalDay(now.getTime() + (Math.abs(offset) <= DAY_MS ? offset : 0));

    const notices = await this.collectionNoticeRepository.getNotices(auth.user.id);
    const keys = new Set(notices.map(({ pack, key }) => `${pack}\n${key}`));
    const noticed = new Set(notices.flatMap(({ assetIds }) => assetIds));

    const collections = BaseService.create(CollectionService, this);
    const assetIds = uploads.map(({ id }) => id);
    const visits: NewVisit[] = [];
    for (const pack of getCollectionPacks()) {
      let result;
      try {
        result = await collections.findVisits(auth, pack.id, { assetIds });
      } catch (error: any) {
        this.logger.warn(`Unable to find the ${pack.id} visits of user ${auth.user.id}: ${error?.message ?? error}`);
        continue;
      }
      for (const visit of result.visits) {
        const ids = [...visit.subjectIds, ...visit.sourceIds, ...visit.signIds, ...visit.receiptIds];
        const key = getVisitKey(visit);
        const subjects = visit.subjectIds.length;
        const minSubjects = pack.notices?.minSubjects ?? DEFAULT_NOTICE_MIN_SUBJECTS;
        const status: NewVisitStatus =
          visit.saved.length > 0
            ? 'named'
            : keys.has(`${pack.id}\n${key}`) || ids.some((id) => noticed.has(id))
              ? 'notified'
              : subjects < minSubjects || (pack.notices?.requireSource && visit.sourceIds.length === 0)
                ? 'small'
                : 'new';
        const place = getNoticePlace(visit);
        visits.push({
          pack: pack.id,
          key,
          status,
          assetIds: ids,
          subjects,
          start: visit.start,
          ...(place && { place: redactText(pack, place) }),
          ...getNoticeText(pack, visit, today),
        });
      }
    }

    // the newest first; of the visits of the same photos in several packs, the one with the most subjects is notified
    const sorted = visits.toSorted(
      (a, b) => b.start.localeCompare(a.start) || b.subjects - a.subjects || a.pack.localeCompare(b.pack),
    );
    // photos of a visit named in one pack are that pack's: another pack finding them is mistaken
    const named = new Set(sorted.flatMap((visit) => (visit.status === 'named' ? visit.assetIds : [])));
    const taken = new Set<string>();
    for (const visit of sorted.toSorted((a, b) => b.subjects - a.subjects || b.start.localeCompare(a.start))) {
      if (visit.status !== 'new') {
        continue;
      }
      if (visit.assetIds.some((id) => named.has(id))) {
        visit.status = 'named-elsewhere';
      } else if (visit.assetIds.some((id) => taken.has(id))) {
        visit.status = 'duplicate';
      } else {
        for (const id of visit.assetIds) {
          taken.add(id);
        }
      }
    }
    return sorted;
  }

  /** claims the key of the visit and notifies the user; false when it was notified meanwhile */
  private async notify(userId: string, visit: NewVisit): Promise<boolean> {
    const claimed = await this.collectionNoticeRepository.claim({
      userId,
      pack: visit.pack,
      key: visit.key,
      assetIds: visit.assetIds,
    });
    if (!claimed) {
      return false;
    }

    try {
      const data: CollectionNoticeData = { collectionPack: visit.pack, assetIds: visit.assetIds, visitKey: visit.key };
      const notification = await this.notificationRepository.create({
        userId,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: visit.title,
        description: visit.description,
        data: JSON.stringify(data),
      });
      await this.collectionNoticeRepository.setNotification(claimed.id, notification.id);
      this.websocketRepository.clientSend('on_notification', userId, mapNotification(notification));
      return true;
    } catch (error: any) {
      // the visit is notified on the next run
      this.logger.warn(`Unable to notify user ${userId} of a ${visit.pack} visit: ${error?.message ?? error}`);
      await this.collectionNoticeRepository.delete(claimed.id);
      return false;
    }
  }
}

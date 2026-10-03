import { BadRequestException, Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { BookDraftResponseDto, BookResponseDto, mapBook } from 'src/dtos/book.dto.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  ActivityLogAction,
  BookDraftState,
  BookStatus,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
  Permission,
  QueueName,
} from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { BookService } from 'src/services/book.service.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { ActivityRecorder, quote, recordActivity, toBookSnapshot } from 'src/utils/activity-log.js';
import {
  DraftCandidate,
  DraftTripMemory,
  YEARLY_BOOKS,
  getBirthdayDraft,
  getBirthdayYear,
  getDraftPageCount,
  getTripDrafts,
  getYearlyDrafts,
  selectDrafts,
} from 'src/utils/book/drafts.js';
import { getCollectionPack } from 'src/utils/collections/registry.js';
import { getMemorySource } from 'src/utils/memory-source.js';
import { findOrFail } from 'src/utils/misc.js';
import { getPreferences } from 'src/utils/preferences.js';

type DraftsConfig = SystemConfig['books']['drafts'];

/** drafts waiting for the user to keep or discard them; no more are drafted until there are fewer */
export const MAX_PENDING_DRAFTS = 6;

/** the rules of the memory engine whose memories are trips */
const TRIP_MEMORY_RULES = ['recent_trip', 'trip_anniversary'];

/**
 * Photo books drafted for the users in the background (like memories): every night, and when asked, the books their
 * photos are enough for (a year of a collection pack, a trip, the year before a birthday; see
 * `src/utils/book/drafts.ts`) are laid out by the server's automatic layout, without an assistant, as drafts that are
 * left out of the list of books. The user keeps or discards them; every suggestion has a key, so it is made once.
 */
@Injectable()
export class BookDraftService extends BaseService {
  private bookService?: BookService;

  private get books() {
    this.bookService ??= BaseService.create(BookService, this);
    return this.bookService;
  }

  @OnJob({ name: JobName.BookDraftsQueueAll, queue: QueueName.BackgroundTask })
  async handleQueueAll(): Promise<JobStatus> {
    const { books } = await this.getConfig({ withCache: false });
    if (!books.drafts.enabled) {
      return JobStatus.Skipped;
    }

    const users = await this.userRepository.getList({ withDeleted: false });
    await this.jobRepository.queueAll(
      users
        .filter((user) => getPreferences(user.metadata).bookDrafts.enabled)
        .map((user) => ({ name: JobName.BookDraftsGenerate, data: { id: user.id } })),
    );
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.BookDraftsGenerate, queue: QueueName.BackgroundTask })
  async handleGenerate({ id }: JobOf<JobName.BookDraftsGenerate>): Promise<JobStatus> {
    const { books } = await this.getConfig({ withCache: true });
    if (!books.drafts.enabled) {
      return JobStatus.Skipped;
    }

    const user = await this.userRepository.get(id, {});
    if (!user || !getPreferences(user.metadata).bookDrafts.enabled) {
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
    const drafted = await this.draftBooks(auth, books.drafts, new Date());
    this.logger.log(`Drafted ${drafted.length} photo book(s) for user ${id}`);
    return JobStatus.Success;
  }

  /**
   * Drafts the books that were never suggested to the user, the newest first: at most `maxPerRun`, and no more than
   * `MAX_PENDING_DRAFTS` waiting for the user. Returns the keys drafted.
   */
  async draftBooks(auth: AuthDto, config: DraftsConfig, now: Date): Promise<string[]> {
    const pending = await this.bookDraftRepository.getPending(auth.user.id);
    const limit = Math.min(config.maxPerRun, MAX_PENDING_DRAFTS - pending.length);
    if (limit <= 0) {
      return [];
    }

    const [existingKeys, candidates] = await Promise.all([
      this.bookDraftRepository.getKeys(auth.user.id),
      this.findDrafts(auth.user.id, config, now),
    ]);

    const drafted: string[] = [];
    for (const candidate of selectDrafts(candidates, { existingKeys, kinds: config, limit })) {
      if (await this.draftBook(auth, candidate)) {
        drafted.push(candidate.key);
      }
    }
    return drafted;
  }

  /** every book the user's photos are enough for, of the kinds that are enabled */
  async findDrafts(ownerId: string, kinds: DraftsConfig, now: Date): Promise<DraftCandidate[]> {
    const candidates: DraftCandidate[] = [];
    // the trips and birthdays the memory engine found, so that a trip or a birthday has one definition (#5)
    const memories = await this.getMemorySources(ownerId, kinds, now);
    // a suggestion is made of a user's memories, so it leaves out what they keep out of them (#12)
    const exclusions = await BaseService.create(MemoryExclusionService, this).getExclusions(ownerId);

    if (kinds.yearly || kinds.trips) {
      const packs = [...(kinds.yearly ? Object.keys(YEARLY_BOOKS) : []), ...(kinds.trips ? ['travel'] : [])];
      const prefixes = packs.flatMap((id) => {
        const pack = getCollectionPack(id);
        return pack ? [`${pack.tagRoot}/`] : [];
      });
      const tags = await this.bookDraftRepository.getCollectionTags(ownerId, prefixes, exclusions);
      if (kinds.yearly) {
        candidates.push(...getYearlyDrafts(tags, now));
      }
      if (kinds.trips) {
        const timeline = await this.bookDraftRepository.getTimeline(ownerId, exclusions);
        const trips: DraftTripMemory[] = memories
          .filter((source) => source.kind === 'trip' && source.from && source.to)
          .map((source) => ({
            memoryId: source.memoryId,
            from: source.from!.getTime(),
            to: source.to!.getTime(),
            place: source.place,
          }));
        candidates.push(...getTripDrafts(tags, timeline, now, trips));
      }
    }

    if (kinds.birthdays) {
      for (const person of await this.bookDraftRepository.getPeopleWithBirthdays(ownerId)) {
        if (exclusions.personIds.includes(person.id)) {
          continue;
        }
        const year = getBirthdayYear(person.birthDate, now);
        if (!year) {
          continue;
        }
        const photos = await this.bookDraftRepository.getPersonPhotos(
          ownerId,
          person.id,
          new Date(year.from),
          new Date(year.to + 1),
          exclusions,
        );
        const draft = getBirthdayDraft(person, photos, now);
        if (draft) {
          // the birthday memory of the same day, whose window is the same year (see `getMemorySource`)
          const memory = memories.find(
            (source) =>
              source.kind === 'birthday' &&
              source.personIds[0] === person.id &&
              source.to?.toISOString().slice(0, 10) === new Date(draft.endsAt).toISOString().slice(0, 10),
          );
          candidates.push(memory ? { ...draft, memoryId: memory.memoryId } : draft);
        }
      }
    }

    return candidates;
  }

  /** the trip and birthday memories of the user, with their windows and places */
  private async getMemorySources(ownerId: string, kinds: DraftsConfig, now: Date) {
    const ruleIds = [...(kinds.trips ? TRIP_MEMORY_RULES : []), ...(kinds.birthdays ? ['birthday'] : [])];
    const rows = await this.bookDraftRepository.getRuleMemories(ownerId, ruleIds);
    return rows.map((row) => {
      const source = getMemorySource({ ...row, assetIds: [] }, now);
      const context = ((row.data as { context?: Record<string, unknown> } | null)?.context ?? {}) as Record<
        string,
        unknown
      >;
      const place = [context.city, context.country].find((value) => typeof value === 'string' && value.trim());
      return { ...source, place: place as string | undefined };
    });
  }

  /** claims the key, lays out the book and notifies the user; false when the key was taken or the layout failed */
  private async draftBook(auth: AuthDto, candidate: DraftCandidate): Promise<boolean> {
    return !!(await this.draftCandidate(auth, candidate, { notify: true }));
  }

  /**
   * Drafts one suggestion: claims its key, lays out the book, and notifies the user unless asked not to (the year
   * recap sends its own notification, #12). Returns the id of the book, or undefined when the key was taken or the
   * layout failed (the suggestion is then made again next time).
   */
  async draftCandidate(
    auth: AuthDto,
    candidate: DraftCandidate,
    { notify = true }: { notify?: boolean } = {},
  ): Promise<string | undefined> {
    const claimed = await this.bookDraftRepository.claim({
      ownerId: auth.user.id,
      key: candidate.key,
      kind: candidate.kind,
      title: candidate.title,
      reason: candidate.reason,
      memoryId: candidate.memoryId ?? null,
    });
    if (!claimed) {
      return;
    }

    try {
      const { book } = await this.books.createDraft(auth, {
        title: candidate.title,
        subtitle: candidate.subtitle,
        stylePreset: candidate.stylePreset,
        assetIds: candidate.assetIds,
        includeMaps: candidate.includeMaps,
        targetPageCount: getDraftPageCount(candidate.assetIds.length),
      });
      await this.bookDraftRepository.update(claimed.id, { bookId: book.id });
      if (notify) {
        await this.notify(auth.user.id, book.id, candidate);
      }
      // the routines that run after a book draft is made (#15)
      await this.eventRepository.emit('BookDraftCreate', {
        userId: auth.user.id,
        bookId: book.id,
        kind: candidate.kind,
        title: candidate.title,
        assetIds: candidate.assetIds,
      });
      return book.id;
    } catch (error: any) {
      // the suggestion is made again on the next run
      this.logger.warn(
        `Unable to draft the book ${candidate.key} for user ${auth.user.id}: ${error?.message ?? error}`,
      );
      await this.bookDraftRepository.delete(claimed.id);
      return;
    }
  }

  private async notify(userId: string, bookId: string, candidate: DraftCandidate) {
    try {
      const notification = await this.notificationRepository.create({
        userId,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: `A new photo book is ready to review: ${candidate.title}`,
        description: candidate.reason,
        data: JSON.stringify({ bookId }),
      });
      this.websocketRepository.clientSend('on_notification', userId, mapNotification(notification));
    } catch (error: any) {
      this.logger.warn(`Unable to notify user ${userId} of the book ${bookId}: ${error?.message ?? error}`);
    }
  }

  /** The drafts waiting for the user to keep or discard them, the newest first */
  async getDrafts(auth: AuthDto): Promise<BookDraftResponseDto[]> {
    const drafts = await this.bookDraftRepository.getPending(auth.user.id);
    const result: BookDraftResponseDto[] = [];
    for (const draft of drafts) {
      const book = draft.bookId ? await this.bookRepository.get(draft.bookId) : undefined;
      if (!book || book.status !== BookStatus.Draft) {
        continue;
      }
      result.push({
        id: draft.id,
        key: draft.key,
        kind: draft.kind,
        reason: draft.reason,
        memoryId: draft.memoryId,
        createdAt: draft.createdAt,
        book: mapBook(book),
      });
    }
    return result;
  }

  /** Looks for books to draft for the user now, in the background */
  async refresh(auth: AuthDto): Promise<void> {
    const { books } = await this.getConfig({ withCache: true });
    if (!books.drafts.enabled) {
      throw new BadRequestException('Suggested books are disabled on this server');
    }
    const metadata = await this.userRepository.getMetadata(auth.user.id);
    if (!getPreferences(metadata).bookDrafts.enabled) {
      throw new BadRequestException('Suggested books are turned off in your settings');
    }
    await this.jobRepository.queue({ name: JobName.BookDraftsGenerate, data: { id: auth.user.id } });
  }

  /** Keeps a draft: it becomes one of the user's books */
  async keep(auth: AuthDto, id: string, activity?: ActivityRecorder): Promise<BookResponseDto> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [id] });
    const book = await this.requireDraft(id);

    await this.bookRepository.update(id, { status: BookStatus.Active });
    const draft = await this.bookDraftRepository.getByBookId(id);
    if (draft) {
      await this.bookDraftRepository.update(draft.id, { state: BookDraftState.Kept });
    }
    await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, auth.user.id, activity, {
      action: ActivityLogAction.BookDraftKeep,
      summary: `Kept the suggested book ${quote(book.title)}`,
      targetId: id,
      undo: { bookId: id, draftId: draft?.id ?? null },
    });
    return mapBook(await findOrFail(() => this.bookRepository.get(id), 'Book'));
  }

  /** Discards a draft: the book is deleted, and it is not suggested again */
  async discard(auth: AuthDto, id: string, activity?: ActivityRecorder): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.BookDelete, ids: [id] });
    const book = await this.requireDraft(id);
    // the book is deleted: undoing lays it out again from this copy
    const draft = await this.bookDraftRepository.getByBookId(id);
    const snapshot = activity ? toBookSnapshot(book, await this.bookRepository.getPages(id)) : undefined;

    // deleting a draft discards its suggestion
    await this.books.delete(auth, id);

    if (snapshot) {
      await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, auth.user.id, activity, {
        action: ActivityLogAction.BookDraftDiscard,
        summary: `Discarded the suggested book ${quote(book.title)}`,
        targetId: id,
        undo: {
          bookId: id,
          draftId: draft?.id ?? null,
          draftState: draft?.state ?? BookDraftState.Drafted,
          book: { ownerId: book.ownerId, status: book.status, createdAt: book.createdAt.toISOString() },
          snapshot,
        },
      });
    }
  }

  private async requireDraft(id: string) {
    const book = await findOrFail(() => this.bookRepository.get(id), 'Book');
    if (book.status !== BookStatus.Draft) {
      throw new BadRequestException('The book is not a draft');
    }
    return book;
  }
}

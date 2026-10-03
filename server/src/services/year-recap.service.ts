import { BadRequestException, Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { BookDraftResponseDto } from 'src/dtos/book.dto.js';
import { HighlightJobResponseDto, MAX_HIGHLIGHT_ASSETS } from 'src/dtos/highlight.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  YearRecapBookDto,
  YearRecapExclusionOptions,
  YearRecapResponseDto,
  YearRecapVideoDto,
  hasExtraExclusions,
  toExtraExclusions,
} from 'src/dtos/year-recap.dto.js';
import {
  AssetType,
  BookDraftKind,
  JobName,
  JobStatus,
  MemoryType,
  NotificationLevel,
  NotificationType,
  QueueName,
} from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { BookDraftService } from 'src/services/book-draft.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import {
  getAdminAvailableMemoryTypeKeys,
  isMemoryTypeEnabledForUser,
} from 'src/services/memory-rules/memory-type.metadata.js';
import { YEAR_RECAP_RULE_ID } from 'src/services/memory-rules/year-recap.rule.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { pickSpread } from 'src/utils/agent/events.js';
import { MAX_DRAFT_PHOTOS } from 'src/utils/book/drafts.js';
import { MemoryExclusions, mergeMemoryExclusions } from 'src/utils/memory-exclusions.js';
import { getPreferences } from 'src/utils/preferences.js';
import { YearRecapStats, describeYearRecap, getYearRecapStats } from 'src/utils/year-recap.js';

/** the English title of a recap; the web names its creations after the card, in the viewer's language */
export const getYearRecapTitle = (year: number) => `${year} in review`;

const getContextYear = (data: unknown) => {
  const year = (data as { context?: { year?: unknown } } | null | undefined)?.context?.year;
  return typeof year === 'number' ? year : undefined;
};

/**
 * The year in review (#12). The `year_recap` rule of the memory engine makes the memory early in January; this service
 * then offers what can be made of it, never more: a notification, a book of the year drafted in the background (kept
 * or discarded like the other suggested books, when the user has those on), and a highlight video, landscape or
 * vertical, made only when asked. Everything leaves out what the user keeps out of their memories, and the assistant
 * can leave more out of one recap ("my 2026 recap without …").
 */
@Injectable()
export class YearRecapService extends BaseService {
  private get drafts() {
    return BaseService.create(BookDraftService, this);
  }

  /** a new year recap memory: tell its owner, and draft the book of the year when they have suggested books on */
  @OnJob({ name: JobName.YearRecapPrepare, queue: QueueName.BackgroundTask })
  async handlePrepare({ id }: JobOf<JobName.YearRecapPrepare>): Promise<JobStatus> {
    const memory = await this.memoryRepository.get(id);
    const ruleId = (memory?.data as { ruleId?: unknown } | null | undefined)?.ruleId;
    const year = getContextYear(memory?.data);
    if (!memory || memory.type !== MemoryType.Rule || ruleId !== YEAR_RECAP_RULE_ID || !year) {
      return JobStatus.Skipped;
    }

    const user = await this.userRepository.get(memory.ownerId, {});
    if (!user) {
      return JobStatus.Skipped;
    }
    const preferences = getPreferences(user.metadata ?? []);
    const { books, memories } = await this.getConfig({ withCache: true });
    if (
      !getAdminAvailableMemoryTypeKeys(memories).has(YEAR_RECAP_RULE_ID) ||
      !isMemoryTypeEnabledForUser(preferences.memories.types, YEAR_RECAP_RULE_ID)
    ) {
      return JobStatus.Skipped;
    }

    const auth = this.getAuth(user);
    let bookId: string | undefined;
    if (books.drafts.enabled && preferences.bookDrafts.enabled) {
      try {
        const draft = await this.draftBook(auth, year, {}, { automatic: true });
        bookId = draft?.book.id;
      } catch (error: any) {
        this.logger.warn(`Unable to draft the ${year} recap book of ${user.id}: ${error?.message ?? error}`);
      }
    }

    const stats = (memory.data as { context?: YearRecapStats }).context;
    try {
      const notification = await this.notificationRepository.create({
        userId: user.id,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: `Your ${year} in review is ready`,
        description:
          (stats && typeof stats.count === 'number' ? `${describeYearRecap(stats)}. ` : '') +
          (bookId
            ? 'Watch it, make a video of it, or keep the book of the year'
            : 'Watch it, or make a video or a book of it'),
        data: JSON.stringify({ memoryId: memory.id, year, ...(bookId && { bookId }) }),
      });
      this.websocketRepository.clientSend('on_notification', user.id, mapNotification(notification));
    } catch (error: any) {
      this.logger.warn(`Unable to notify ${user.id} of the ${year} recap: ${error?.message ?? error}`);
    }
    return JobStatus.Success;
  }

  /** the stats of a year, without what the user keeps out of their memories (and what this request leaves out) */
  async get(auth: AuthDto, year: number, options: YearRecapExclusionOptions = {}): Promise<YearRecapResponseDto> {
    const exclusions = await this.getExclusions(auth, options);
    const [stats, memoryId, draft] = await Promise.all([
      this.getStats(auth.user.id, year, exclusions),
      this.findMemoryId(auth.user.id, year),
      this.findDraft(auth, year),
    ]);
    return { year, ...(memoryId && { memoryId }), stats, ...(draft && { draft }) };
  }

  /**
   * Drafts the book of a year, kept or discarded like the suggested books. Asked again without exclusions of its own,
   * it returns the draft waiting for the user; with them, or once the first one was kept or discarded, it drafts a
   * new one.
   */
  async createBook(auth: AuthDto, year: number, dto: YearRecapBookDto = {}): Promise<BookDraftResponseDto> {
    if (!hasExtraExclusions(dto)) {
      const pending = await this.findDraft(auth, year);
      if (pending) {
        return pending;
      }
    }
    const draft = await this.draftBook(auth, year, dto, { automatic: false });
    if (!draft) {
      throw new BadRequestException(`Unable to lay out a book of ${year}`);
    }
    return draft;
  }

  /** Starts a highlight video of a year, landscape or vertical */
  async createVideo(
    auth: AuthDto,
    year: number,
    dto: YearRecapVideoDto = {},
    activity?: ActivityRecorder,
  ): Promise<HighlightJobResponseDto> {
    const highlights = BaseService.create(HighlightService, this);
    const options = {
      title: dto.title ?? getYearRecapTitle(year),
      format: dto.format,
      durationSeconds: dto.durationSeconds,
      music: dto.music,
    };

    const memoryId = hasExtraExclusions(dto) ? undefined : await this.findMemoryId(auth.user.id, year);
    if (memoryId) {
      // the whole year of the memory (see `getMemorySource`), without the memory exclusions
      return highlights.create(auth, { ...options, memoryId }, activity);
    }

    const assets = await this.getAssets(auth, year, dto);
    if (assets.length === 0) {
      throw new BadRequestException(`There are no photos or videos of ${year} to make a video of`);
    }
    const assetIds = pickSpread(assets, MAX_HIGHLIGHT_ASSETS).map(({ id }) => id);
    return highlights.create(auth, { ...options, assetIds }, activity);
  }

  /** the year_recap memory of a year, the newest when there are several */
  async findMemoryId(ownerId: string, year: number): Promise<string | undefined> {
    const memories = await this.bookDraftRepository.getRuleMemories(ownerId, [YEAR_RECAP_RULE_ID]);
    return memories.find((memory) => getContextYear(memory.data) === year)?.id;
  }

  private async findDraft(auth: AuthDto, year: number) {
    const memoryId = await this.findMemoryId(auth.user.id, year);
    const drafts = await this.drafts.getDrafts(auth);
    return drafts.find(
      (draft) =>
        draft.kind === BookDraftKind.Recap &&
        ((memoryId && draft.memoryId === memoryId) ||
          draft.key === `recap:${year}` ||
          draft.key.startsWith(`recap:${year}:`)),
    );
  }

  private async getExclusions(auth: AuthDto, options: YearRecapExclusionOptions): Promise<MemoryExclusions> {
    const stored = await BaseService.create(MemoryExclusionService, this).getExclusions(auth.user.id);
    return mergeMemoryExclusions(stored, toExtraExclusions(options));
  }

  private async getStats(ownerId: string, year: number, exclusions: MemoryExclusions) {
    const [assets, people, tags] = await Promise.all([
      this.yearRecapRepository.getAssets(ownerId, year, exclusions),
      this.yearRecapRepository.getPeople(ownerId, year, exclusions),
      this.yearRecapRepository.getJournalTags(ownerId, year, exclusions),
    ]);
    return getYearRecapStats(year, assets, people, tags);
  }

  private async getAssets(auth: AuthDto, year: number, options: YearRecapExclusionOptions) {
    const exclusions = await this.getExclusions(auth, options);
    return this.yearRecapRepository.getAssets(auth.user.id, year, exclusions);
  }

  /** lays out a draft of the year; the automatic one (from the memory) is made once, by its key */
  private async draftBook(
    auth: AuthDto,
    year: number,
    dto: YearRecapBookDto,
    { automatic }: { automatic: boolean },
  ): Promise<BookDraftResponseDto | undefined> {
    const exclusions = await this.getExclusions(auth, dto);
    const assets = await this.yearRecapRepository.getAssets(auth.user.id, year, exclusions);
    const photos = assets.filter((asset) => asset.type === AssetType.Image);
    if (photos.length === 0) {
      throw new BadRequestException(`There are no photos of ${year} to make a book of`);
    }

    const [memoryId, keys] = await Promise.all([
      this.findMemoryId(auth.user.id, year),
      this.bookDraftRepository.getKeys(auth.user.id),
    ]);
    const baseKey = `recap:${year}`;
    if (automatic && keys.has(baseKey)) {
      return;
    }
    const key = keys.has(baseKey) ? `${baseKey}:${Date.now()}` : baseKey;
    const stats = await this.getStats(auth.user.id, year, exclusions);
    const assetIds = pickSpread(photos, MAX_DRAFT_PHOTOS).map(({ id }) => id);
    const bookId = await this.drafts.draftCandidate(
      auth,
      {
        key,
        kind: BookDraftKind.Recap,
        title: dto.title ?? getYearRecapTitle(year),
        subtitle: String(year),
        reason: `Your ${year}: ${describeYearRecap(stats)}`,
        stylePreset: 'classic',
        includeMaps: false,
        assetIds,
        endsAt: Date.UTC(year, 11, 31, 23, 59, 59),
        ...(memoryId && { memoryId }),
      },
      { notify: false },
    );
    if (!bookId) {
      return;
    }
    const drafts = await this.drafts.getDrafts(auth);
    return drafts.find((draft) => draft.book.id === bookId);
  }

  private getAuth(user: {
    id: string;
    isAdmin: boolean;
    name: string;
    email: string;
    quotaUsageInBytes: number;
    quotaSizeInBytes: number | null;
  }): AuthDto {
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

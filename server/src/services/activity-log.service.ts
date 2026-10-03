import { BadRequestException, Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { DateTime } from 'luxon';
import { OnJob } from 'src/decorators.js';
import {
  ActivityLogResponseDto,
  ActivityLogSearchDto,
  ActivityUndoDto,
  ActivityUndoResponseDto,
  ActivityUndoResultDto,
  REDOABLE_ACTIONS,
  mapActivityLog,
} from 'src/dtos/activity-log.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  ActivityLogAction,
  ActivityLogSource,
  ActivityUndoStatus,
  ArtJobStatus,
  AssetVisibility,
  BookDraftState,
  BookStatus,
  HighlightJobStatus,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
  Permission,
  QueueName,
} from 'src/enum.js';
import { ActivityLogTable } from 'src/schema/tables/activity-log.table.js';
import { AlbumService } from 'src/services/album.service.js';
import { ArtService } from 'src/services/art.service.js';
import { AssetService } from 'src/services/asset.service.js';
import { BaseService } from 'src/services/base.service.js';
import { BookStyleService } from 'src/services/book-style.service.js';
import { BookService } from 'src/services/book.service.js';
import { BurstService } from 'src/services/burst.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { SharedLinkService } from 'src/services/shared-link.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { StackService } from 'src/services/stack.service.js';
import { TagService } from 'src/services/tag.service.js';
import { WorkflowService } from 'src/services/workflow.service.js';
import { checkOwnedAssets } from 'src/utils/access.js';
import {
  ActivityEntry,
  ActivityRecorder,
  ActivityUndoMap,
  BOOK_REVISIONS_KEPT,
  BookChange,
  BookSnapshot,
  beginBookChange,
  countPhotos,
  fingerprintBook,
  fingerprintWorkflow,
  quote,
  recordActivity,
  snapshotBook,
} from 'src/utils/activity-log.js';
import { getCollectionTagRules } from 'src/utils/collections/pack.js';
import { getCollectionPack } from 'src/utils/collections/registry.js';
import { getTagPrefix, parseCollectionTag } from 'src/utils/collections/tags.js';
import { upsertTags } from 'src/utils/tag.js';

type ActivityRow = Selectable<ActivityLogTable>;

type UndoOutcome = { status: ActivityUndoStatus; message?: string; warnings?: string[] };

/** a change can't be undone safely; the message says why and what to do instead */
class UndoRefusal extends Error {}

const refuse = (message: string): never => {
  throw new UndoRefusal(message);
};

const undone = (warnings: string[] = []): UndoOutcome => ({ status: ActivityUndoStatus.Undone, warnings });

const unique = <T>(values: T[]) => [...new Set(values)];

const sameSet = (a: string[], b: string[]) => {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((value) => set.has(value));
};

const errorMessage = (error: unknown) => {
  const message = (error as any)?.response?.message ?? (error as any)?.message ?? String(error);
  return Array.isArray(message) ? message.join('; ') : String(message);
};

/** a change that is part of a book: "“Sicily” (page 3)", or "the cover of “Sicily”" */
const describePlacement = ({ title, position }: { title: string; position: number | null }) =>
  position === null ? `the cover of ${quote(title)}` : `${quote(title)} (page ${position + 1})`;

/** undos of one user run one at a time, so two clicks can't undo the same change twice */
const userLocks = new Map<string, Promise<unknown>>();

/** the changes of an auto-approved chat turn above which the user is told to review them */
export const AUTO_APPROVED_CHANGES_NOTIFY_MIN = 2;

/**
 * The activity log: records the changes of the assistant (and of its features in the web app) with their inverse,
 * lists them, and undoes them after checking that nothing depends on them any more.
 */
@Injectable()
export class ActivityLogService extends BaseService {
  /** Records a change, when the request has a recorder; see `recordActivity` */
  record(auth: AuthDto, recorder: ActivityRecorder | undefined, entry: ActivityEntry) {
    return recordActivity(
      { repository: this.activityLogRepository, logger: this.logger },
      auth.user.id,
      recorder,
      entry,
    );
  }

  snapshotBook(bookId: string): Promise<BookSnapshot | undefined> {
    return snapshotBook(this.bookRepository, bookId);
  }

  /** See `beginBookChange` */
  beginBookChange(recorder: ActivityRecorder | undefined, bookId?: string): Promise<BookChange | undefined> {
    return beginBookChange(
      { activityLogRepository: this.activityLogRepository, bookRepository: this.bookRepository, logger: this.logger },
      recorder,
      bookId,
    );
  }

  async search(auth: AuthDto, dto: ActivityLogSearchDto): Promise<ActivityLogResponseDto[]> {
    const rows = await this.activityLogRepository.search(auth.user.id, dto);
    return rows.map((row) => mapActivityLog(row));
  }

  /** Undoes one change */
  undo(auth: AuthDto, id: string, source = ActivityLogSource.Web): Promise<ActivityUndoResponseDto> {
    return this.undoAll(auth, { ids: [id] }, source);
  }

  /** Undoes changes, or every change of a group, newest first */
  async undoAll(
    auth: AuthDto,
    { ids = [], groupId }: ActivityUndoDto,
    source = ActivityLogSource.Web,
  ): Promise<ActivityUndoResponseDto> {
    return this.withUserLock(auth.user.id, async () => {
      const rows = new Map<string, ActivityRow>();
      for (const row of await this.activityLogRepository.getByIds(auth.user.id, unique(ids))) {
        rows.set(row.id, row);
      }
      if (groupId) {
        const group = await this.activityLogRepository.search(auth.user.id, { groupId, limit: 1000 });
        for (const row of group) {
          rows.set(row.id, row);
        }
      }

      const missing = ids.filter((id) => !rows.has(id));
      if (rows.size === 0 || missing.length > 0) {
        throw new BadRequestException(
          missing.length > 0 ? `Change not found: ${missing.join(', ')}` : 'No changes found in this group',
        );
      }

      // newest first, so that a change is undone before the changes it builds on
      const ordered = rows
        .values()
        .toArray()
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));

      const results: ActivityUndoResultDto[] = [];
      for (const row of ordered) {
        const outcome = await this.undoRow(auth, row);
        if (outcome.status === ActivityUndoStatus.Undone || outcome.status === ActivityUndoStatus.Partial) {
          await this.activityLogRepository.setUndone([row.id], source);
        }
        results.push({
          id: row.id,
          summary: row.summary,
          status: outcome.status,
          ...(outcome.message && { message: outcome.message }),
          warnings: outcome.warnings ?? [],
        });
      }

      return {
        results,
        undone: results.filter(
          ({ status }) => status === ActivityUndoStatus.Undone || status === ActivityUndoStatus.Partial,
        ).length,
        refused: results.filter(
          ({ status }) => status === ActivityUndoStatus.Refused || status === ActivityUndoStatus.Failed,
        ).length,
      };
    });
  }

  /** Applies an undone change again; only for changes that are simple to repeat (see `REDOABLE_ACTIONS`) */
  async redo(auth: AuthDto, id: string): Promise<ActivityLogResponseDto> {
    return this.withUserLock(auth.user.id, async () => {
      const [row] = await this.activityLogRepository.getByIds(auth.user.id, [id]);
      if (!row) {
        throw new BadRequestException('Change not found');
      }
      if (!row.undoneAt || !row.undo || !REDOABLE_ACTIONS.has(row.action)) {
        throw new BadRequestException('This change can not be redone');
      }

      // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- only REDOABLE_ACTIONS get here
      switch (row.action) {
        case ActivityLogAction.AlbumAddAssets: {
          const { albumId, assetIds } = row.undo as ActivityUndoMap[ActivityLogAction.AlbumAddAssets];
          await this.albums().addAssets(auth, albumId, { ids: assetIds });
          break;
        }
        case ActivityLogAction.AlbumRemoveAssets: {
          const { albumId, assetIds } = row.undo as ActivityUndoMap[ActivityLogAction.AlbumRemoveAssets];
          await this.albums().removeAssets(auth, albumId, { ids: assetIds });
          break;
        }
        case ActivityLogAction.BurstCleanup: {
          await this.redoBurstCleanup(auth, row.undo as ActivityUndoMap[ActivityLogAction.BurstCleanup]);
          break;
        }
        case ActivityLogAction.SpaceAddAssets: {
          const { spaceId, assetIds } = row.undo as ActivityUndoMap[ActivityLogAction.SpaceAddAssets];
          await BaseService.create(SharedSpaceService, this).addAssets(auth, spaceId, { assetIds });
          break;
        }
        case ActivityLogAction.BookDraftKeep: {
          const { bookId, draftId } = row.undo as ActivityUndoMap[ActivityLogAction.BookDraftKeep];
          await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [bookId] }).catch(() =>
            refuse('The book no longer exists'),
          );
          await this.bookRepository.update(bookId, { status: BookStatus.Active });
          if (draftId) {
            await this.bookDraftRepository.update(draftId, { state: BookDraftState.Kept });
          }
          break;
        }
      }

      await this.activityLogRepository.clearUndone(row.id);
      return mapActivityLog({ ...row, undoneAt: null, undoneBy: null });
    });
  }

  @OnJob({ name: JobName.ActivityLogCleanup, queue: QueueName.BackgroundTask })
  async handleCleanup(): Promise<JobStatus> {
    const { agent } = await this.getConfig({ withCache: false });
    const before = DateTime.now().minus({ days: agent.activityRetentionDays }).toJSDate();
    const count = await this.activityLogRepository.deleteOlderThan(before);
    if (count > 0) {
      this.logger.log(`Removed ${count} activity log entries older than ${agent.activityRetentionDays} days`);
    }
    return JobStatus.Success;
  }

  /** "The assistant made 12 changes: review or undo them", after a chat turn that changed things without asking */
  async notifyAutoApprovedChanges(userId: string, { sessionId, groupId }: { sessionId: string; groupId: string }) {
    try {
      const count = await this.activityLogRepository.countGroup(groupId);
      if (count < AUTO_APPROVED_CHANGES_NOTIFY_MIN) {
        return;
      }
      const item = await this.notificationRepository.create({
        userId,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: `The assistant made ${count} changes`,
        description: 'Review or undo them in the activity log',
        data: JSON.stringify({ activityGroupId: groupId, sessionId }),
      });
      this.websocketRepository.clientSend('on_notification', userId, mapNotification(item));
    } catch (error) {
      this.logger.warn(`Unable to notify about the changes of assistant chat ${sessionId}: ${error}`);
    }
  }

  private async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = userLocks.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    const settled = next.catch(() => {});
    userLocks.set(userId, settled);
    try {
      return await next;
    } finally {
      if (userLocks.get(userId) === settled) {
        userLocks.delete(userId);
      }
    }
  }

  private async undoRow(auth: AuthDto, row: ActivityRow): Promise<UndoOutcome> {
    if (row.undoneAt) {
      return { status: ActivityUndoStatus.AlreadyUndone, message: 'This change was already undone' };
    }
    if (!row.undo) {
      return { status: ActivityUndoStatus.Refused, message: 'This change can not be undone' };
    }

    try {
      const outcome = await this.applyInverse(auth, row);
      if (outcome.status === ActivityUndoStatus.Undone && outcome.message) {
        return { ...outcome, status: ActivityUndoStatus.Partial };
      }
      return outcome;
    } catch (error) {
      if (error instanceof UndoRefusal) {
        return { status: ActivityUndoStatus.Refused, message: error.message };
      }
      this.logger.warn(`Unable to undo change ${row.id} (${row.action}): ${error}`);
      return { status: ActivityUndoStatus.Failed, message: errorMessage(error) };
    }
  }

  /** the inverse of each kind of change, with its safety checks */
  private applyInverse(auth: AuthDto, row: ActivityRow): Promise<UndoOutcome> {
    const undo = row.undo as any;
    switch (row.action) {
      case ActivityLogAction.AlbumCreate: {
        return this.undoAlbumCreate(auth, undo);
      }
      case ActivityLogAction.AlbumAddAssets: {
        return this.undoAlbumAdd(auth, undo);
      }
      case ActivityLogAction.AlbumRemoveAssets: {
        return this.undoAlbumRemove(auth, undo);
      }
      case ActivityLogAction.AssetCopy: {
        return this.trashAssets(auth, (undo as ActivityUndoMap[ActivityLogAction.AssetCopy]).copies);
      }
      case ActivityLogAction.AssetCreate: {
        const { assetIds } = undo as ActivityUndoMap[ActivityLogAction.AssetCreate];
        return this.trashAssets(
          auth,
          assetIds.map((id) => ({ id })),
        );
      }
      case ActivityLogAction.Artwork: {
        return this.undoArtwork(auth, undo);
      }
      case ActivityLogAction.ArtStyleCreate: {
        return this.undoArtStyle(auth, undo);
      }
      case ActivityLogAction.BookStyleCreate: {
        return this.undoBookStyle(auth, undo);
      }
      case ActivityLogAction.BookCreate: {
        return this.undoBookCreate(auth, undo);
      }
      case ActivityLogAction.BookEdit: {
        return this.undoBookEdit(auth, undo);
      }
      case ActivityLogAction.BookDraftKeep: {
        return this.undoDraftKeep(auth, undo);
      }
      case ActivityLogAction.BookDraftDiscard: {
        return this.undoDraftDiscard(auth, undo);
      }
      case ActivityLogAction.BurstCleanup: {
        return this.undoBurstCleanup(auth, undo);
      }
      case ActivityLogAction.CollectionEntries: {
        return this.undoCollectionEntries(auth, undo);
      }
      case ActivityLogAction.HighlightCreate: {
        return this.undoHighlight(auth, undo);
      }
      case ActivityLogAction.MemoryExclusionChange: {
        return this.undoMemoryExclusionChange(auth, undo);
      }
      case ActivityLogAction.SharedLinkCreate: {
        return this.undoSharedLink(auth, undo);
      }
      case ActivityLogAction.SpaceAddAssets: {
        return this.undoSpaceAdd(auth, undo);
      }
      case ActivityLogAction.WorkflowCreate: {
        return this.undoWorkflowCreate(auth, undo);
      }
      case ActivityLogAction.WorkflowUpdate: {
        return this.undoWorkflowUpdate(auth, undo);
      }
    }
  }

  private albums() {
    return BaseService.create(AlbumService, this);
  }

  /** puts the memory exclusions back as they were before the change (#12) */
  private async undoMemoryExclusionChange(
    auth: AuthDto,
    undo: ActivityUndoMap[ActivityLogAction.MemoryExclusionChange],
  ): Promise<UndoOutcome> {
    await BaseService.create(MemoryExclusionService, this).revert(auth.user.id, undo);
    return undone();
  }

  /** deletes the album, but only while it is exactly as it was created: albums have no trash */
  private async undoAlbumCreate(
    auth: AuthDto,
    { albumId, name, description, assetIds }: ActivityUndoMap[ActivityLogAction.AlbumCreate],
  ): Promise<UndoOutcome> {
    const album = await this.activityLogRepository.getAlbumState(albumId);
    if (!album || album.deletedAt) {
      return undone(['The album was already deleted']);
    }

    const reasons: string[] = [];
    if (album.albumName !== name) {
      reasons.push(`it was renamed to ${quote(album.albumName)}`);
    }
    if ((album.description ?? '') !== (description ?? '')) {
      reasons.push('its description was changed');
    }
    const current = album.assetIds ?? [];
    if (!sameSet(current, assetIds)) {
      const added = current.filter((id) => !assetIds.includes(id)).length;
      const removed = assetIds.filter((id) => !current.includes(id)).length;
      reasons.push(
        [added > 0 && `${countPhotos(added)} were added`, removed > 0 && `${countPhotos(removed)} were removed`]
          .filter(Boolean)
          .join(' and '),
      );
    }
    if (Number(album.sharedUsers ?? 0) > 0 || Number(album.sharedLinks ?? 0) > 0) {
      reasons.push('it is shared');
    }
    if (reasons.length > 0) {
      refuse(
        `The album ${quote(album.albumName)} changed since it was created (${reasons.join('; ')}), so it is kept. ` +
          'Albums have no trash: delete it yourself if you no longer want it.',
      );
    }

    await this.albums().delete(auth, albumId);
    return undone();
  }

  private async undoAlbumAdd(
    auth: AuthDto,
    { albumId, assetIds }: ActivityUndoMap[ActivityLogAction.AlbumAddAssets],
  ): Promise<UndoOutcome> {
    const album = await this.activityLogRepository.getAlbumState(albumId);
    if (!album || album.deletedAt) {
      return undone(['The album was deleted since']);
    }

    const results = await this.albums().removeAssets(auth, albumId, { ids: assetIds });
    const notInAlbum = results.filter(({ error }) => error === 'not_found').length;
    const failed = results.filter(({ success, error }) => !success && error !== 'not_found');
    if (failed.length === assetIds.length) {
      refuse(`The photos could not be removed from ${quote(album.albumName)} (${failed[0]?.error ?? 'unknown'})`);
    }
    return {
      status: ActivityUndoStatus.Undone,
      ...(failed.length > 0 && { message: `${countPhotos(failed.length)} could not be removed` }),
      warnings: notInAlbum > 0 ? [`${countPhotos(notInAlbum)} had already been removed from the album`] : [],
    };
  }

  private async undoAlbumRemove(
    auth: AuthDto,
    { albumId, assetIds }: ActivityUndoMap[ActivityLogAction.AlbumRemoveAssets],
  ): Promise<UndoOutcome> {
    const album = await this.activityLogRepository.getAlbumState(albumId);
    if (!album || album.deletedAt) {
      refuse('The album was deleted since, so the photos can not be put back');
    }

    const results = await this.albums().addAssets(auth, albumId, { ids: assetIds });
    const duplicate = results.filter(({ error }) => error === 'duplicate').length;
    const failed = results.filter(({ success, error }) => !success && error !== 'duplicate');
    if (failed.length === assetIds.length) {
      refuse(`The photos could not be put back in the album (${failed[0]?.error ?? 'unknown'})`);
    }
    return {
      status: ActivityUndoStatus.Undone,
      ...(failed.length > 0 && {
        message: `${countPhotos(failed.length)} could not be put back (deleted or no longer shared with you)`,
      }),
      warnings: duplicate > 0 ? [`${countPhotos(duplicate)} were already back in the album`] : [],
    };
  }

  /**
   * Moves created assets (copies, artworks, videos, collages) to the trash and takes them out of their stacks, as
   * the stacks were before. Refused while any of them is placed in a book.
   */
  private async trashAssets(auth: AuthDto, items: Array<{ id: string; sourceId?: string }>): Promise<UndoOutcome> {
    const ids = unique(items.map(({ id }) => id));
    const placements = await this.activityLogRepository.getBookPlacements(ids);
    if (placements.length > 0) {
      const where = unique(placements.map((placement) => describePlacement(placement)));
      refuse(
        `${ids.length === 1 ? 'The photo is' : 'Some of the photos are'} placed in ${where.slice(0, 3).join(', ')}` +
          `${where.length > 3 ? ` and ${where.length - 3} more` : ''}: remove ${ids.length === 1 ? 'it' : 'them'} from ` +
          'the book first, or undo that change.',
      );
    }

    const warnings: string[] = [];
    const assets = await this.activityLogRepository.getAssets(ids);
    const found = new Set(assets.map(({ id }) => id));
    const gone = ids.filter((id) => !found.has(id)).length;
    if (gone > 0) {
      warnings.push(`${countPhotos(gone)} had already been deleted`);
    }
    const trashed = assets.filter(({ deletedAt }) => deletedAt).length;
    if (trashed > 0) {
      warnings.push(`${countPhotos(trashed)} were already in the trash`);
    }

    const targets = assets.filter(({ deletedAt }) => !deletedAt);
    if (targets.length === 0) {
      return undone(warnings);
    }

    const albums = await this.activityLogRepository.getAlbumsOfAssets(targets.map(({ id }) => id));
    for (const name of unique(albums.map(({ albumName }) => albumName))) {
      warnings.push(`It was also in the album ${quote(name)}, which no longer shows it`);
    }

    // take the copies out of their stacks, and remove the stacks that only held a copy and its original
    const sources = new Map(items.map(({ id, sourceId }) => [id, sourceId]));
    const byStack = new Map<string, string[]>();
    for (const { id, stackId } of targets) {
      if (stackId) {
        byStack.set(stackId, [...(byStack.get(stackId) ?? []), id]);
      }
    }
    for (const [stackId, members] of byStack) {
      const stack = await this.activityLogRepository.getStack(stackId);
      if (!stack) {
        continue;
      }
      const remaining = (stack.assetIds ?? []).filter((id) => !members.includes(id));
      if (remaining.length <= 1) {
        await this.stackRepository.delete(stackId);
        await this.eventRepository.emit('StackDelete', { stackId, userId: auth.user.id });
        continue;
      }
      if (members.includes(stack.primaryAssetId)) {
        const source = members.map((id) => sources.get(id)).find((id) => id && remaining.includes(id));
        await this.stackRepository.update(stackId, { primaryAssetId: source ?? remaining[0] });
      }
      for (const id of members) {
        await this.assetRepository.update({ id, stackId: null });
      }
      await this.eventRepository.emit('StackUpdate', { stackId, userId: auth.user.id });
    }

    await BaseService.create(AssetService, this).deleteAll(auth, {
      ids: targets.map(({ id }) => id),
      force: false,
    });
    return undone(warnings);
  }

  private async undoArtwork(
    auth: AuthDto,
    { jobId }: ActivityUndoMap[ActivityLogAction.Artwork],
  ): Promise<UndoOutcome> {
    const job = await this.artJobRepository.get(jobId);
    if (!job) {
      return undone(['The artwork is no longer in the library']);
    }
    if (job.status === ArtJobStatus.Pending || job.status === ArtJobStatus.Running) {
      refuse('The artwork is still being made: undo it once it is done');
    }
    if (job.status === ArtJobStatus.Failed || !job.resultAssetId) {
      return undone(job.status === ArtJobStatus.Failed ? ['No artwork was made'] : ['The artwork was deleted']);
    }
    return this.trashAssets(auth, [{ id: job.resultAssetId, sourceId: job.sourceAssetId }]);
  }

  private async undoArtStyle(
    auth: AuthDto,
    { styleId, updatedAt }: ActivityUndoMap[ActivityLogAction.ArtStyleCreate],
  ): Promise<UndoOutcome> {
    const style = await this.artJobRepository.getStyle(styleId);
    if (!style) {
      return undone(['The style was already deleted']);
    }
    if (style.updatedAt.toISOString() !== updatedAt) {
      refuse(`The style ${quote(style.name)} was edited since it was saved, so it is kept`);
    }
    await BaseService.create(ArtService, this).deleteStyle(auth, styleId);
    return undone();
  }

  private async undoBookStyle(
    auth: AuthDto,
    { styleId, updatedAt }: ActivityUndoMap[ActivityLogAction.BookStyleCreate],
  ): Promise<UndoOutcome> {
    const style = await this.bookRepository.getStyle(styleId);
    if (!style) {
      return undone(['The style was already deleted']);
    }
    if (style.updatedAt.toISOString() !== updatedAt) {
      refuse(`The style ${quote(style.name)} was edited since it was saved, so it is kept`);
    }
    // books that use the style keep their copy of it
    await BaseService.create(BookStyleService, this).delete(auth, styleId);
    return undone();
  }

  /** deletes a new book, but only while it is exactly as the change left it: books have no trash */
  private async undoBookCreate(
    auth: AuthDto,
    { bookId, fingerprint }: ActivityUndoMap[ActivityLogAction.BookCreate],
  ): Promise<UndoOutcome> {
    const book = await this.snapshotBook(bookId);
    if (!book) {
      return undone(['The book was already deleted']);
    }
    if (fingerprintBook(book) !== fingerprint) {
      refuse(
        `The book ${quote(book.title)} was changed after it was created, so it is kept: undo those changes first, ` +
          'or delete the book yourself.',
      );
    }
    if ((await this.activityLogRepository.countBookSharedLinks(bookId)) > 0) {
      refuse(`The book ${quote(book.title)} is shared with a link: delete the link first, or undo sharing it`);
    }

    await BaseService.create(BookService, this).delete(auth, bookId);
    return undone();
  }

  /** restores the book from the snapshot taken before the change, while no later change depends on it */
  private async undoBookEdit(
    auth: AuthDto,
    { bookId, revisionId, fingerprint, copies = [] }: ActivityUndoMap[ActivityLogAction.BookEdit],
  ): Promise<UndoOutcome> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [bookId] }).catch(() =>
      refuse('The book was deleted, so the change can not be undone'),
    );
    const book = await this.snapshotBook(bookId);
    if (!book) {
      return refuse('The book was deleted, so the change can not be undone');
    }
    if (fingerprintBook(book) !== fingerprint) {
      refuse(`The book ${quote(book.title)} was changed again after this: undo the later changes first`);
    }
    const revision = await this.activityLogRepository.getRevision(revisionId);
    if (!revision) {
      refuse(`This change is too old to undo: only the last ${BOOK_REVISIONS_KEPT} versions of a book are kept`);
    }

    const warnings = await this.restoreBook(bookId, revision!.snapshot);
    if (copies.length === 0) {
      return undone(warnings);
    }

    // the copies the change made are no longer in the book: move them to the trash too
    try {
      const outcome = await this.trashAssets(auth, copies);
      return { ...outcome, warnings: [...warnings, ...(outcome.warnings ?? [])] };
    } catch (error) {
      return {
        status: ActivityUndoStatus.Undone,
        message: `The book was restored, but its improved copies were kept: ${errorMessage(error)}`,
        warnings,
      };
    }
  }

  /** writes a snapshot back into a book; photos deleted since are left out */
  private async restoreBook(bookId: string, snapshot: BookSnapshot): Promise<string[]> {
    const assetIds = unique([
      ...snapshot.pages.flatMap(({ assets }) => assets.map(({ assetId }) => assetId)),
      ...(snapshot.coverAssetId ? [snapshot.coverAssetId] : []),
    ]);
    const found = await this.activityLogRepository.getAssets(assetIds);
    const existing = new Set(found.map(({ id }) => id));
    const album = snapshot.albumId ? await this.activityLogRepository.getAlbumState(snapshot.albumId) : undefined;

    await this.bookRepository.update(bookId, {
      title: snapshot.title,
      subtitle: snapshot.subtitle,
      pageWidthMm: snapshot.pageWidthMm,
      pageHeightMm: snapshot.pageHeightMm,
      style: snapshot.style,
      coverAssetId: snapshot.coverAssetId && existing.has(snapshot.coverAssetId) ? snapshot.coverAssetId : null,
      albumId: album ? snapshot.albumId : null,
    });
    await this.bookRepository.replacePages(
      bookId,
      snapshot.pages.map(({ assets, ...page }) => ({
        ...page,
        assets: assets.filter(({ assetId }) => existing.has(assetId)),
      })),
    );

    const missing = assetIds.filter((id) => !existing.has(id)).length;
    return missing > 0 ? [`${countPhotos(missing)} of the book were deleted since and left out`] : [];
  }

  private async undoDraftKeep(
    auth: AuthDto,
    { bookId, draftId }: ActivityUndoMap[ActivityLogAction.BookDraftKeep],
  ): Promise<UndoOutcome> {
    await this.requireAccess({ auth, permission: Permission.BookUpdate, ids: [bookId] }).catch(() =>
      refuse('The book was deleted since'),
    );
    const book = await this.bookRepository.get(bookId);
    if (!book) {
      return refuse('The book was deleted since');
    }
    if (book.status !== BookStatus.Draft) {
      await this.bookRepository.update(bookId, { status: BookStatus.Draft });
    }
    if (draftId) {
      await this.bookDraftRepository.update(draftId, { state: BookDraftState.Drafted });
    }
    return undone();
  }

  /** a discarded draft was deleted: it is laid out again from its snapshot, with the same id */
  private async undoDraftDiscard(
    auth: AuthDto,
    undo: ActivityUndoMap[ActivityLogAction.BookDraftDiscard],
  ): Promise<UndoOutcome> {
    const { bookId, draftId, draftState, snapshot } = undo;
    if (await this.bookRepository.get(bookId)) {
      return undone(['The book was already back']);
    }
    if (undo.book.ownerId !== auth.user.id) {
      refuse('Only the owner of the book can bring it back');
    }

    const album = snapshot.albumId ? await this.activityLogRepository.getAlbumState(snapshot.albumId) : undefined;
    const covers = snapshot.coverAssetId ? await this.activityLogRepository.getAssets([snapshot.coverAssetId]) : [];
    const cover = covers.length > 0;
    await this.bookRepository.create({
      id: bookId,
      ownerId: auth.user.id,
      albumId: album ? snapshot.albumId : null,
      coverAssetId: cover ? snapshot.coverAssetId : null,
      title: snapshot.title,
      subtitle: snapshot.subtitle,
      pageWidthMm: snapshot.pageWidthMm,
      pageHeightMm: snapshot.pageHeightMm,
      style: snapshot.style,
      status: undo.book.status,
    });
    const warnings = await this.restoreBook(bookId, snapshot);
    if (draftId) {
      await this.bookDraftRepository.update(draftId, { state: draftState, bookId });
    }
    return undone(warnings);
  }

  /**
   * Un-archives exactly the photos a burst cleanup archived, while they are still the user's, in the library and in
   * the archive (a photo moved since stays where it is now), and gives their stack its cover photo back.
   */
  private async undoBurstCleanup(
    auth: AuthDto,
    { groups }: ActivityUndoMap[ActivityLogAction.BurstCleanup],
  ): Promise<UndoOutcome> {
    const ids = unique(groups.flatMap(({ archivedAssetIds }) => archivedAssetIds));
    const owned = await checkOwnedAssets(this.accessRepository, auth, ids);
    const assets = await this.activityLogRepository.getAssets(ids);
    const found = new Map(assets.map((asset) => [asset.id, asset]));

    const warnings: string[] = [];
    const gone = ids.filter((id) => !found.get(id) || found.get(id)!.deletedAt).length;
    if (gone > 0) {
      warnings.push(`${countPhotos(gone)} ${gone === 1 ? 'was' : 'were'} deleted since`);
    }
    const present = assets.filter(({ id, deletedAt }) => !deletedAt && owned.has(id));
    const moved = present.filter(({ visibility }) => visibility !== AssetVisibility.Archive).length;
    if (moved > 0) {
      warnings.push(
        `${countPhotos(moved)} ${moved === 1 ? 'was' : 'were'} no longer in the archive, so ${moved === 1 ? 'it was' : 'they were'} left as ${moved === 1 ? 'it is' : 'they are'}`,
      );
    }

    const targets = present.filter(({ visibility }) => visibility === AssetVisibility.Archive).map(({ id }) => id);
    const assetService = BaseService.create(AssetService, this);
    for (let i = 0; i < targets.length; i += 1000) {
      await assetService.updateAll(auth, { ids: targets.slice(i, i + 1000), visibility: AssetVisibility.Timeline });
    }

    for (const { keepAssetId, stack } of groups) {
      if (!stack) {
        continue;
      }
      const current = await this.activityLogRepository.getStack(stack.stackId);
      const previous = found.get(stack.previousPrimaryAssetId);
      const unchanged =
        current?.primaryAssetId === keepAssetId &&
        !!previous &&
        !previous.deletedAt &&
        (current.assetIds ?? []).includes(stack.previousPrimaryAssetId);
      if (!unchanged) {
        warnings.push('A stack was changed since, so it keeps its cover photo');
        continue;
      }
      await BaseService.create(StackService, this).update(auth, stack.stackId, {
        primaryAssetId: stack.previousPrimaryAssetId,
      });
    }

    return undone(unique(warnings));
  }

  /** archives the photos of an undone burst cleanup again, as `BurstService.clean` does */
  private async redoBurstCleanup(auth: AuthDto, { groups }: ActivityUndoMap[ActivityLogAction.BurstCleanup]) {
    const result = await BaseService.create(BurstService, this).clean(auth, {
      groups: groups.map(({ keepAssetId, archivedAssetIds }) => ({
        keepAssetId,
        assetIds: [keepAssetId, ...archivedAssetIds],
      })),
    });
    if (result.archived === 0) {
      throw new BadRequestException(result.groups.find(({ error }) => error)?.error ?? 'Nothing to archive again');
    }
  }

  /** gives the photos back the collection tags and descriptions they had, unless they were named again since */
  private async undoCollectionEntries(
    auth: AuthDto,
    { pack: packId, photos }: ActivityUndoMap[ActivityLogAction.CollectionEntries],
  ): Promise<UndoOutcome> {
    const pack = getCollectionPack(packId);
    if (!pack) {
      return refuse(`The journal "${packId}" no longer exists`);
    }
    const rules = getCollectionTagRules(pack);
    const ids = photos.map(({ id }) => id);
    // naming is owner-only, and so is undoing it (see `CollectionService.saveEntries`)
    const allowed = await checkOwnedAssets(this.accessRepository, auth, ids);

    const current = new Map<string, Array<{ tagId: string; value: string }>>();
    for (const { assetId, tagId, value } of await this.tagRepository.getAssetTagsByPrefix(ids, getTagPrefix(rules))) {
      if (parseCollectionTag(rules, value)) {
        current.set(assetId, [...(current.get(assetId) ?? []), { tagId, value }]);
      }
    }
    const assets = await this.activityLogRepository.getAssets(ids);
    const descriptions = new Map(assets.map(({ id, description }) => [id, description ?? '']));

    const warnings: string[] = [];
    let changedSince = 0;
    const removals = new Map<string, string[]>();
    const additions = new Map<string, string[]>();
    const restoreDescriptions: Array<{ id: string; description: string }> = [];
    for (const photo of photos) {
      if (!allowed.has(photo.id) || !descriptions.has(photo.id)) {
        continue;
      }
      const tags = current.get(photo.id) ?? [];
      if (tags.length !== 1 || tags[0].value !== photo.tag) {
        changedSince++;
        continue;
      }
      if (photo.tagAdded) {
        removals.set(tags[0].tagId, [...(removals.get(tags[0].tagId) ?? []), photo.id]);
      }
      for (const value of photo.previousTags) {
        additions.set(value, [...(additions.get(value) ?? []), photo.id]);
      }
      if (photo.description !== undefined) {
        if ((descriptions.get(photo.id) ?? '').trim() === photo.description.trim()) {
          restoreDescriptions.push({ id: photo.id, description: photo.previousDescription ?? '' });
        } else {
          warnings.push(`The description of a photo was edited since, so it was kept`);
        }
      }
    }

    if (changedSince === photos.length) {
      refuse(`The photos were named again since: undo that change first`);
    }

    const tagService = BaseService.create(TagService, this);
    for (const [tagId, assetIds] of removals) {
      await tagService.removeAssets(auth, tagId, { ids: assetIds });
    }
    if (additions.size > 0) {
      const tags = await upsertTags(this.tagRepository, { userId: auth.user.id, tags: additions.keys().toArray() });
      for (const tag of tags) {
        const assetIds = additions.get(tag.value);
        if (assetIds) {
          await tagService.addAssets(auth, tag.id, { ids: assetIds });
        }
      }
    }
    const assetService = BaseService.create(AssetService, this);
    for (const { id, description } of restoreDescriptions) {
      await assetService.update(auth, id, { description });
    }

    return {
      status: ActivityUndoStatus.Undone,
      ...(changedSince > 0 && {
        message: `${countPhotos(changedSince)} were named again since and kept their new names`,
      }),
      warnings: unique(warnings),
    };
  }

  private async undoHighlight(
    auth: AuthDto,
    { highlightId }: ActivityUndoMap[ActivityLogAction.HighlightCreate],
  ): Promise<UndoOutcome> {
    const job = await this.highlightJobRepository.get(highlightId);
    if (!job) {
      return undone(['The highlight video was already deleted']);
    }
    if (job.status === HighlightJobStatus.Pending || job.status === HighlightJobStatus.Running) {
      await BaseService.create(HighlightService, this).cancel(auth, highlightId);
      return undone();
    }
    if (!job.resultAssetId) {
      return undone(job.status === HighlightJobStatus.Completed ? ['The video was already deleted'] : []);
    }

    const warnings: string[] = [];
    if (job.albumId && job.options.addToAlbum) {
      try {
        await this.albums().removeAssets(auth, job.albumId, { ids: [job.resultAssetId] });
      } catch (error) {
        warnings.push(`The video could not be taken out of its album: ${errorMessage(error)}`);
      }
    }
    const outcome = await this.trashAssets(auth, [{ id: job.resultAssetId }]);
    return { ...outcome, warnings: [...warnings, ...(outcome.warnings ?? [])] };
  }

  private async undoSharedLink(
    auth: AuthDto,
    { sharedLinkId }: ActivityUndoMap[ActivityLogAction.SharedLinkCreate],
  ): Promise<UndoOutcome> {
    const link = await this.sharedLinkRepository.get(auth.user.id, sharedLinkId);
    if (!link) {
      return undone(['The link was already deleted']);
    }
    await BaseService.create(SharedLinkService, this).remove(auth, sharedLinkId);
    return undone();
  }

  /** takes the photos the change added out of the space again; photos that were in it before stay */
  private async undoSpaceAdd(
    auth: AuthDto,
    { spaceId, assetIds }: ActivityUndoMap[ActivityLogAction.SpaceAddAssets],
  ): Promise<UndoOutcome> {
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space) {
      return undone(['The space was deleted since']);
    }
    const removed = await BaseService.create(SharedSpaceService, this).removeAssets(auth, spaceId, { assetIds });
    const gone = assetIds.length - removed.length;
    return undone(gone > 0 ? [`${countPhotos(gone)} ${gone === 1 ? 'was' : 'were'} no longer in the space`] : []);
  }

  private workflows() {
    return BaseService.create(WorkflowService, this);
  }

  /** the workflow as it is now, or undefined when it was deleted */
  private async getWorkflow(workflowId: string) {
    const workflow = await this.workflowRepository.get(workflowId);
    if (!workflow) {
      return;
    }
    return {
      ...workflow,
      steps: workflow.steps.map((step) => ({
        method: `${step.pluginName}#${step.methodName}`,
        config: step.config as Record<string, unknown> | null,
        enabled: step.enabled,
      })),
    };
  }

  /** deletes a workflow the assistant saved, while nobody changed it since: a changed one is the user's now */
  private async undoWorkflowCreate(
    auth: AuthDto,
    { workflowId, fingerprint }: ActivityUndoMap[ActivityLogAction.WorkflowCreate],
  ): Promise<UndoOutcome> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      return undone(['The workflow was already deleted']);
    }
    if (fingerprintWorkflow(workflow) !== fingerprint) {
      refuse(
        `The workflow ${quote(workflow.name ?? 'Workflow')} was changed since it was saved, so it is kept: ` +
          'delete it on the Workflows page if you no longer want it.',
      );
    }
    await this.workflows().delete(auth, workflowId);
    return undone();
  }

  /** gives a workflow back the rule it had before the change, while nobody changed it since */
  private async undoWorkflowUpdate(
    auth: AuthDto,
    { workflowId, previous, fingerprint }: ActivityUndoMap[ActivityLogAction.WorkflowUpdate],
  ): Promise<UndoOutcome> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      refuse('The workflow was deleted since');
    }
    if (fingerprintWorkflow(workflow!) !== fingerprint) {
      refuse(`The workflow ${quote(workflow!.name ?? 'Workflow')} was changed again since, so it is kept as it is`);
    }
    await this.workflows().update(auth, workflowId, {
      name: previous.name,
      description: previous.description,
      trigger: previous.trigger,
      enabled: previous.enabled,
      steps: previous.steps,
    });
    return undone();
  }
}

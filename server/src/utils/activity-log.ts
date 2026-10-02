import { createHash, randomUUID } from 'node:crypto';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { BookMap, BookStyle, NormalizedRect } from 'src/dtos/book.dto.js';
import type { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import type { BookRepository } from 'src/repositories/book.repository.js';
import { ActivityLogAction, ActivityLogSource, BookDraftState, BookStatus } from 'src/enum.js';

/** how many snapshots of a book are kept for undo; undoing an older change is refused */
export const BOOK_REVISIONS_KEPT = 50;

/** everything that makes up what a book looks like, as a book edit changes it */
export type BookSnapshot = {
  title: string;
  subtitle: string | null;
  pageWidthMm: number;
  pageHeightMm: number;
  style: BookStyle;
  coverAssetId: string | null;
  albumId: string | null;
  pages: BookSnapshotPage[];
};

export type BookSnapshotPage = {
  id: string;
  layout: string;
  sectionTitle: string | null;
  caption: string | null;
  background: string | null;
  map: BookMap | null;
  assets: Array<{ slot: number; assetId: string; crop: NormalizedRect | null; caption: string | null }>;
};

/** a copy made from an original, e.g. a crop or an improved photo */
export type ActivityCopy = { id: string; sourceId: string };

export type ActivityCollectionPhoto = {
  id: string;
  /** the tag the photo has after the change, and whether the change added it */
  tag: string;
  tagAdded: boolean;
  /** the tags of the pack the photo had before, which the change removed */
  previousTags: string[];
  /** the description the change wrote, and the one it replaced */
  description?: string;
  previousDescription?: string;
};

/** what undoing each kind of change needs */
export type ActivityUndoMap = {
  /** the album as it was created: undoing deletes it only while it is still like this */
  [ActivityLogAction.AlbumCreate]: { albumId: string; name: string; description: string | null; assetIds: string[] };
  [ActivityLogAction.AlbumAddAssets]: { albumId: string; assetIds: string[] };
  [ActivityLogAction.AlbumRemoveAssets]: { albumId: string; assetIds: string[] };
  [ActivityLogAction.AssetCopy]: { copies: ActivityCopy[] };
  [ActivityLogAction.AssetCreate]: { assetIds: string[] };
  [ActivityLogAction.Artwork]: { jobId: string };
  [ActivityLogAction.ArtStyleCreate]: { styleId: string; updatedAt: string };
  [ActivityLogAction.BookCreate]: { bookId: string; fingerprint: string };
  /** `revisionId` is the book before the change; `fingerprint` the book right after it */
  [ActivityLogAction.BookEdit]: { bookId: string; revisionId: string; fingerprint: string; copies?: ActivityCopy[] };
  [ActivityLogAction.BookDraftKeep]: { bookId: string; draftId: string | null };
  [ActivityLogAction.BookDraftDiscard]: {
    bookId: string;
    draftId: string | null;
    draftState: BookDraftState;
    book: { ownerId: string; status: BookStatus; createdAt: string };
    snapshot: BookSnapshot;
  };
  [ActivityLogAction.BookStyleCreate]: { styleId: string; updatedAt: string };
  /**
   * the photos each group of a burst cleanup archived (undoing un-archives exactly those), and the stack whose head
   * became the kept photo
   */
  [ActivityLogAction.BurstCleanup]: {
    groups: Array<{
      keepAssetId: string;
      archivedAssetIds: string[];
      stack?: { stackId: string; previousPrimaryAssetId: string };
    }>;
  };
  [ActivityLogAction.CollectionEntries]: { pack: string; photos: ActivityCollectionPhoto[] };
  [ActivityLogAction.HighlightCreate]: { highlightId: string };
  [ActivityLogAction.SharedLinkCreate]: { sharedLinkId: string };
};

export type ActivityUndoData = ActivityUndoMap[ActivityLogAction];

/** one change to record: its kind, a short description, what it touched, and its inverse */
export type ActivityEntry = {
  [A in ActivityLogAction]: {
    action: A;
    summary: string;
    targetId?: string | null;
    assetIds?: string[];
    /** null when the change can't be undone */
    undo: ActivityUndoMap[A] | null;
  };
}[ActivityLogAction];

export type ActivityOrigin = {
  source: ActivityLogSource;
  /** the assistant chat and tool that made the change */
  sessionId?: string | null;
  toolName?: string | null;
  /** the changes of one chat turn, or of one request in the web app */
  groupId: string;
};

/**
 * Where the changes of a request come from; services record into it with `ActivityLogService.record`, and it
 * collects the ids of the recorded changes (e.g. for the Undo button of a tool call in the chat).
 */
export class ActivityRecorder {
  readonly ids: string[] = [];

  constructor(readonly origin: ActivityOrigin) {}

  /** a change the user made in the web app; every request is its own group */
  static web(groupId: string = randomUUID()) {
    return new ActivityRecorder({ source: ActivityLogSource.Web, groupId });
  }

  static assistant({ sessionId, toolName, groupId }: { sessionId: string | null; toolName: string; groupId: string }) {
    return new ActivityRecorder({ source: ActivityLogSource.Assistant, sessionId, toolName, groupId });
  }
}

/**
 * Records a change in the activity log, when the request has a recorder (the web paths and the assistant's tool
 * calls pass one). A change that could not be logged still happened, so a failure is only logged as a warning.
 */
export const recordActivity = async (
  { repository, logger }: { repository: ActivityLogRepository; logger?: { warn: (message: string) => void } },
  userId: string,
  recorder: ActivityRecorder | undefined,
  entry: ActivityEntry,
): Promise<string | undefined> => {
  if (!recorder) {
    return;
  }

  try {
    const { origin } = recorder;
    const row = await repository.create({
      userId,
      source: origin.source,
      sessionId: origin.sessionId ?? null,
      toolName: origin.toolName ?? null,
      groupId: origin.groupId,
      action: entry.action,
      summary: entry.summary,
      targetId: entry.targetId ?? null,
      assetIds: [...new Set(entry.assetIds)],
      undo: entry.undo,
    });
    recorder.ids.push(row.id);
    return row.id;
  } catch (error) {
    logger?.warn(`Unable to record "${entry.summary}" in the activity log: ${error}`);
  }
};

export const snapshotBook = async (bookRepository: BookRepository, bookId: string) => {
  const book = await bookRepository.get(bookId);
  if (!book) {
    return;
  }
  return toBookSnapshot(book, await bookRepository.getPages(bookId));
};

export type BookChange = {
  /**
   * Records the change of the book, when it changed. For a new book (`beginBookChange` without a book), pass its id.
   * `copies` are photos the change created, which undoing moves to the trash (e.g. `apply_improvements`).
   */
  finish: (
    auth: AuthDto,
    options: { summary: (title: string) => string; bookId?: string; copies?: ActivityCopy[] },
  ) => Promise<void>;
};

/**
 * Takes a snapshot of a book before a change (none for a book about to be created); `finish` records the change with
 * the snapshot (kept in `book_revision`), so that undoing it restores the book as it was. Nothing is recorded without
 * a recorder, or when the book did not change.
 */
export const beginBookChange = async (
  {
    activityLogRepository,
    bookRepository,
    logger,
  }: {
    activityLogRepository: ActivityLogRepository;
    bookRepository: BookRepository;
    logger?: { warn: (message: string) => void };
  },
  recorder: ActivityRecorder | undefined,
  bookId?: string,
): Promise<BookChange | undefined> => {
  if (!recorder) {
    return;
  }

  const before = bookId ? await snapshotBook(bookRepository, bookId) : undefined;
  if (bookId && !before) {
    return;
  }

  return {
    finish: async (auth, { summary, bookId: createdId, copies = [] }) => {
      const id = bookId ?? createdId;
      try {
        const after = id ? await snapshotBook(bookRepository, id) : undefined;
        if (!id || !after) {
          return;
        }

        const record = (entry: ActivityEntry) =>
          recordActivity({ repository: activityLogRepository, logger }, auth.user.id, recorder, entry);
        const fingerprint = fingerprintBook(after);
        if (!before) {
          await record({
            action: ActivityLogAction.BookCreate,
            summary: summary(after.title),
            targetId: id,
            undo: { bookId: id, fingerprint },
          });
          return;
        }

        if (fingerprintBook(before) === fingerprint && copies.length === 0) {
          return;
        }

        const revision = await activityLogRepository.createRevision(id, before);
        await activityLogRepository.pruneRevisions(id, BOOK_REVISIONS_KEPT);
        await record({
          action: ActivityLogAction.BookEdit,
          summary: summary(after.title),
          targetId: id,
          assetIds: copies.map((copy) => copy.id),
          undo: { bookId: id, revisionId: revision.id, fingerprint, ...(copies.length > 0 && { copies }) },
        });
      } catch (error) {
        logger?.warn(`Unable to record the change of book ${id}: ${error}`);
      }
    },
  };
};

/** JSON with sorted keys, so equal values give equal text */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
};

/** a short hash of a book snapshot: a book with the same fingerprint has not changed */
export const fingerprintBook = (snapshot: BookSnapshot) =>
  createHash('sha256').update(stableStringify(snapshot)).digest('hex').slice(0, 32);

export const toBookSnapshot = (
  book: {
    title: string;
    subtitle: string | null;
    pageWidthMm: number;
    pageHeightMm: number;
    style: BookStyle;
    coverAssetId: string | null;
    albumId: string | null;
  },
  pages: Array<{
    id: string;
    layout: string;
    sectionTitle: string | null;
    caption: string | null;
    background: string | null;
    map: BookMap | null;
    assets: Array<{ slot: number; assetId: string; crop: NormalizedRect | null; caption: string | null }>;
  }>,
): BookSnapshot => ({
  title: book.title,
  subtitle: book.subtitle,
  pageWidthMm: book.pageWidthMm,
  pageHeightMm: book.pageHeightMm,
  style: book.style,
  coverAssetId: book.coverAssetId,
  albumId: book.albumId,
  pages: pages.map((page) => ({
    id: page.id,
    layout: page.layout,
    sectionTitle: page.sectionTitle,
    caption: page.caption,
    background: page.background,
    map: page.map,
    assets: page.assets.map(({ slot, assetId, crop, caption }) => ({ slot, assetId, crop, caption })),
  })),
});

/** "1 photo", "3 photos" */
export const countPhotos = (count: number) => `${count} photo${count === 1 ? '' : 's'}`;

/** a name in curly quotes, e.g. “Sicily 2009” */
export const quote = (name: string) => `“${name}”`;

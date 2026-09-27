import { Injectable } from '@nestjs/common';
import { type Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import type { BookSnapshot } from 'src/utils/activity-log.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { ActivityLogAction, ActivityLogSource, AlbumUserRole } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { ActivityLogTable } from 'src/schema/tables/activity-log.table.js';
import { anyUuid } from 'src/utils/database.js';

export type ActivityLogSearch = {
  sessionId?: string;
  groupId?: string;
  source?: ActivityLogSource;
  action?: ActivityLogAction;
  /** only changes made at or after this date */
  from?: Date;
  /** only changes made before this date */
  to?: Date;
  /** true = only undone changes, false = only changes that were not undone */
  undone?: boolean;
  limit: number;
  offset?: number;
};

@Injectable()
export class ActivityLogRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({
    params: [
      {
        userId: DummyValue.UUID,
        source: ActivityLogSource.Web,
        action: ActivityLogAction.AlbumAddAssets,
        summary: DummyValue.STRING,
        groupId: DummyValue.UUID,
      },
    ],
  })
  create(values: Insertable<ActivityLogTable>) {
    return this.db.insertInto('activity_log').values(values).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  getByIds(userId: string, ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('activity_log')
      .selectAll()
      .where('activity_log.userId', '=', userId)
      .where('activity_log.id', '=', anyUuid(ids))
      .orderBy('activity_log.createdAt', 'desc')
      .execute();
  }

  /** the changes of a user, newest first */
  @GenerateSql({ params: [DummyValue.UUID, { limit: 50, undone: false }] })
  search(
    userId: string,
    { sessionId, groupId, source, action, from, to, undone, limit, offset = 0 }: ActivityLogSearch,
  ) {
    return this.db
      .selectFrom('activity_log')
      .selectAll()
      .where('activity_log.userId', '=', userId)
      .$if(sessionId !== undefined, (qb) => qb.where('activity_log.sessionId', '=', sessionId!))
      .$if(groupId !== undefined, (qb) => qb.where('activity_log.groupId', '=', groupId!))
      .$if(source !== undefined, (qb) => qb.where('activity_log.source', '=', source!))
      .$if(action !== undefined, (qb) => qb.where('activity_log.action', '=', action!))
      .$if(from !== undefined, (qb) => qb.where('activity_log.createdAt', '>=', from!))
      .$if(to !== undefined, (qb) => qb.where('activity_log.createdAt', '<', to!))
      .$if(undone === true, (qb) => qb.where('activity_log.undoneAt', 'is not', null))
      .$if(undone === false, (qb) => qb.where('activity_log.undoneAt', 'is', null))
      .orderBy('activity_log.createdAt', 'desc')
      .orderBy('activity_log.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  /** marks changes as undone, unless they already are; returns the ids that were marked */
  @GenerateSql({ params: [[DummyValue.UUID], ActivityLogSource.Web] })
  async setUndone(ids: string[], undoneBy: ActivityLogSource): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.db
      .updateTable('activity_log')
      .set({ undoneAt: sql`clock_timestamp()`, undoneBy })
      .where('activity_log.id', '=', anyUuid(ids))
      .where('activity_log.undoneAt', 'is', null)
      .returning('activity_log.id')
      .execute();
    return rows.map(({ id }) => id);
  }

  /** a redone change can be undone again */
  @GenerateSql({ params: [DummyValue.UUID] })
  async clearUndone(id: string): Promise<void> {
    await this.db
      .updateTable('activity_log')
      .set({ undoneAt: null, undoneBy: null })
      .where('activity_log.id', '=', id)
      .execute();
  }

  /** removes the changes made before `date`, and the book revisions nothing refers to anymore */
  @GenerateSql({ params: [DummyValue.DATE] })
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('activity_log')
      .where('activity_log.createdAt', '<', date)
      .executeTakeFirst();
    await this.db.deleteFrom('book_revision').where('book_revision.createdAt', '<', date).execute();
    return Number(result.numDeletedRows);
  }

  /** the number of changes of a group that were not undone */
  @GenerateSql({ params: [DummyValue.UUID] })
  async countGroup(groupId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom('activity_log')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('activity_log.groupId', '=', groupId)
      .where('activity_log.undoneAt', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  @GenerateSql({ params: [DummyValue.UUID, {}] })
  createRevision(bookId: string, snapshot: BookSnapshot) {
    return this.db
      .insertInto('book_revision')
      .values({ bookId, snapshot })
      .returning(['book_revision.id', 'book_revision.createdAt'])
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getRevision(id: string) {
    return this.db.selectFrom('book_revision').selectAll().where('book_revision.id', '=', id).executeTakeFirst();
  }

  /** keeps the `keep` newest revisions of a book */
  @GenerateSql({ params: [DummyValue.UUID, 50] })
  async pruneRevisions(bookId: string, keep: number): Promise<void> {
    await this.db
      .deleteFrom('book_revision')
      .where('book_revision.bookId', '=', bookId)
      .where(
        'book_revision.id',
        'not in',
        this.db
          .selectFrom('book_revision')
          .select('book_revision.id')
          .where('book_revision.bookId', '=', bookId)
          .orderBy('book_revision.createdAt', 'desc')
          .limit(keep),
      )
      .execute();
  }

  /** where assets are placed in books (on a page, or as the cover) */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getBookPlacements(assetIds: string[]) {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('book_page_asset')
      .innerJoin('book_page', 'book_page.id', 'book_page_asset.pageId')
      .innerJoin('book', 'book.id', 'book_page.bookId')
      .select([
        'book_page_asset.assetId',
        'book.id as bookId',
        'book.title',
        sql<number | null>`"book_page"."position"`.as('position'),
      ])
      .where('book_page_asset.assetId', '=', anyUuid(assetIds))
      .unionAll(
        this.db
          .selectFrom('book')
          .select([
            sql<string>`"book"."coverAssetId"`.as('assetId'),
            'book.id as bookId',
            'book.title',
            sql<number | null>`null::integer`.as('position'),
          ])
          .where('book.coverAssetId', '=', anyUuid(assetIds)),
      )
      .execute();
  }

  /** the albums that hold any of the assets, besides `exceptAlbumId` */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getAlbumsOfAssets(assetIds: string[]) {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('album_asset')
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .select(['album_asset.assetId', 'album.id as albumId', 'album.albumName'])
      .where('album_asset.assetId', '=', anyUuid(assetIds))
      .where('album.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  getAssets(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.stackId',
        'asset.deletedAt',
        'asset.status',
        'asset.originalFileName',
        'asset_exif.description',
      ])
      .where('asset.id', '=', anyUuid(ids))
      .execute();
  }

  /** the members of a stack, trashed ones included */
  @GenerateSql({ params: [DummyValue.UUID] })
  getStack(stackId: string) {
    return this.db
      .selectFrom('stack')
      .select(['stack.id', 'stack.primaryAssetId'])
      .select((eb) =>
        eb
          .selectFrom('asset')
          .select(sql<string[]>`coalesce(array_agg("asset"."id"), '{}')`.as('ids'))
          .whereRef('asset.stackId', '=', 'stack.id')
          .as('assetIds'),
      )
      .where('stack.id', '=', stackId)
      .executeTakeFirst();
  }

  /** the assets of an album, and whether the album is shared (with users or through a link) */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAlbumState(albumId: string) {
    return this.db
      .selectFrom('album')
      .select(['album.id', 'album.albumName', 'album.description', 'album.deletedAt'])
      .select((eb) =>
        eb
          .selectFrom('album_asset')
          .select(sql<string[]>`coalesce(array_agg("album_asset"."assetId"), '{}')`.as('ids'))
          .whereRef('album_asset.albumId', '=', 'album.id')
          .as('assetIds'),
      )
      .select((eb) =>
        eb
          .selectFrom('album_user')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .whereRef('album_user.albumId', '=', 'album.id')
          .where('album_user.role', '!=', AlbumUserRole.Owner)
          .as('sharedUsers'),
      )
      .select((eb) =>
        eb
          .selectFrom('shared_link')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .whereRef('shared_link.albumId', '=', 'album.id')
          .as('sharedLinks'),
      )
      .where('album.id', '=', albumId)
      .executeTakeFirst();
  }

  /** the number of shared links to a book */
  @GenerateSql({ params: [DummyValue.UUID] })
  async countBookSharedLinks(bookId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom('shared_link')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('shared_link.bookId', '=', bookId)
      .executeTakeFirstOrThrow();
    return Number(count);
  }
}

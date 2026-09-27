import { Injectable } from '@nestjs/common';
import { type Insertable, type Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { CollectionNoticeTable } from 'src/schema/tables/collection-notice.table.js';

/**
 * The "new collection found" notifications sent to users (`collection_notice`), when their uploads were last checked
 * (`collection_notice_check`), and the uploads that are checked
 */
@Injectable()
export class CollectionNoticeRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /** every visit notified to the user: its pack, key and photos */
  @GenerateSql({ params: [DummyValue.UUID] })
  getNotices(userId: string) {
    return this.db
      .selectFrom('collection_notice')
      .select(['collection_notice.pack', 'collection_notice.key', 'collection_notice.assetIds'])
      .where('collection_notice.userId', '=', userId)
      .execute();
  }

  /** Records a notice, unless its key was notified before (e.g. by a job running at the same time) */
  @GenerateSql({ params: [{ userId: DummyValue.UUID, pack: 'food', key: 'food:2026-09-26', assetIds: [] }] })
  claim(values: Insertable<CollectionNoticeTable>) {
    return this.db
      .insertInto('collection_notice')
      .values(values)
      .onConflict((oc) => oc.columns(['userId', 'pack', 'key']).doNothing())
      .returning(['collection_notice.id'])
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async setNotification(id: string, notificationId: string): Promise<void> {
    await this.db
      .updateTable('collection_notice')
      .set({ notificationId })
      .where('collection_notice.id', '=', id)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('collection_notice').where('collection_notice.id', '=', id).execute();
  }

  /** when the user's uploads were last checked, if ever */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getCheckedAt(userId: string): Promise<Date | undefined> {
    const row = await this.db
      .selectFrom('collection_notice_check')
      .select('collection_notice_check.checkedAt')
      .where('collection_notice_check.userId', '=', userId)
      .executeTakeFirst();
    return row ? new Date(row.checkedAt as unknown as string) : undefined;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
  async setCheckedAt(userId: string, checkedAt: Date): Promise<void> {
    await this.db
      .insertInto('collection_notice_check')
      .values({ userId, checkedAt })
      .onConflict((oc) => oc.column('userId').doUpdateSet({ checkedAt }))
      .execute();
  }

  /**
   * Where the user takes photos on the most days, to about ten kilometres (a tenth of a degree): the place, and on how
   * many days they took located photos there; undefined without located photos
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getHome(userId: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        sql<number>`round(asset_exif.latitude::numeric, 1)::float8`.as('latitude'),
        sql<number>`round(asset_exif.longitude::numeric, 1)::float8`.as('longitude'),
        sql<number>`count(distinct asset."localDateTime"::date)::int`.as('days'),
      ])
      .where('asset.ownerId', '=', userId)
      .where('asset.deletedAt', 'is', null)
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .groupBy([sql`1`, sql`2`])
      .orderBy('days', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * The photos the user uploaded since `since` (newest first, at most `limit`), on the timeline or in the archive, with
   * their local and UTC times (whose difference is the time zone the user takes photos in)
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE, 100] })
  getUploads(userId: string, since: Date, limit: number) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime', 'asset.fileCreatedAt', 'asset.createdAt'])
      .where('asset.ownerId', '=', userId)
      .where('asset.type', '=', AssetType.Image)
      .where('asset.visibility', 'in', [AssetVisibility.Timeline, AssetVisibility.Archive])
      .where('asset.deletedAt', 'is', null)
      .where('asset.createdAt', '>=', since)
      .orderBy('asset.createdAt', 'desc')
      .limit(limit)
      .execute();
  }
}

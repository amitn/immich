import { Injectable } from '@nestjs/common';
import { type Insertable, type Kysely, type Updateable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetType, AssetVisibility, BookDraftState, MemoryType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { BookDraftTable } from 'src/schema/tables/book-draft.table.js';
import { asUuid } from 'src/utils/database.js';
import type { MemoryExclusions } from 'src/utils/memory-exclusions.js';
import { keepNotExcluded } from 'src/utils/memory-exclusions.js';

/** Books suggested to users (`book_draft`), and what the suggestions are made from */
@Injectable()
export class BookDraftRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /** every key suggested to a user, whatever became of the suggestion */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getKeys(ownerId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('book_draft')
      .select('book_draft.key')
      .where('book_draft.ownerId', '=', ownerId)
      .execute();
    return new Set(rows.map(({ key }) => key));
  }

  /** the suggestions waiting for the user to keep or discard them, the newest first */
  @GenerateSql({ params: [DummyValue.UUID] })
  getPending(ownerId: string) {
    return this.db
      .selectFrom('book_draft')
      .innerJoin('book', 'book.id', 'book_draft.bookId')
      .selectAll('book_draft')
      .where('book_draft.ownerId', '=', ownerId)
      .where('book_draft.state', '=', BookDraftState.Drafted)
      .orderBy('book_draft.createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByBookId(bookId: string) {
    return this.db.selectFrom('book_draft').selectAll().where('book_draft.bookId', '=', bookId).executeTakeFirst();
  }

  /** Records a suggestion, unless its key was suggested before (e.g. by a job running at the same time) */
  @GenerateSql({
    params: [{ ownerId: DummyValue.UUID, key: 'food:2025', kind: 'yearly', title: DummyValue.STRING, reason: '' }],
  })
  claim(values: Insertable<BookDraftTable>) {
    return this.db
      .insertInto('book_draft')
      .values(values)
      .onConflict((oc) => oc.columns(['ownerId', 'key']).doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, { state: BookDraftState.Kept }] })
  async update(id: string, values: Updateable<BookDraftTable>): Promise<void> {
    await this.db.updateTable('book_draft').set(values).where('book_draft.id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('book_draft').where('book_draft.id', '=', id).execute();
  }

  /** the collection tags under the prefixes (e.g. `Food/`) on the photos of a user's timeline, with their local time */
  @GenerateSql({ params: [DummyValue.UUID, ['Food/']] })
  async getCollectionTags(ownerId: string, prefixes: string[], exclusions?: MemoryExclusions) {
    if (prefixes.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom('tag_asset')
      .innerJoin('tag', 'tag.id', 'tag_asset.tagId')
      .innerJoin('asset', 'asset.id', 'tag_asset.assetId')
      .select(['asset.id', 'asset.localDateTime', 'tag.value'])
      .where('tag.userId', '=', ownerId)
      .where('asset.ownerId', '=', ownerId)
      .where((eb) => eb.or(prefixes.map((prefix) => eb('tag.value', 'like', `${prefix}%`))))
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      // the photos the user keeps out of their memories (#12)
      .where((eb) => keepNotExcluded(eb, exclusions))
      .orderBy('asset.localDateTime', 'asc')
      .execute();
    return rows.map((row) => ({ id: row.id, time: row.localDateTime.getTime(), value: row.value }));
  }

  /** the photos of a user's timeline with their local time and place, e.g. to find their trips */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getTimeline(ownerId: string, exclusions?: MemoryExclusions) {
    const rows = await this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.city',
        'asset_exif.state',
        'asset_exif.country',
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.type', '=', sql.lit(AssetType.Image))
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      .where((eb) => keepNotExcluded(eb, exclusions))
      .orderBy('asset.localDateTime', 'asc')
      .execute();
    return rows.map(({ localDateTime, ...row }) => ({ ...row, time: localDateTime.getTime() }));
  }

  /** a user's named, visible people with a birth date (yyyy-mm-dd) */
  @GenerateSql({ params: [DummyValue.UUID] })
  getPeopleWithBirthdays(ownerId: string) {
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name'])
      .select(sql<string>`to_char("person"."birthDate", 'YYYY-MM-DD')`.as('birthDate'))
      .where('person.ownerId', '=', ownerId)
      .where('person.isHidden', '=', false)
      .where('person.name', '!=', '')
      .where('person.type', '!=', 'pet')
      .where('person.birthDate', 'is not', null)
      .orderBy('person.name')
      .execute();
  }

  /** the photos of a user's timeline showing a person, taken between two local times */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.DATE, DummyValue.DATE] })
  async getPersonPhotos(
    ownerId: string,
    personId: string,
    takenAfter: Date,
    takenBefore: Date,
    exclusions?: MemoryExclusions,
  ) {
    const rows = await this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime'])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.personGroupId', '=', asUuid(personId))
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ),
      )
      .where('asset.ownerId', '=', ownerId)
      .where('asset.type', '=', sql.lit(AssetType.Image))
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', takenAfter)
      .where('asset.localDateTime', '<', takenBefore)
      .where((eb) => keepNotExcluded(eb, exclusions))
      .orderBy('asset.localDateTime', 'asc')
      .execute();
    return rows.map((row) => ({ id: row.id, time: row.localDateTime.getTime() }));
  }

  /** a user's memories made by the rules given (e.g. `recent_trip`), the newest first, to base suggestions on (#5) */
  @GenerateSql({ params: [DummyValue.UUID, ['recent_trip', 'birthday']] })
  getRuleMemories(ownerId: string, ruleIds: string[]) {
    if (ruleIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .selectFrom('memory')
      .select(['memory.id', 'memory.type', 'memory.data', 'memory.memoryAt'])
      .where('memory.ownerId', '=', ownerId)
      .where('memory.type', '=', sql.lit(MemoryType.Rule))
      .where('memory.deletedAt', 'is', null)
      .where(sql<string>`"memory"."data"->>'ruleId'`, 'in', ruleIds)
      .orderBy('memory.memoryAt', 'desc')
      .execute();
  }

  /**
   * The photos and videos of a user's timeline taken in a window of local time (both ends included), e.g. the trip
   * of a memory (see `src/utils/memory-source.ts`): those showing every one of `personIds`, only favorites or only
   * videos when asked. In time order.
   */
  @GenerateSql({
    params: [DummyValue.UUID, { from: DummyValue.DATE, to: DummyValue.DATE, personIds: [DummyValue.UUID] }],
  })
  async getWindowAssets(
    ownerId: string,
    {
      from,
      to,
      personIds = [],
      favoritesOnly = false,
      videosOnly = false,
      exclusions,
    }: {
      from: Date;
      to: Date;
      personIds?: string[];
      favoritesOnly?: boolean;
      videosOnly?: boolean;
      /** what the user keeps out of their memories (#12) */
      exclusions?: MemoryExclusions;
    },
  ) {
    let query = this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.type', 'asset.localDateTime'])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', from)
      .where('asset.localDateTime', '<=', to)
      .where('asset.type', 'in', videosOnly ? [AssetType.Video] : [AssetType.Image, AssetType.Video])
      .$if(favoritesOnly, (qb) => qb.where('asset.isFavorite', '=', true))
      .where((eb) => keepNotExcluded(eb, exclusions));
    for (const personId of new Set(personIds)) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.personGroupId', '=', asUuid(personId))
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ),
      );
    }
    const rows = await query.orderBy('asset.localDateTime', 'asc').orderBy('asset.id', 'asc').execute();
    return rows.map(({ localDateTime, ...row }) => ({ ...row, time: localDateTime.getTime() }));
  }
}

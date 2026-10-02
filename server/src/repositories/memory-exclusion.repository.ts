import { Injectable } from '@nestjs/common';
import { type Insertable, type Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { ChunkedSet, DummyValue, GenerateSql } from 'src/decorators.js';
import { MemoryExclusionType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { MemoryExclusionTable } from 'src/schema/tables/memory-exclusion.table.js';
import type { MemoryExclusions } from 'src/utils/memory-exclusions.js';
import { keepNotExcluded } from 'src/utils/memory-exclusions.js';

const EXCLUSIONS_EXAMPLE: MemoryExclusions = {
  personIds: [DummyValue.UUID],
  dateRanges: [{ from: '2026-03-01', to: '2026-03-14' }],
  albumIds: [DummyValue.UUID],
  documents: true,
};

/** What each user keeps out of their memories (`memory_exclusion`, #12), and the photos that are left out */
@Injectable()
export class MemoryExclusionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /** a user's exclusions, with the name of each person, pet and album, the oldest first */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAll(ownerId: string) {
    return this.db
      .selectFrom('memory_exclusion')
      .leftJoin('person', (join) =>
        join
          .onRef('person.personGroupId', '=', 'memory_exclusion.personGroupId')
          .onRef('person.ownerId', '=', 'memory_exclusion.ownerId'),
      )
      .leftJoin('album', 'album.id', 'memory_exclusion.albumId')
      .select([
        'memory_exclusion.id',
        'memory_exclusion.type',
        'memory_exclusion.personGroupId',
        'memory_exclusion.albumId',
        'memory_exclusion.createdAt',
        'person.name as personName',
        'person.type as personType',
        'album.albumName',
      ])
      .select(sql<string | null>`to_char("memory_exclusion"."startDate", 'YYYY-MM-DD')`.as('startDate'))
      .select(sql<string | null>`to_char("memory_exclusion"."endDate", 'YYYY-MM-DD')`.as('endDate'))
      .where('memory_exclusion.ownerId', '=', ownerId)
      .orderBy('memory_exclusion.createdAt', 'asc')
      .orderBy('memory_exclusion.id', 'asc')
      .execute();
  }

  /** Adds an exclusion; an exclusion of a person or an album the user already left out returns undefined */
  @GenerateSql({
    params: [{ ownerId: DummyValue.UUID, type: MemoryExclusionType.Person, personGroupId: DummyValue.UUID }],
  })
  create(values: Insertable<MemoryExclusionTable>) {
    return this.db
      .insertInto('memory_exclusion')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .returning(['memory_exclusion.id'])
      .executeTakeFirst();
  }

  /** Removes exclusions of the user; returns the ones it removed */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  delete(ownerId: string, ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .deleteFrom('memory_exclusion')
      .where('memory_exclusion.ownerId', '=', ownerId)
      .where('memory_exclusion.id', 'in', ids)
      .returning([
        'memory_exclusion.id',
        'memory_exclusion.type',
        'memory_exclusion.personGroupId',
        'memory_exclusion.albumId',
        sql<string | null>`to_char("memory_exclusion"."startDate", 'YYYY-MM-DD')`.as('startDate'),
        sql<string | null>`to_char("memory_exclusion"."endDate", 'YYYY-MM-DD')`.as('endDate'),
      ])
      .execute();
  }

  /** the user's named people and pets called one of the names (whatever their case), e.g. to leave out "Dana" */
  @GenerateSql({ params: [DummyValue.UUID, ['Dana']] })
  findPeopleByName(ownerId: string, names: string[]) {
    const lower = [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))];
    if (lower.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name', 'person.type'])
      .where('person.ownerId', '=', ownerId)
      .where(sql<string>`lower(btrim("person"."name"))`, 'in', lower)
      .orderBy('person.name')
      .execute();
  }

  /** the assets that the exclusions leave in, of those given */
  @GenerateSql({ params: [[DummyValue.UUID], EXCLUSIONS_EXAMPLE] })
  @ChunkedSet({ paramIndex: 0 })
  async getKeptAssetIds(assetIds: string[], exclusions: MemoryExclusions): Promise<Set<string>> {
    if (assetIds.length === 0) {
      return new Set();
    }
    const rows = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', assetIds)
      .where((eb) => keepNotExcluded(eb, exclusions))
      .execute();
    return new Set(rows.map(({ id }) => id));
  }
}

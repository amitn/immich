import { Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { getCollectionTagPrefixes } from 'src/utils/book/collections.js';
import type { MemoryExclusions } from 'src/utils/memory-exclusions.js';
import { hasMemoryExclusions, notExcludedFromMemories } from 'src/utils/memory-exclusions.js';
import type { YearRecapAsset, YearRecapPerson, YearRecapTag } from 'src/utils/year-recap.js';

const EXCLUSIONS_EXAMPLE: MemoryExclusions = {
  personIds: [DummyValue.UUID],
  dateRanges: [{ from: '2026-03-01', to: '2026-03-14' }],
  albumIds: [],
  documents: true,
};

/** the local times a calendar year covers: from its first midnight up to, not including, the next year's */
const yearBounds = (year: number) => ({
  start: new Date(Date.UTC(year, 0, 1)),
  end: new Date(Date.UTC(year + 1, 0, 1)),
});

/**
 * What a year in review is made of (#12): the photos and videos of a user's timeline taken in a calendar year, their
 * people and pets, and their journal tags, all without the photos the user keeps out of their memories
 */
@Injectable()
export class YearRecapRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  private yearAssets(ownerId: string, year: number, exclusions?: MemoryExclusions | null) {
    const { start, end } = yearBounds(year);
    return this.db
      .selectFrom('asset')
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      .where('asset.type', 'in', [AssetType.Image, AssetType.Video])
      .where('asset.localDateTime', '>=', start)
      .where('asset.localDateTime', '<', end)
      .$if(hasMemoryExclusions(exclusions), (qb) => qb.where((eb) => notExcludedFromMemories(eb, exclusions)!));
  }

  /** the photos and videos of the year (with a preview, like the memories), in time order */
  @GenerateSql({ params: [DummyValue.UUID, 2025, EXCLUSIONS_EXAMPLE] })
  async getAssets(ownerId: string, year: number, exclusions?: MemoryExclusions | null): Promise<YearRecapAsset[]> {
    const rows = await this.yearAssets(ownerId, year, exclusions)
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.type',
        'asset.isFavorite',
        'asset.localDateTime',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.city',
        'asset_exif.state',
        'asset_exif.country',
      ])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .orderBy('asset.id', 'asc')
      .execute();
    return rows.map(({ localDateTime, ...row }) => ({ ...row, time: localDateTime.getTime() }));
  }

  /** the user's named, visible people and pets on the year's photos, with how many photos show each */
  @GenerateSql({ params: [DummyValue.UUID, 2025, EXCLUSIONS_EXAMPLE] })
  async getPeople(ownerId: string, year: number, exclusions?: MemoryExclusions | null): Promise<YearRecapPerson[]> {
    const rows = await this.yearAssets(ownerId, year, exclusions)
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .innerJoin('person', (join) =>
        join
          .onRef('person.personGroupId', '=', 'asset_face.personGroupId')
          .onRef('person.ownerId', '=', 'asset.ownerId'),
      )
      .select(['person.personGroupId as id', 'person.name', 'person.type'])
      .select(sql<number>`count(distinct "asset"."id")::int`.as('count'))
      .where('asset_face.deletedAt', 'is', null)
      .where('person.isHidden', '=', false)
      .where('person.name', '!=', '')
      .groupBy(['person.personGroupId', 'person.name', 'person.type'])
      .orderBy('count', 'desc')
      .orderBy('person.name', 'asc')
      .execute();
    return rows;
  }

  /** the journal tags of the year's photos (e.g. `Food/Da Enzo/Cacio e pepe`), with the photo they are on */
  @GenerateSql({ params: [DummyValue.UUID, 2025, EXCLUSIONS_EXAMPLE] })
  async getJournalTags(ownerId: string, year: number, exclusions?: MemoryExclusions | null): Promise<YearRecapTag[]> {
    const prefixes = getCollectionTagPrefixes();
    if (prefixes.length === 0) {
      return [];
    }
    return this.yearAssets(ownerId, year, exclusions)
      .innerJoin('tag_asset', 'tag_asset.assetId', 'asset.id')
      .innerJoin('tag', 'tag.id', 'tag_asset.tagId')
      .select(['asset.id', 'tag.value'])
      .where('tag.userId', '=', ownerId)
      .where((eb) => eb.or(prefixes.map((prefix) => eb('tag.value', 'like', `${prefix}%`))))
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }
}

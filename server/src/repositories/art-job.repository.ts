import { Injectable } from '@nestjs/common';
import { type Insertable, Kysely, type Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { ArtJobStatus } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { ArtJobTable } from 'src/schema/tables/art-job.table.js';

@Injectable()
export class ArtJobRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({
    params: [{ userId: DummyValue.UUID, sourceAssetId: DummyValue.UUID, prompt: 'prompt', profile: 'codex' }],
  })
  create(job: Insertable<ArtJobTable>) {
    return this.db.insertInto('art_job').values(job).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.db.selectFrom('art_job').selectAll().where('art_job.id', '=', id).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, { status: ArtJobStatus.Running }] })
  update(id: string, job: Updateable<ArtJobTable>) {
    return this.db
      .updateTable('art_job')
      .set(job)
      .where('art_job.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** artworks, crops, straightened copies and book maps made by the assistant, to tag the ones from before tagging */
  @GenerateSql()
  getDerivedAssetsForTagging() {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .leftJoin('art_job', 'art_job.resultAssetId', 'asset.id')
      .select([
        'asset.id as assetId',
        'asset.ownerId',
        'art_job.id as artJobId',
        'art_job.style',
        'asset.originalFileName',
      ])
      .where('asset.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('art_job.status', '=', ArtJobStatus.Completed),
          eb.and([
            eb('asset.originalFileName', 'like', '%-crop.jpg'),
            eb('asset_exif.description', 'like', 'Cropped from %'),
          ]),
          eb.and([
            eb('asset.originalFileName', 'like', '%-straight.jpg'),
            eb('asset_exif.description', 'like', 'Straightened (%'),
          ]),
          eb.and([
            eb('asset.originalFileName', 'like', '%-map.png'),
            eb('asset_exif.description', 'like', 'Map%for the book%'),
          ]),
        ]),
      )
      .execute();
  }

  /** jobs that were pending or running when the server stopped can't finish anymore */
  @GenerateSql()
  failUnfinished() {
    return this.db
      .updateTable('art_job')
      .set({ status: ArtJobStatus.Failed, error: 'The server restarted before the artwork was finished' })
      .where('art_job.status', 'in', [ArtJobStatus.Pending, ArtJobStatus.Running])
      .execute();
  }
}

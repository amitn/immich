import { Injectable } from '@nestjs/common';
import { type Insertable, Kysely, type Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetType, HighlightJobStatus } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { HighlightJobTable } from 'src/schema/tables/highlight-job.table.js';

@Injectable()
export class HighlightJobRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({
    params: [
      {
        ownerId: DummyValue.UUID,
        title: 'Sicily',
        options: { durationSeconds: 60, style: 'auto', includeMaps: true, captions: true, addToAlbum: true },
      },
    ],
  })
  create(job: Insertable<HighlightJobTable>) {
    return this.db.insertInto('highlight_job').values(job).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.db.selectFrom('highlight_job').selectAll().where('highlight_job.id', '=', id).executeTakeFirst();
  }

  /** the status alone, which a running render polls to notice that it was cancelled */
  @GenerateSql({ params: [DummyValue.UUID] })
  getStatus(id: string) {
    return this.db
      .selectFrom('highlight_job')
      .select('highlight_job.status')
      .where('highlight_job.id', '=', id)
      .executeTakeFirst()
      .then((row) => row?.status);
  }

  @GenerateSql({ params: [DummyValue.UUID, { status: HighlightJobStatus.Running }] })
  update(id: string, job: Updateable<HighlightJobTable>) {
    return this.db
      .updateTable('highlight_job')
      .set(job)
      .where('highlight_job.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** cancels a job unless it already finished; returns it when it was cancelled */
  @GenerateSql({ params: [DummyValue.UUID] })
  cancel(id: string) {
    return this.db
      .updateTable('highlight_job')
      .set({ status: HighlightJobStatus.Cancelled })
      .where('highlight_job.id', '=', id)
      .where('highlight_job.status', 'in', [HighlightJobStatus.Pending, HighlightJobStatus.Running])
      .returningAll()
      .executeTakeFirst();
  }

  /** the jobs of a user, newest first */
  @GenerateSql({ params: [DummyValue.UUID] })
  getAll(ownerId: string) {
    return this.db
      .selectFrom('highlight_job')
      .selectAll()
      .where('highlight_job.ownerId', '=', ownerId)
      .orderBy('highlight_job.createdAt', 'desc')
      .limit(50)
      .execute();
  }

  /** renders that were running when the server stopped can't finish anymore */
  @GenerateSql()
  failRunning() {
    return this.db
      .updateTable('highlight_job')
      .set({ status: HighlightJobStatus.Failed, error: 'The server restarted before the video was finished' })
      .where('highlight_job.status', '=', HighlightJobStatus.Running)
      .execute();
  }

  /** the audio files of a user, for the music of a highlight video */
  @GenerateSql({ params: [DummyValue.UUID] })
  getMusic(ownerId: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.originalFileName', 'asset.originalPath', 'asset.duration', 'asset.createdAt'])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.type', '=', AssetType.Audio)
      .where('asset.deletedAt', 'is', null)
      .orderBy('asset.createdAt', 'desc')
      .limit(200)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getMusicAsset(ownerId: string, id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.originalFileName', 'asset.originalPath', 'asset.duration'])
      .where('asset.id', '=', id)
      .where('asset.ownerId', '=', ownerId)
      .where('asset.type', '=', AssetType.Audio)
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();
  }
}

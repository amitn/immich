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

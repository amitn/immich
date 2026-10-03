import { Injectable } from '@nestjs/common';
import { type Insertable, type Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { DB } from 'src/schema/index.js';
import { MemoryNoticeTable } from 'src/schema/tables/memory-notice.table.js';

export type MemoryNoticeKind = 'memory' | 'draft' | 'digest';

/** what the memory notifier sent the users (`memory_notice`, #6) */
@Injectable()
export class MemoryNoticeRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Records a notice, unless it was sent before or, for the notification of the day, the user already got one that day
   * (e.g. from a job running at the same time); undefined then
   */
  @GenerateSql({ params: [{ userId: DummyValue.UUID, kind: 'memory', refId: DummyValue.UUID, day: '2026-10-03' }] })
  claim(values: Insertable<MemoryNoticeTable> & { kind: MemoryNoticeKind }) {
    return this.db
      .insertInto('memory_notice')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .returning(['memory_notice.id'])
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async setNotification(id: string, notificationId: string): Promise<void> {
    await this.db.updateTable('memory_notice').set({ notificationId }).where('memory_notice.id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('memory_notice').where('memory_notice.id', '=', id).execute();
  }

  /** whether the user got the notification of the day on that day (in their time zone) */
  @GenerateSql({ params: [DummyValue.UUID, '2026-10-03'] })
  async hasDay(userId: string, day: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('memory_notice')
      .select('memory_notice.id')
      .where('memory_notice.userId', '=', userId)
      .where('memory_notice.day', '=', day)
      .where('memory_notice.kind', 'in', ['memory', 'draft'])
      .executeTakeFirst();
    return !!row;
  }

  /** which of these memories, drafts or weeks were sent to the user */
  @GenerateSql({ params: [DummyValue.UUID, 'memory', [DummyValue.UUID]] })
  async getSent(userId: string, kind: MemoryNoticeKind, refIds: string[]): Promise<Set<string>> {
    if (refIds.length === 0) {
      return new Set();
    }
    const rows = await this.db
      .selectFrom('memory_notice')
      .select('memory_notice.refId')
      .where('memory_notice.userId', '=', userId)
      .where('memory_notice.kind', '=', kind)
      .where('memory_notice.refId', 'in', refIds)
      .execute();
    return new Set(rows.map(({ refId }) => refId));
  }

  /** forgets what was sent before then; a memory is not kept that long unless saved, and saved ones are not notified */
  @GenerateSql({ params: [DummyValue.DATE] })
  async cleanup(before: Date): Promise<void> {
    await this.db.deleteFrom('memory_notice').where('memory_notice.createdAt', '<', before).execute();
  }
}

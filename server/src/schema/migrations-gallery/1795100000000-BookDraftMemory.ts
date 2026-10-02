import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "book_draft" ADD "memoryId" uuid;`.execute(db);
  await sql`CREATE INDEX "book_draft_memoryId_idx" ON "book_draft" ("memoryId");`.execute(db);
  await sql`ALTER TABLE "book_draft" ADD CONSTRAINT "book_draft_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memory" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "book_draft" DROP CONSTRAINT "book_draft_memoryId_fkey";`.execute(db);
  await sql`DROP INDEX "book_draft_memoryId_idx";`.execute(db);
  await sql`ALTER TABLE "book_draft" DROP COLUMN "memoryId";`.execute(db);
}

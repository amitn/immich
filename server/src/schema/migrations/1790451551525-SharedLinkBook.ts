import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_link" ADD "bookId" uuid;`.execute(db);
  await sql`CREATE INDEX "shared_link_bookId_idx" ON "shared_link" ("bookId");`.execute(db);
  await sql`ALTER TABLE "shared_link" ADD CONSTRAINT "shared_link_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "book" ("id") ON UPDATE CASCADE ON DELETE CASCADE;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // links to books mean nothing without the column
  await sql`DELETE FROM "shared_link" WHERE "type" = 'BOOK';`.execute(db);
  await sql`ALTER TABLE "shared_link" DROP CONSTRAINT "shared_link_bookId_fkey";`.execute(db);
  await sql`DROP INDEX "shared_link_bookId_idx";`.execute(db);
  await sql`ALTER TABLE "shared_link" DROP COLUMN "bookId";`.execute(db);
}

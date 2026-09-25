import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "book" ADD "exportedAt" timestamp with time zone;`.execute(db);
  await sql`ALTER TABLE "book" ADD "htmlExportedAt" timestamp with time zone;`.execute(db);
  await sql`ALTER TABLE "book" ADD "contentUpdatedAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "book" DROP COLUMN "contentUpdatedAt";`.execute(db);
  await sql`ALTER TABLE "book" DROP COLUMN "htmlExportedAt";`.execute(db);
  await sql`ALTER TABLE "book" DROP COLUMN "exportedAt";`.execute(db);
}

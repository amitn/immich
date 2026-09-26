import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "book" ADD "htmlExportStatus" character varying;`.execute(db);
  await sql`ALTER TABLE "book" ADD "htmlExportPath" character varying;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "book" DROP COLUMN "htmlExportPath";`.execute(db);
  await sql`ALTER TABLE "book" DROP COLUMN "htmlExportStatus";`.execute(db);
}

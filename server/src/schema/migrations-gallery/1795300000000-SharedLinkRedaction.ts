import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // (#14) a link can blur the faces of people who are not in what it shares, and the text and number plates
  await sql`ALTER TABLE "shared_link" ADD "redactFaces" boolean NOT NULL DEFAULT false;`.execute(db);
  await sql`ALTER TABLE "shared_link" ADD "redactText" boolean NOT NULL DEFAULT false;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_link" DROP COLUMN "redactFaces";`.execute(db);
  await sql`ALTER TABLE "shared_link" DROP COLUMN "redactText";`.execute(db);
}

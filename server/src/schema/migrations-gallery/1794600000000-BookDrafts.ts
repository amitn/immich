import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "book" ADD "status" character varying NOT NULL DEFAULT 'active';`.execute(db);
  await sql`CREATE TABLE "book_draft" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "key" character varying NOT NULL,
  "kind" character varying NOT NULL,
  "state" character varying NOT NULL DEFAULT 'drafted',
  "bookId" uuid,
  "title" character varying NOT NULL,
  "reason" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "book_draft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "book_draft_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "book" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "book_draft_ownerId_key_uq" UNIQUE ("ownerId", "key"),
  CONSTRAINT "book_draft_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "book_draft_bookId_idx" ON "book_draft" ("bookId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "book_draft_updatedAt"
  BEFORE UPDATE ON "book_draft"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_book_draft_updatedAt', '{"type":"trigger","name":"book_draft_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"book_draft_updatedAt\\"\\n  BEFORE UPDATE ON \\"book_draft\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_book_draft_updatedAt';`.execute(db);
  await sql`DROP TRIGGER "book_draft_updatedAt" ON "book_draft";`.execute(db);
  await sql`DROP TABLE "book_draft";`.execute(db);
  await sql`ALTER TABLE "book" DROP COLUMN "status";`.execute(db);
}

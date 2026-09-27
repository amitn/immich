import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "highlight_job" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "albumId" uuid,
  "bookId" uuid,
  "musicAssetId" uuid,
  "title" character varying NOT NULL,
  "options" jsonb NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "progress" real NOT NULL DEFAULT 0,
  "error" text,
  "warnings" jsonb,
  "resultAssetId" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "highlight_job_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "highlight_job_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "highlight_job_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "book" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "highlight_job_musicAssetId_fkey" FOREIGN KEY ("musicAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "highlight_job_resultAssetId_fkey" FOREIGN KEY ("resultAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "highlight_job_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "highlight_job_ownerId_idx" ON "highlight_job" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "highlight_job_albumId_idx" ON "highlight_job" ("albumId");`.execute(db);
  await sql`CREATE INDEX "highlight_job_bookId_idx" ON "highlight_job" ("bookId");`.execute(db);
  await sql`CREATE INDEX "highlight_job_musicAssetId_idx" ON "highlight_job" ("musicAssetId");`.execute(db);
  await sql`CREATE INDEX "highlight_job_resultAssetId_idx" ON "highlight_job" ("resultAssetId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "highlight_job_updatedAt"
  BEFORE UPDATE ON "highlight_job"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_highlight_job_updatedAt', '{"type":"trigger","name":"highlight_job_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"highlight_job_updatedAt\\"\\n  BEFORE UPDATE ON \\"highlight_job\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "highlight_job";`.execute(db);
  await sql`DROP TRIGGER "highlight_job_updatedAt" ON "highlight_job";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_highlight_job_updatedAt';`.execute(db);
}

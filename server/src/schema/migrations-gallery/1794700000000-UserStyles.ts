import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "art_style" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "name" character varying NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "prompt" text NOT NULL,
  "usesCaption" boolean NOT NULL DEFAULT false,
  "photoAbove" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "art_style_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "art_style_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "art_style_ownerId_idx" ON "art_style" ("ownerId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "art_style_updatedAt"
  BEFORE UPDATE ON "art_style"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "book_style" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "name" character varying NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "style" jsonb NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "book_style_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "book_style_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "book_style_ownerId_idx" ON "book_style" ("ownerId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "book_style_updatedAt"
  BEFORE UPDATE ON "book_style"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_art_style_updatedAt', '{"type":"trigger","name":"art_style_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"art_style_updatedAt\\"\\n  BEFORE UPDATE ON \\"art_style\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_book_style_updatedAt', '{"type":"trigger","name":"book_style_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"book_style_updatedAt\\"\\n  BEFORE UPDATE ON \\"book_style\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // the triggers and indexes are dropped with their tables
  await sql`DROP TABLE "art_style";`.execute(db);
  await sql`DROP TABLE "book_style";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_art_style_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_book_style_updatedAt';`.execute(db);
}

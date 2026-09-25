import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "agent_session" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "title" character varying,
  "profile" character varying NOT NULL,
  "acpSessionId" character varying,
  "status" character varying NOT NULL DEFAULT 'idle',
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "agent_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "agent_session_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "agent_session_userId_idx" ON "agent_session" ("userId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "agent_session_updatedAt"
  BEFORE UPDATE ON "agent_session"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "agent_message" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "sessionId" uuid NOT NULL,
  "role" character varying NOT NULL,
  "kind" character varying NOT NULL,
  "externalId" character varying,
  "content" jsonb NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "agent_message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "agent_message_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "agent_message_sessionId_createdAt_idx" ON "agent_message" ("sessionId", "createdAt");`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_message_sessionId_idx" ON "agent_message" ("sessionId");`.execute(db);
  await sql`CREATE TABLE "art_job" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "sourceAssetId" uuid NOT NULL,
  "resultAssetId" uuid,
  "style" character varying,
  "prompt" text NOT NULL,
  "caption" character varying,
  "profile" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "error" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "art_job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "art_job_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "art_job_resultAssetId_fkey" FOREIGN KEY ("resultAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "art_job_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "art_job_userId_idx" ON "art_job" ("userId");`.execute(db);
  await sql`CREATE INDEX "art_job_sourceAssetId_idx" ON "art_job" ("sourceAssetId");`.execute(db);
  await sql`CREATE INDEX "art_job_resultAssetId_idx" ON "art_job" ("resultAssetId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "art_job_updatedAt"
  BEFORE UPDATE ON "art_job"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "book" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "albumId" uuid,
  "coverAssetId" uuid,
  "title" character varying NOT NULL,
  "subtitle" character varying,
  "pageWidthMm" integer NOT NULL,
  "pageHeightMm" integer NOT NULL,
  "style" jsonb NOT NULL,
  "exportStatus" character varying,
  "exportPath" character varying,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "book_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "book_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "book_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "book_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "book_ownerId_idx" ON "book" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "book_albumId_idx" ON "book" ("albumId");`.execute(db);
  await sql`CREATE INDEX "book_coverAssetId_idx" ON "book" ("coverAssetId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "book_updatedAt"
  BEFORE UPDATE ON "book"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "book_page" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "bookId" uuid NOT NULL,
  "position" integer NOT NULL,
  "layout" character varying NOT NULL,
  "sectionTitle" character varying,
  "caption" text,
  "background" character varying,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "book_page_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "book" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "book_page_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "book_page_bookId_idx" ON "book_page" ("bookId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "book_page_updatedAt"
  BEFORE UPDATE ON "book_page"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "book_page_asset" (
  "pageId" uuid NOT NULL,
  "slot" integer NOT NULL,
  "assetId" uuid NOT NULL,
  "crop" jsonb,
  "caption" text,
  CONSTRAINT "book_page_asset_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "book_page" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "book_page_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "book_page_asset_pkey" PRIMARY KEY ("pageId", "slot")
);`.execute(db);
  await sql`CREATE INDEX "book_page_asset_pageId_idx" ON "book_page_asset" ("pageId");`.execute(db);
  await sql`CREATE INDEX "book_page_asset_assetId_idx" ON "book_page_asset" ("assetId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_agent_session_updatedAt', '{"type":"trigger","name":"agent_session_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_session_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_session\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_art_job_updatedAt', '{"type":"trigger","name":"art_job_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"art_job_updatedAt\\"\\n  BEFORE UPDATE ON \\"art_job\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_book_updatedAt', '{"type":"trigger","name":"book_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"book_updatedAt\\"\\n  BEFORE UPDATE ON \\"book\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_book_page_updatedAt', '{"type":"trigger","name":"book_page_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"book_page_updatedAt\\"\\n  BEFORE UPDATE ON \\"book_page\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "book_page_asset";`.execute(db);
  await sql`DROP TABLE "book_page";`.execute(db);
  await sql`DROP TABLE "book";`.execute(db);
  await sql`DROP TABLE "art_job";`.execute(db);
  await sql`DROP TABLE "agent_message";`.execute(db);
  await sql`DROP TABLE "agent_session";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_agent_session_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_art_job_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_book_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_book_page_updatedAt';`.execute(db);
}

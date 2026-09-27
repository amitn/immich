import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "activity_log" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "source" character varying NOT NULL,
  "sessionId" uuid,
  "toolName" character varying,
  "action" character varying NOT NULL,
  "summary" text NOT NULL,
  "targetId" uuid,
  "assetIds" uuid[] NOT NULL DEFAULT '{}',
  "undo" jsonb,
  "groupId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "undoneAt" timestamp with time zone,
  "undoneBy" character varying,
  CONSTRAINT "activity_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "activity_log_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "activity_log_userId_createdAt_idx" ON "activity_log" ("userId", "createdAt");`.execute(db);
  await sql`CREATE INDEX "activity_log_sessionId_idx" ON "activity_log" ("sessionId");`.execute(db);
  await sql`CREATE INDEX "activity_log_groupId_idx" ON "activity_log" ("groupId");`.execute(db);
  await sql`CREATE TABLE "book_revision" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "bookId" uuid NOT NULL,
  "snapshot" jsonb NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "book_revision_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "book" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "book_revision_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "book_revision_bookId_idx" ON "book_revision" ("bookId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "activity_log";`.execute(db);
  await sql`DROP TABLE "book_revision";`.execute(db);
}

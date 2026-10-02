import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "collection_notice" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "pack" character varying NOT NULL,
  "key" character varying NOT NULL,
  "assetIds" uuid[] NOT NULL,
  "notificationId" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "collection_notice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "collection_notice_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notification" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "collection_notice_userId_pack_key_uq" UNIQUE ("userId", "pack", "key"),
  CONSTRAINT "collection_notice_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "collection_notice_notificationId_idx" ON "collection_notice" ("notificationId");`.execute(db);
  await sql`CREATE TABLE "collection_notice_check" (
  "userId" uuid NOT NULL,
  "checkedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "collection_notice_check_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "collection_notice_check_pkey" PRIMARY KEY ("userId")
);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "collection_notice";`.execute(db);
  await sql`DROP TABLE "collection_notice_check";`.execute(db);
}

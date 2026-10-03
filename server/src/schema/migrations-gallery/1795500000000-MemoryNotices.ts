import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "memory_notice" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "kind" character varying NOT NULL,
  "refId" character varying NOT NULL,
  "day" date NOT NULL,
  "notificationId" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "memory_notice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_notice_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notification" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "memory_notice_userId_kind_refId_uq" UNIQUE ("userId", "kind", "refId"),
  CONSTRAINT "memory_notice_kind_chk" CHECK ("kind" IN ('memory', 'draft', 'digest')),
  CONSTRAINT "memory_notice_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE UNIQUE INDEX "memory_notice_userId_day_key" ON "memory_notice" ("userId", "day") WHERE ("kind" IN ('memory', 'draft'));`.execute(
    db,
  );
  await sql`CREATE INDEX "memory_notice_notificationId_idx" ON "memory_notice" ("notificationId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_memory_notice_userId_day_key', '{"type":"index","name":"memory_notice_userId_day_key","sql":"CREATE UNIQUE INDEX \\"memory_notice_userId_day_key\\" ON \\"memory_notice\\" (\\"userId\\", \\"day\\") WHERE (\\"kind\\" IN (''memory'', ''draft''));"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "memory_notice";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_memory_notice_userId_day_key';`.execute(db);
}

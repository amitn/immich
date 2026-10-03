import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "memory_exclusion" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "type" character varying NOT NULL,
  "personGroupId" uuid,
  "albumId" uuid,
  "startDate" date,
  "endDate" date,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "memory_exclusion_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_exclusion_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_exclusion_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "memory_exclusion_kind_chk" CHECK (("type" = 'person' AND "personGroupId" IS NOT NULL AND "albumId" IS NULL AND "startDate" IS NULL) OR ("type" = 'album' AND "albumId" IS NOT NULL AND "personGroupId" IS NULL AND "startDate" IS NULL) OR ("type" = 'date_range' AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "startDate" <= "endDate" AND "personGroupId" IS NULL AND "albumId" IS NULL)),
  CONSTRAINT "memory_exclusion_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE UNIQUE INDEX "memory_exclusion_ownerId_albumId_key" ON "memory_exclusion" ("ownerId", "albumId") WHERE ("albumId" IS NOT NULL);`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX "memory_exclusion_ownerId_personGroupId_key" ON "memory_exclusion" ("ownerId", "personGroupId") WHERE ("personGroupId" IS NOT NULL);`.execute(
    db,
  );
  await sql`CREATE INDEX "memory_exclusion_ownerId_idx" ON "memory_exclusion" ("ownerId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_memory_exclusion_ownerId_albumId_key', '{"type":"index","name":"memory_exclusion_ownerId_albumId_key","sql":"CREATE UNIQUE INDEX \\"memory_exclusion_ownerId_albumId_key\\" ON \\"memory_exclusion\\" (\\"ownerId\\", \\"albumId\\") WHERE (\\"albumId\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_memory_exclusion_ownerId_personGroupId_key', '{"type":"index","name":"memory_exclusion_ownerId_personGroupId_key","sql":"CREATE UNIQUE INDEX \\"memory_exclusion_ownerId_personGroupId_key\\" ON \\"memory_exclusion\\" (\\"ownerId\\", \\"personGroupId\\") WHERE (\\"personGroupId\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "memory_exclusion";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_memory_exclusion_ownerId_albumId_key';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_memory_exclusion_ownerId_personGroupId_key';`.execute(
    db,
  );
}

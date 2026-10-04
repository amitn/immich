import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "assistant_routine" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "name" character varying NOT NULL,
  "instruction" text NOT NULL,
  "trigger" jsonb NOT NULL,
  "scope" jsonb NOT NULL DEFAULT '{}',
  "approvalMode" character varying NOT NULL DEFAULT 'ask',
  "limits" jsonb NOT NULL,
  "profile" character varying,
  "enabled" boolean NOT NULL DEFAULT true,
  "pausedAt" timestamp with time zone,
  "consecutiveFailures" integer NOT NULL DEFAULT 0,
  "lastRunAt" timestamp with time zone,
  "nextRunAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "assistant_routine_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "assistant_routine_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "assistant_routine_ownerId_idx" ON "assistant_routine" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "assistant_routine_nextRunAt_idx" ON "assistant_routine" ("nextRunAt");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "assistant_routine_updatedAt"
  BEFORE UPDATE ON "assistant_routine"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "assistant_routine_event" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "routineId" uuid NOT NULL,
  "kind" character varying NOT NULL,
  "assetIds" uuid[] NOT NULL DEFAULT '{}',
  "data" jsonb,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_routine_event_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "assistant_routine" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "assistant_routine_event_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "assistant_routine_event_routineId_idx" ON "assistant_routine_event" ("routineId");`.execute(
    db,
  );
  await sql`CREATE TABLE "assistant_routine_run" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "routineId" uuid NOT NULL,
  "ownerId" uuid NOT NULL,
  "sessionId" uuid,
  "trigger" character varying NOT NULL,
  "approvalMode" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'queued',
  "context" jsonb NOT NULL DEFAULT '{}',
  "limits" jsonb NOT NULL,
  "summary" text,
  "error" text,
  "toolCalls" integer NOT NULL DEFAULT 0,
  "changes" integer NOT NULL DEFAULT 0,
  "tokenHash" character varying,
  "cancelRequested" boolean NOT NULL DEFAULT false,
  "startedAt" timestamp with time zone,
  "finishedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_routine_run_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "assistant_routine" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "assistant_routine_run_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "assistant_routine_run_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "assistant_routine_run_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "assistant_routine_run_ownerId_createdAt_idx" ON "assistant_routine_run" ("ownerId", "createdAt");`.execute(
    db,
  );
  await sql`CREATE INDEX "assistant_routine_run_routineId_idx" ON "assistant_routine_run" ("routineId");`.execute(db);
  await sql`CREATE INDEX "assistant_routine_run_sessionId_idx" ON "assistant_routine_run" ("sessionId");`.execute(db);
  await sql`CREATE INDEX "assistant_routine_run_tokenHash_idx" ON "assistant_routine_run" ("tokenHash");`.execute(db);
  await sql`CREATE TABLE "assistant_routine_approval" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "runId" uuid NOT NULL,
  "ownerId" uuid NOT NULL,
  "toolName" character varying NOT NULL,
  "title" character varying NOT NULL,
  "summary" text NOT NULL,
  "input" jsonb NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "result" text,
  "activityIds" uuid[] NOT NULL DEFAULT '{}',
  "expiresAt" timestamp with time zone NOT NULL,
  "decidedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_routine_approval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "assistant_routine_run" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "assistant_routine_approval_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "assistant_routine_approval_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "assistant_routine_approval_ownerId_status_idx" ON "assistant_routine_approval" ("ownerId", "status");`.execute(
    db,
  );
  await sql`CREATE INDEX "assistant_routine_approval_runId_idx" ON "assistant_routine_approval" ("runId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_assistant_routine_updatedAt', '{"type":"trigger","name":"assistant_routine_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"assistant_routine_updatedAt\\"\\n  BEFORE UPDATE ON \\"assistant_routine\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_assistant_routine_updatedAt';`.execute(db);
  await sql`DROP TRIGGER "assistant_routine_updatedAt" ON "assistant_routine";`.execute(db);
  await sql`DROP TABLE "assistant_routine_event";`.execute(db);
  await sql`DROP TABLE "assistant_routine_approval";`.execute(db);
  await sql`DROP TABLE "assistant_routine_run";`.execute(db);
  await sql`DROP TABLE "assistant_routine";`.execute(db);
}

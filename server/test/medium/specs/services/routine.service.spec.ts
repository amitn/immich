import { UnauthorizedException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import z from 'zod';
import { defaults } from 'src/dtos/config.dto.js';
import {
  ActivityLogAction,
  AgentMessageKind,
  AgentMessageRole,
  JobName,
  JobStatus,
  RoutineApprovalMode,
  RoutineApprovalStatus,
  RoutineEvent,
  RoutineRunStatus,
  RoutineTriggerType,
} from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AcpRepository } from 'src/repositories/acp.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AgentRepository } from 'src/repositories/agent.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { NotificationRepository } from 'src/repositories/notification.repository.js';
import { RoutineRepository } from 'src/repositories/routine.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { AgentToolService } from 'src/services/agent-tool.service.js';
import { AgentService } from 'src/services/agent.service.js';
import { BaseService } from 'src/services/base.service.js';
import { RoutineService, clearRoutineEventOwners } from 'src/services/routine.service.js';
import { recordActivity } from 'src/utils/activity-log.js';
import { AgentTool, defineTool, toolJson } from 'src/utils/agent/tools.js';
import { clearConfigCache } from 'src/utils/config.js';
import { hashRoutineToken } from 'src/utils/routines.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

/**
 * Assistant routines (#15), end to end with the scripted ACP agent: the job of a run (here `RoutineService.handleRun`)
 * starts the agent headless with the run's token; its MCP calls reach another AgentService (the API worker), which finds
 * the run by the token's hash in the database and applies the approval mode; approving a queued change makes the
 * recorded call again, in the run's activity group.
 */

const fakeAgent = fileURLToPath(new URL('../../../fixtures/fake-acp-agent.mjs', import.meta.url));

let defaultDatabase: Kysely<DB>;

/** the albums the fake create_album made, by name */
let made: string[] = [];

const testTools = (db: Kysely<DB>): AgentTool[] => [
  defineTool({
    name: 'create_album',
    title: 'Create album',
    description: 'Pretends to create an album, and records it in the activity log',
    input: z.object({ name: z.string() }),
    mutating: true,
    handler: async ({ auth, activity }, { name }) => {
      made.push(name);
      await recordActivity({ repository: new ActivityLogRepository(db) }, auth.user.id, activity, {
        action: ActivityLogAction.AlbumCreate,
        summary: `Created ${name}`,
        targetId: null,
        undo: null,
      });
      return toolJson({ name });
    },
  }),
  defineTool({
    name: 'clean_up_bursts',
    title: 'Clean up bursts',
    description: 'Pretends to archive bursts',
    input: z.object({}),
    mutating: true,
    handler: () => Promise.resolve(toolJson({ archived: 3 })),
  }),
];

const startMcpServer = async (api: AgentService) => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      api.handleMcpRequest(req.headers.authorization, req, res, text ? JSON.parse(text) : undefined).catch((error) => {
        res.writeHead(error instanceof UnauthorizedException ? 401 : 500).end();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/agent/mcp`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const setup = async () => {
  const { sut, ctx } = newMediumService(RoutineService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AcpRepository,
      ActivityLogRepository,
      AgentRepository,
      ConfigRepository,
      NotificationRepository,
      RoutineRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository, WebsocketRepository],
  });

  const tools = testTools(defaultDatabase);
  vi.spyOn(AgentToolService.prototype, 'getTools').mockReturnValue(tools);
  vi.spyOn(AgentToolService.prototype, 'getTool').mockImplementation((name) =>
    tools.find((tool) => tool.name === name),
  );

  // the API worker: it serves the MCP endpoint, with its own memory (no token of the run in it)
  const api = BaseService.create(AgentService, sut);
  const mcp = await startMcpServer(api);
  await ctx.updateConfig({
    ...defaults,
    agent: {
      ...defaults.agent,
      enabled: true,
      chatProfile: 'fake',
      mcpUrl: mcp.url,
      profiles: [{ name: 'fake', command: process.execPath, args: [fakeAgent], env: [], passEnv: [] }],
    },
  });

  const job = ctx.getMock(JobRepository);
  job.queue.mockResolvedValue();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });
  const repository = new RoutineRepository(defaultDatabase);

  /** the queued RoutineRun jobs, as the job worker would run them */
  const runQueued = async () => {
    const ids = job.queue.mock.calls
      .map(([item]) => item)
      .filter((item) => item.name === JobName.RoutineRun)
      .map((item) => (item.data as { id: string }).id);
    job.queue.mockClear();
    const statuses = [];
    for (const id of ids) {
      statuses.push(await sut.handleRun({ id }));
    }
    return statuses;
  };

  return { sut, ctx, auth, mcp, repository, runQueued, db: defaultDatabase };
};

type Context = Awaited<ReturnType<typeof setup>>;
let context: Context | undefined;

const callLine = (name: string, args: Record<string, unknown> = {}) =>
  `call:${JSON.stringify({ name, arguments: args })}`;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

beforeEach(() => {
  clearConfigCache();
  clearRoutineEventOwners();
  made = [];
});

afterEach(async () => {
  await context?.mcp.close();
  context = undefined;
  vi.restoreAllMocks();
});

describe(RoutineService.name, () => {
  it('should queue the changes of an Ask me run, and apply them as recorded once approved', async () => {
    context = await setup();
    const { sut, auth, runQueued, repository } = context;

    const routine = await sut.create(auth, {
      name: 'Italy album',
      instruction: `Make the album\n${callLine('create_album', { name: 'Italy' })}`,
      trigger: { type: RoutineTriggerType.Manual },
    });
    expect(routine.approvalMode).toBe(RoutineApprovalMode.Ask);

    const queued = await sut.run(auth, routine.id, {});
    expect(queued.status).toBe(RoutineRunStatus.Queued);
    await expect(runQueued()).resolves.toEqual([JobStatus.Success]);

    // nothing was made, the change waits in the inbox
    expect(made).toEqual([]);
    const run = await sut.getRun(auth, queued.id);
    expect(run).toMatchObject({ status: RoutineRunStatus.Succeeded, toolCalls: 1, changes: 0, pendingApprovals: 1 });
    expect(run.summary).toContain('Done');
    expect(run.approvals).toEqual([
      expect.objectContaining({
        toolName: 'create_album',
        input: { name: 'Italy' },
        status: RoutineApprovalStatus.Pending,
      }),
    ]);
    // the transcript opens like a chat, and is not one of the chats
    expect(run.messages[0]).toMatchObject({
      role: AgentMessageRole.User,
      kind: AgentMessageKind.Text,
      content: { text: expect.stringContaining('Make the album') },
    });
    expect(run.messages.some((message) => message.kind === AgentMessageKind.ToolCall)).toBe(true);
    await expect(BaseService.create(AgentService, sut).getSessions(auth)).resolves.toEqual([]);
    // the token was revoked with the run
    const ended = await repository.getRun(queued.id);
    expect(ended?.tokenHash).toBeNull();

    const inbox = await sut.getInbox(auth);
    expect(inbox).toEqual([expect.objectContaining({ routineName: 'Italy album', toolName: 'create_album' })]);

    const decision = await sut.decide(auth, { ids: [inbox[0].id], approve: true });
    expect(decision).toMatchObject({ applied: 1, failed: 0 });
    expect(made).toEqual(['Italy']);
    // a change can only be applied once
    await expect(sut.decide(auth, { ids: [inbox[0].id], approve: true })).resolves.toMatchObject({
      applied: 0,
      skipped: 1,
    });
    expect(made).toEqual(['Italy']);

    // the change is in the activity log, in the run's group
    const changes = await new ActivityLogRepository(context.db).search(auth.user.id, { groupId: queued.id, limit: 10 });
    expect(changes).toEqual([expect.objectContaining({ summary: 'Created Italy', sessionId: run.sessionId })]);

    const notifications = await context.db
      .selectFrom('notification')
      .selectAll()
      .where('userId', '=', auth.user.id)
      .execute();
    expect(notifications).toEqual([
      expect.objectContaining({ title: 'Routine “Italy album” ran', description: '1 needs your OK' }),
    ]);
  });

  it('should make the safe changes of an Auto-approve run, and queue the others', async () => {
    context = await setup();
    const { sut, auth, runQueued } = context;

    const safe = await sut.create(auth, {
      name: 'Safe',
      instruction: `Make the album\n${callLine('create_album', { name: 'Sicily' })}`,
      trigger: { type: RoutineTriggerType.Manual },
      approvalMode: RoutineApprovalMode.AutoSafe,
    });
    const unsafe = await sut.create(auth, {
      name: 'Unsafe',
      instruction: `Archive the bursts\n${callLine('clean_up_bursts')}`,
      trigger: { type: RoutineTriggerType.Manual },
      approvalMode: RoutineApprovalMode.AutoSafe,
    });

    const safeRun = await sut.run(auth, safe.id, {});
    await runQueued();
    const unsafeRun = await sut.run(auth, unsafe.id, {});
    await runQueued();

    expect(made).toEqual(['Sicily']);
    await expect(sut.getRun(auth, safeRun.id)).resolves.toMatchObject({ changes: 1, pendingApprovals: 0 });
    await expect(sut.getRun(auth, unsafeRun.id)).resolves.toMatchObject({
      changes: 0,
      pendingApprovals: 1,
      approvals: [expect.objectContaining({ toolName: 'clean_up_bursts' })],
    });
    const changes = await new ActivityLogRepository(context.db).search(auth.user.id, {
      groupId: safeRun.id,
      limit: 10,
    });
    expect(changes).toHaveLength(1);
  });

  it('should only report the changes of a dry run', async () => {
    context = await setup();
    const { sut, auth, runQueued } = context;
    const routine = await sut.create(auth, {
      name: 'Dry',
      instruction: `Make the album\n${callLine('create_album', { name: 'Rome' })}`,
      trigger: { type: RoutineTriggerType.Manual },
      approvalMode: RoutineApprovalMode.AutoSafe,
    });

    const queued = await sut.run(auth, routine.id, { dryRun: true });
    await runQueued();

    expect(made).toEqual([]);
    const run = await sut.getRun(auth, queued.id);
    expect(run.approvalMode).toBe(RoutineApprovalMode.DryRun);
    expect(run.approvals).toEqual([expect.objectContaining({ status: RoutineApprovalStatus.DryRun })]);
    await expect(sut.getInbox(auth)).resolves.toEqual([]);
    // a reported change can't be approved
    await expect(sut.decide(auth, { ids: [run.approvals[0].id], approve: true })).resolves.toMatchObject({
      applied: 0,
      skipped: 1,
    });
  });

  it('should batch the uploads into one run once they settle, without the photos of runs', async () => {
    context = await setup();
    const { sut, auth, runQueued, db } = context;
    const routine = await sut.create(auth, {
      name: 'New photos',
      instruction: 'Look at the new photos',
      trigger: { type: RoutineTriggerType.Event, event: RoutineEvent.Upload },
    });
    const [a, b] = [factory.uuid(), factory.uuid()];

    await sut.onAssetMetadataExtracted({ assetId: a, userId: auth.user.id, source: 'upload' });
    await sut.onAssetMetadataExtracted({ assetId: b, userId: auth.user.id, source: 'upload' });
    await sut.onAssetMetadataExtracted({ assetId: a, userId: auth.user.id, source: 'sidecar-write' });

    // still uploading: no run yet
    await sut.handleTick();
    await expect(sut.get(auth, routine.id)).resolves.toMatchObject({ pendingEvents: 2 });
    expect(await runQueued()).toEqual([]);

    // the upload settled
    await db
      .updateTable('assistant_routine_event')
      .set({ createdAt: new Date(Date.now() - 20 * 60_000) })
      .where('routineId', '=', routine.id)
      .execute();
    await sut.handleTick();
    await sut.handleTick();

    const runs = await sut.getRuns(auth, routine.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: RoutineTriggerType.Event,
      events: [expect.objectContaining({ kind: 'upload' })],
    });
    expect(runs[0].assetIds.toSorted()).toEqual([a, b].toSorted());
    await expect(sut.get(auth, routine.id)).resolves.toMatchObject({ pendingEvents: 0 });
    await expect(runQueued()).resolves.toEqual([JobStatus.Success]);
  });

  it('should start a due schedule once and move it to its next run', async () => {
    context = await setup();
    const { sut, auth, db } = context;
    const routine = await sut.create(auth, {
      name: 'Nightly',
      instruction: 'Every night',
      trigger: { type: RoutineTriggerType.Schedule, cron: '0 2 * * *', timezone: 'UTC' },
    });
    expect(routine.nextRunAt).not.toBeNull();
    await db
      .updateTable('assistant_routine')
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where('id', '=', routine.id)
      .execute();

    await sut.handleTick();
    await sut.handleTick();

    await expect(sut.getRuns(auth, routine.id)).resolves.toHaveLength(1);
    const after = await sut.get(auth, routine.id);
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after.nextRunAt!.getUTCHours()).toBe(2);
  });

  it('should expire the changes nobody decided in time', async () => {
    context = await setup();
    const { sut, auth, runQueued, db } = context;
    const routine = await sut.create(auth, {
      name: 'Expiring',
      instruction: `Make the album\n${callLine('create_album', { name: 'Paris' })}`,
      trigger: { type: RoutineTriggerType.Manual },
    });
    await sut.run(auth, routine.id, {});
    await runQueued();
    const [pending] = await sut.getInbox(auth);

    await db
      .updateTable('assistant_routine_approval')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where('id', '=', pending.id)
      .execute();
    await sut.handleTick();

    await expect(sut.getInbox(auth)).resolves.toEqual([]);
    await expect(sut.decide(auth, { ids: [pending.id], approve: true })).resolves.toMatchObject({ skipped: 1 });
    expect(made).toEqual([]);
    const [row] = await sql<{
      status: string;
    }>`select status from assistant_routine_approval where id = ${pending.id}`
      .execute(db)
      .then((r) => r.rows);
    expect(row.status).toBe(RoutineApprovalStatus.Expired);
  });

  it('should refuse the MCP calls of a run that ended', async () => {
    context = await setup();
    const { sut, auth, runQueued, repository } = context;
    const routine = await sut.create(auth, {
      name: 'Ended',
      instruction: 'Nothing',
      trigger: { type: RoutineTriggerType.Manual },
    });
    const queued = await sut.run(auth, routine.id, {});
    await runQueued();

    // the token of a run that ended no longer opens the MCP endpoint, even if its hash were still there
    await repository.updateRun(queued.id, { tokenHash: hashRoutineToken('stale') });
    const api = BaseService.create(AgentService, sut);
    await expect(api.authenticateMcp('Bearer stale')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

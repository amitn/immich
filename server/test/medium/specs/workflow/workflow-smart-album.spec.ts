import { WorkflowTrigger } from '@immich/plugin-sdk';
import { Kysely } from 'kysely';
import { readFileSync } from 'node:fs';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto.js';
import { AssetType, JobName, LogLevel, SharedSpaceRole } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PluginRepository } from 'src/repositories/plugin.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WorkflowRepository } from 'src/repositories/workflow.repository.js';
import { DB } from 'src/schema/index.js';
import { WorkflowAgentTools } from 'src/services/agent-tools/workflow.tools.js';
import { WorkflowExecutionService } from 'src/services/workflow-execution.service.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { upsertTags } from 'src/utils/tag.js';
import { MediumTestContext } from 'test/medium.factory.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// #11: the assistant's smart albums are real workflows, run by the workflow engine and the core and gallery plugins

class SmartAlbumTestContext extends MediumTestContext<typeof WorkflowExecutionService> {
  constructor(database: Kysely<DB>) {
    super(WorkflowExecutionService, {
      database,
      real: [
        AccessRepository,
        ActivityLogRepository,
        AlbumRepository,
        AlbumUserRepository,
        AssetRepository,
        CryptoRepository,
        DatabaseRepository,
        LoggingRepository,
        PluginRepository,
        SearchRepository,
        SharedSpaceRepository,
        StackRepository,
        StorageRepository,
        TagRepository,
        UserRepository,
        WorkflowRepository,
      ],
      mock: [ConfigRepository, EventRepository, JobRepository],
    });
  }

  async init() {
    const env = mockEnvData({});
    env.resourcePaths.corePlugin = '../packages/plugin-core';
    env.resourcePaths.galleryPlugin = '../packages/plugin-gallery';
    env.plugins.external.allow = false;
    this.getMock(ConfigRepository).getEnv.mockReturnValue(env);
    this.getMock(EventRepository).emit.mockResolvedValue();
    this.getMock(JobRepository).queueAll.mockResolvedValue();
    this.get(LoggingRepository).setLogLevel(LogLevel.Fatal);

    await this.sut.onPluginSync();
    await this.sut.onPluginLoad();
  }

  tools() {
    return this.getService(WorkflowAgentTools);
  }

  /** what the workflow engine queued for an event, run as its job queue would */
  async runQueuedWorkflows() {
    const queueAll = this.getMock(JobRepository).queueAll;
    const jobs = queueAll.mock.calls.flatMap(([items]) => items);
    queueAll.mockClear();
    for (const job of jobs) {
      expect(job.name).toBe(JobName.WorkflowAssetTrigger);
      await this.sut.handleAssetTrigger(job.data as never);
    }
    return jobs.length;
  }
}

let ctx: SmartAlbumTestContext;

beforeAll(async () => {
  ctx = new SmartAlbumTestContext(await getKyselyDB());
  await ctx.init();
}, 60_000);

const call = async (auth: AuthDto, name: string, input: Record<string, unknown>) => {
  const tool = ctx
    .tools()
    .getTools()
    .find((tool) => tool.name === name)!;
  const result: AgentToolResult = await tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  const text = (result.content[0] as { text: string }).text;
  expect(result.isError, text).toBeFalsy();
  return JSON.parse(text);
};

const newOwner = async () => {
  const { user } = await ctx.newUser();
  return { user, auth: factory.auth({ user }) };
};

const newPhoto = async (
  ownerId: string,
  { name = 'IMG_0001.jpg', takenAt = '2025-05-01T12:00:00.000Z', country = 'Italy', city = 'Rome' } = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    originalFileName: name,
    type: AssetType.Image,
    fileCreatedAt: new Date(takenAt),
    localDateTime: new Date(takenAt),
  });
  await ctx.newExif({ assetId: asset.id, country, city });
  return asset;
};

const albumAssetIds = async (albumId: string) => {
  const rows = await ctx.database.selectFrom('album_asset').select('assetId').where('albumId', '=', albumId).execute();
  return rows.map(({ assetId }) => assetId).toSorted();
};

const tag = async (userId: string, assetId: string, value: string) => {
  const [created] = await upsertTags(ctx.get(TagRepository), { userId, tags: [value] });
  await ctx.newTagAsset({ tagIds: [created.id], assetIds: [assetId] });
};

describe('smart albums (#11)', () => {
  it('should ship a valid gallery plugin manifest with the tag path filter', () => {
    const manifest = JSON.parse(readFileSync('../packages/plugin-gallery/manifest.json').toString());
    expect(PluginManifestDto.schema.safeParse(manifest).success).toBe(true);
  });

  it('should save "photos from Italy in 2025" as a workflow that fills the album with new photos', async () => {
    const { user, auth } = await newOwner();
    const before = await newPhoto(user.id, { takenAt: '2025-03-01T10:00:00.000Z' });
    await newPhoto(user.id, { takenAt: '2024-03-01T10:00:00.000Z' });

    const draft = await call(auth, 'draft_workflow', {
      name: 'Italy 2025',
      filters: { place: { country: 'italy' }, takenFrom: '2025-01-01', takenTo: '2025-12-31' },
      actions: { album: 'Italy 2025' },
    });
    expect(draft).toMatchObject({
      supported: true,
      summary: expect.stringMatching(
        /if it was taken in 2025 and it was taken in Italy: add it to the album "Italy 2025"/,
      ),
      workflow: { trigger: WorkflowTrigger.AssetMetadataExtraction },
      creates: { album: 'Italy 2025' },
      preview: { count: 1, sampleIds: [before.id] },
    });

    const saved = await call(auth, 'save_workflow', {
      name: 'Italy 2025',
      filters: { place: { country: 'italy' }, takenFrom: '2025-01-01', takenTo: '2025-12-31' },
      actions: { album: 'Italy 2025' },
    });
    expect(saved).toMatchObject({ albumId: expect.any(String), matchingNow: 1 });
    await expect(albumAssetIds(saved.albumId)).resolves.toEqual([]);

    // a new photo from Italy, and one from Spain: the engine runs the workflow once their metadata is read
    const rome = await newPhoto(user.id, { takenAt: '2025-08-10T09:00:00.000Z' });
    const madrid = await newPhoto(user.id, { takenAt: '2025-08-11T09:00:00.000Z', country: 'Spain', city: 'Madrid' });
    await ctx.sut.onAssetMetadataExtracted({ userId: user.id, assetId: rome.id });
    await ctx.sut.onAssetMetadataExtracted({ userId: user.id, assetId: madrid.id });
    await expect(ctx.runQueuedWorkflows()).resolves.toBe(2);

    await expect(albumAssetIds(saved.albumId)).resolves.toEqual([rome.id]);

    // the photo that matched before the workflow was saved, added on request
    const applied = await call(auth, 'apply_workflow', { workflowId: saved.workflowId });
    expect(applied).toMatchObject({ matched: 2, results: [{ albumId: saved.albumId, added: 1 }] });
    await expect(albumAssetIds(saved.albumId)).resolves.toEqual([before.id, rome.id].toSorted());
  });

  it('should save a rule that runs at upload as an AssetCreate workflow', async () => {
    const { user, auth } = await newOwner();
    const saved = await call(auth, 'save_workflow', {
      name: 'Screenshots',
      filters: { fileName: { pattern: 'screenshot' } },
      actions: { album: 'Screenshots' },
    });

    const screenshot = await newPhoto(user.id, { name: 'Screenshot 2025-10-02.png' });
    const photo = await newPhoto(user.id, { name: 'IMG_0002.jpg' });
    await ctx.sut.onAssetCreate({ asset: { id: screenshot.id, ownerId: user.id } });
    await ctx.sut.onAssetCreate({ asset: { id: photo.id, ownerId: user.id } });
    await ctx.runQueuedWorkflows();

    await expect(albumAssetIds(saved.albumId)).resolves.toEqual([screenshot.id]);
  });

  it('should add "every dish from Italy" to the album when the journal names the dish', async () => {
    const { user, auth } = await newOwner();
    const saved = await call(auth, 'save_workflow', {
      name: 'Italian food',
      filters: { tags: ['Food'], place: { country: 'Italy' } },
      actions: { album: 'Italian food' },
    });
    const workflow = await ctx.get(WorkflowRepository).get(saved.workflowId);
    expect(workflow).toMatchObject({ trigger: WorkflowTrigger.AssetTagged });

    const dish = await newPhoto(user.id);
    const wine = await newPhoto(user.id);
    const spanishDish = await newPhoto(user.id, { country: 'Spain', city: 'Madrid' });
    await tag(user.id, dish.id, 'Food/Trattoria Mario/Cacio e pepe');
    await tag(user.id, wine.id, 'Wine/Trattoria Mario/Chianti');
    await tag(user.id, spanishDish.id, 'Food/Casa Lucio/Huevos rotos');
    for (const asset of [dish, wine, spanishDish]) {
      await ctx.sut.onAssetTagged({ userId: user.id, assetId: asset.id });
    }
    await ctx.runQueuedWorkflows();

    await expect(albumAssetIds(saved.albumId)).resolves.toEqual([dish.id]);
  });

  it('should add new photos to a shared space where the user is an editor', async () => {
    const { user, auth } = await newOwner();
    const { space } = await ctx.newSharedSpace({ name: 'Family', createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Editor });

    const saved = await call(auth, 'save_workflow', {
      name: 'Rome to Family',
      filters: { place: { city: 'Rome' } },
      actions: { space: 'family' },
    });
    expect(saved.summary).toMatch(/add it to the shared space "Family"/);

    const rome = await newPhoto(user.id);
    await ctx.sut.onAssetMetadataExtracted({ userId: user.id, assetId: rome.id });
    await ctx.runQueuedWorkflows();

    const rows = await ctx.database
      .selectFrom('shared_space_asset')
      .select('assetId')
      .where('spaceId', '=', space.id)
      .execute();
    expect(rows.map(({ assetId }) => assetId)).toEqual([rome.id]);
  });

  it('should not save a workflow that adds to a space where the user is a viewer', async () => {
    const { user: owner } = await newOwner();
    const { user, auth } = await newOwner();
    const { space } = await ctx.newSharedSpace({ name: 'Neighbours', createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Viewer });

    const tool = ctx
      .tools()
      .getTools()
      .find(({ name }) => name === 'save_workflow')!;
    const result = await tool.handler(
      { auth, sessionId: null },
      tool.input.parse({ name: 'x', filters: { type: 'image' }, actions: { space: 'Neighbours' } }),
    );
    expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/Editor role/) }] });
    await expect(ctx.get(WorkflowRepository).search({ userId: user.id })).resolves.toEqual([]);
  });

  it("should only preview the user's own photos, not a partner's they can see (#21)", async () => {
    const { user, auth } = await newOwner();
    const { user: partner } = await newOwner();
    await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id, inTimeline: true });
    await newPhoto(partner.id, { country: 'Portugal', city: 'Lisbon' });
    const mine = await newPhoto(user.id, { country: 'Portugal', city: 'Porto' });

    const draft = await call(auth, 'draft_workflow', {
      name: 'Portugal',
      filters: { place: { country: 'Portugal' } },
      actions: { album: 'Portugal' },
    });
    expect(draft.preview).toMatchObject({ count: 1, sampleIds: [mine.id] });
  });
});

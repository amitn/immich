import { WorkflowTrigger } from '@immich/plugin-sdk';
import { ActivityLogAction, AlbumUserRole, AssetType, SharedSpaceRole } from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { WorkflowAgentTools } from 'src/services/agent-tools/workflow.tools.js';
import { AlbumService } from 'src/services/album.service.js';
import { GalleryWorkflowHostService } from 'src/services/gallery-workflow-host.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { WorkflowService } from 'src/services/workflow.service.js';
import { ActivityEntry, ActivityRecorder } from 'src/utils/activity-log.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { RuleMethod } from 'src/utils/agent/workflow-rules.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

const errorText = (result: AgentToolResult) => {
  expect(result.isError).toBe(true);
  return (result.content[0] as { text: string }).text;
};

const auth = AuthFactory.create();
const albumId = factory.uuid();
const spaceId = factory.uuid();
const viewerSpaceId = factory.uuid();
const foodTagId = factory.uuid();
const workflowId = factory.uuid();

const searchAsset = (id: string, values: Record<string, unknown> = {}, exif: Record<string, unknown> = {}) =>
  ({
    id,
    originalFileName: 'IMG_0001.jpg',
    type: AssetType.Image,
    localDateTime: new Date('2025-06-01T12:00:00.000Z'),
    exifInfo: exif,
    ...values,
  }) as never;

const stored = (steps: Array<{ method: string; config: Record<string, unknown> | null; enabled?: boolean }>) => ({
  id: workflowId,
  name: 'Italian food',
  description: null,
  trigger: WorkflowTrigger.AssetTagged,
  enabled: true,
  logging: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  steps: steps.map((step) => ({ enabled: true, ...step })),
});

describe(WorkflowAgentTools.name, () => {
  let sut: WorkflowAgentTools;
  let mocks: ServiceMocks;
  let recorded: ActivityEntry[];

  const call = (name: string, input: Record<string, unknown>, activity?: ActivityRecorder) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null, activity }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(WorkflowAgentTools));
    recorded = [];
    mocks.album.getAll.mockResolvedValue([
      {
        id: albumId,
        albumName: 'Italian food',
        albumUsers: [{ user: { id: auth.user.id }, role: AlbumUserRole.Owner }],
      },
    ] as never);
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.sharedSpace.getAllByUserId.mockResolvedValue([
      { id: spaceId, name: 'Family' },
      { id: viewerSpaceId, name: 'Neighbours' },
    ] as never);
    mocks.sharedSpace.getMember.mockImplementation((id) =>
      Promise.resolve({ role: id === spaceId ? SharedSpaceRole.Editor : SharedSpaceRole.Viewer } as never),
    );
    mocks.sharedSpace.getById.mockResolvedValue({ id: spaceId, name: 'Family' } as never);
    mocks.tag.getAll.mockResolvedValue([{ id: foodTagId, value: 'Food' }] as never);
    mocks.plugin.searchMethods.mockResolvedValue([
      { pluginName: 'immich-plugin-core', name: 'assetFileFilter', title: 'Filter by filename', uiHints: ['Filter'] },
      { pluginName: 'immich-plugin-core', name: 'webhook', title: 'Trigger Webhook', uiHints: [] },
    ] as never);
    mocks.search.getCountries.mockResolvedValue(['Italy', 'Spain']);
    mocks.search.searchStatistics.mockResolvedValue({ total: 0 });
    mocks.search.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });
    vi.spyOn(ActivityLogService.prototype, 'record').mockImplementation((_auth, _recorder, entry) => {
      recorded.push(entry);
      return Promise.resolve('change');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should read freely and change workflows only with approval', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'list_workflows', mutating: false },
      { name: 'explain_workflow', mutating: false },
      { name: 'draft_workflow', mutating: false },
      { name: 'save_workflow', mutating: true },
      { name: 'update_workflow', mutating: true },
      { name: 'apply_workflow', mutating: true },
    ]);
    for (const name of ['draft_workflow', 'save_workflow', 'apply_workflow', 'explain_workflow', 'update_workflow']) {
      expect(ASSISTANT_INSTRUCTIONS).toContain(name);
    }
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/Always show the user the rule in plain words/);
  });

  describe('draft_workflow', () => {
    it('should draft "every dish from Italy" with the library spelling and a preview from the search', async () => {
      const [a, b] = [factory.uuid(), factory.uuid()];
      mocks.search.searchStatistics.mockResolvedValue({ total: 2 });
      mocks.search.searchMetadata.mockResolvedValue({ items: [searchAsset(a), searchAsset(b)], hasNextPage: false });

      const result = parse(
        await call('draft_workflow', {
          name: 'Italian food',
          filters: { tags: ['food'], place: { country: 'italy' } },
          actions: { album: 'italian food' },
        }),
      );

      expect(result).toMatchObject({
        supported: true,
        summary:
          'When a photo or video gets a tag (e.g. when a journal names it), if it was taken in Italy and it has the ' +
          'tag "Food" or a tag under it: add it to the album "Italian food".',
        workflow: {
          trigger: WorkflowTrigger.AssetTagged,
          steps: [
            { method: RuleMethod.Location, config: { region: { country: 'Italy' } } },
            { method: RuleMethod.TagPath, config: { tag: 'Food', inverse: false } },
            { method: RuleMethod.AddToAlbums, config: { albumIds: [albumId], albumName: 'Italian food' } },
          ],
        },
        preview: { count: 2, exact: true, sampleIds: [a, b] },
        warnings: [],
      });
      expect(result.creates).toBeUndefined();
      // the user's own photos only, as a workflow runs on the photos the user uploads
      expect(mocks.search.searchStatistics).toHaveBeenCalledWith({
        userIds: [auth.user.id],
        visibility: 'timeline-or-archive',
        withExif: false,
        country: 'Italy',
        tagIds: [foodTagId],
      });
    });

    it('should check the photos the search finds as the plugins would, when the search cannot apply a filter', async () => {
      const [match, other] = [factory.uuid(), factory.uuid()];
      mocks.search.searchMetadata.mockResolvedValue({
        items: [
          searchAsset(match, { originalFileName: 'Screenshot 1.png' }),
          searchAsset(other, { originalFileName: 'Screenshot 2.png', localDateTime: new Date('2024-12-31T23:00:00Z') }),
        ],
        hasNextPage: false,
      });

      const result = parse(
        await call('draft_workflow', {
          name: 'Screenshots 2025',
          filters: { fileName: { pattern: 'screenshot' }, takenFrom: '2025-01-01', takenTo: '2025-12-31' },
          actions: { album: 'Screenshots 2025' },
        }),
      );

      expect(result).toMatchObject({
        workflow: { trigger: WorkflowTrigger.AssetMetadataExtraction },
        creates: { album: 'Screenshots 2025' },
        preview: { count: 1, exact: true, sampleIds: [match] },
      });
      expect(result.summary).toContain('add it to the album "Screenshots 2025" (created if there is none)');
      expect(mocks.search.searchStatistics).not.toHaveBeenCalled();
      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        { page: 1, size: 500 },
        expect.objectContaining({
          userIds: [auth.user.id],
          withExif: true,
          originalFileName: 'screenshot',
          takenAfter: new Date('2024-12-30T00:00:00.000Z'),
          takenBefore: new Date('2026-01-02T23:59:59.000Z'),
          orderDirection: 'desc',
        }),
      );
    });

    it('should preview nothing for a tag that no photo has yet, and say so', async () => {
      const result = parse(
        await call('draft_workflow', {
          name: 'Noma',
          filters: { tags: ['Food/Noma'] },
          actions: { space: 'family' },
        }),
      );

      expect(result.preview).toMatchObject({ count: 0, sampleIds: [] });
      expect(result.warnings).toEqual([expect.stringMatching(/No photo has the tag “Food\/Noma” yet/)]);
      expect(result.actions).toEqual(['add it to the shared space "Family"']);
      expect(mocks.search.searchMetadata).not.toHaveBeenCalled();
    });

    it('should warn about a place the library does not know', async () => {
      const result = parse(
        await call('draft_workflow', {
          name: 'x',
          filters: { place: { country: 'Atlantis' } },
          actions: { album: 'x' },
        }),
      );
      expect(result.warnings).toEqual([expect.stringMatching(/called “Atlantis”.*e\.g\. Italy, Spain/)]);
    });

    it('should not add to a space where the user is a viewer', async () => {
      const text = errorText(
        await call('draft_workflow', { name: 'x', filters: { type: 'video' }, actions: { space: 'Neighbours' } }),
      );
      expect(text).toMatch(/viewer of the space “Neighbours”.*Editor role/);
    });

    it('should list the spaces of the user for an unknown space', async () => {
      const text = errorText(await call('draft_workflow', { name: 'x', filters: {}, actions: { space: 'Work' } }));
      expect(text).toBe('Space “Work” not found. The spaces of the user: “Family”, “Neighbours”');
    });

    it('should reject an invalid rule', async () => {
      const text = errorText(
        await call('draft_workflow', { name: 'x', filters: { takenFrom: '2025-02-30' }, actions: {} }),
      );
      expect(text).toBe(
        'The rule is not valid: takenFrom 2025-02-30 is not a date; a workflow needs an action, e.g. album',
      );
    });

    it('should fall back to a one-off album for "all photos of Mia at the beach"', async () => {
      const mia = factory.uuid();
      const result = parse(
        await call('draft_workflow', {
          name: 'Mia at the beach',
          filters: { personIds: [mia], query: 'at the beach', takenFrom: '2025-01-01' },
          actions: { album: 'Mia at the beach' },
        }),
      );

      expect(result).toMatchObject({
        supported: false,
        unsupported: [
          { filter: 'personIds', reason: expect.stringMatching(/faces/) },
          { filter: 'query', reason: expect.stringMatching(/smart search/) },
        ],
        fallback: {
          message: expect.stringMatching(/one-off album/),
          searchPhotos: { query: 'at the beach', personIds: [mia], takenAfter: '2025-01-01' },
        },
        partialRule: { summary: expect.stringMatching(/on or after 1 January 2025/) },
      });
      expect(mocks.search.searchMetadata).not.toHaveBeenCalled();
    });

    it('should mention the space for "every photo of Mia goes to the Family space"', async () => {
      const result = parse(
        await call('draft_workflow', {
          name: 'Mia',
          filters: { personIds: [factory.uuid()] },
          actions: { space: 'Family' },
        }),
      );
      expect(result.fallback.space).toMatch(/space page/);
      expect(result.partialRule).toBeUndefined();
    });
  });

  describe('save_workflow', () => {
    it('should create the album, then the workflow through the workflow service, and record both', async () => {
      const newAlbumId = factory.uuid();
      const createAlbum = vi
        .spyOn(AlbumService.prototype, 'create')
        .mockResolvedValue({ id: newAlbumId, albumName: 'Screenshots 2025', description: '' } as never);
      const create = vi.spyOn(WorkflowService.prototype, 'create').mockResolvedValue({
        ...stored([]),
        name: 'Screenshots 2025',
      } as never);
      const steps = [
        {
          method: RuleMethod.FileName,
          config: { pattern: 'screenshot', matchType: 'contains', caseSensitive: false },
          enabled: true,
        },
        {
          method: RuleMethod.AddToAlbums,
          config: { albumIds: [newAlbumId], albumName: 'Screenshots 2025' },
          enabled: true,
        },
      ];
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue({
        ...stored(steps),
        name: 'Screenshots 2025',
        trigger: WorkflowTrigger.AssetCreate,
      } as never);
      mocks.search.searchMetadata.mockResolvedValue({
        items: [searchAsset(factory.uuid(), { originalFileName: 'Screenshot.png' })],
        hasNextPage: false,
      });

      const result = parse(
        await call('save_workflow', {
          name: 'Screenshots 2025',
          filters: { fileName: { pattern: 'screenshot' } },
          actions: { album: 'Screenshots 2025' },
        }),
      );

      expect(createAlbum).toHaveBeenCalledWith(auth, { albumName: 'Screenshots 2025' });
      expect(create).toHaveBeenCalledWith(auth, {
        name: 'Screenshots 2025',
        description: null,
        trigger: WorkflowTrigger.AssetCreate,
        enabled: true,
        steps,
      });
      expect(recorded.map(({ action }) => action)).toEqual([
        ActivityLogAction.AlbumCreate,
        ActivityLogAction.WorkflowCreate,
      ]);
      expect(recorded[1]).toMatchObject({
        targetId: workflowId,
        undo: { workflowId, fingerprint: expect.any(String) },
      });
      expect(result).toMatchObject({
        workflowId,
        albumId: newAlbumId,
        created: ['album “Screenshots 2025”'],
        matchingNow: 1,
        next: expect.stringMatching(/apply_workflow to add the 1 photo/),
      });
    });

    it('should create the tags a workflow adds', async () => {
      const tagId = factory.uuid();
      mocks.tag.upsertValue.mockResolvedValue({ id: tagId, value: 'Screenshots' } as never);
      const create = vi.spyOn(WorkflowService.prototype, 'create').mockResolvedValue(stored([]) as never);
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(stored([]) as never);

      await call('save_workflow', {
        name: 'Tag screenshots',
        filters: { fileName: { pattern: 'screenshot' } },
        actions: { addTags: ['Screenshots', 'food'] },
      });

      expect(mocks.tag.upsertValue).toHaveBeenCalledWith({
        userId: auth.user.id,
        value: 'Screenshots',
        parentId: undefined,
      });
      expect(create.mock.calls[0][1].steps?.at(-1)).toEqual({
        method: RuleMethod.AddTags,
        config: { tags: [tagId, foodTagId] },
        enabled: true,
      });
    });

    it('should refuse a rule a workflow cannot express', async () => {
      const create = vi.spyOn(WorkflowService.prototype, 'create');
      const text = errorText(
        await call('save_workflow', { name: 'x', filters: { query: 'beach' }, actions: { album: 'Beach' } }),
      );
      expect(text).toMatch(/A workflow can not do this.*one-off album/);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('list and explain', () => {
    const italianFood = stored([
      { method: RuleMethod.Location, config: { region: { country: 'Italy' } } },
      { method: RuleMethod.TagPath, config: { tag: 'Food' } },
      { method: RuleMethod.AddToAlbums, config: { albumIds: [albumId], albumName: 'Italian food' } },
    ]);

    it('should list the workflows in plain words', async () => {
      vi.spyOn(WorkflowService.prototype, 'search').mockResolvedValue([italianFood] as never);

      expect(parse(await call('list_workflows', {}))).toEqual({
        workflows: [
          {
            workflowId,
            name: 'Italian food',
            enabled: true,
            trigger: WorkflowTrigger.AssetTagged,
            summary: expect.stringMatching(/taken in Italy and it has the tag "Food".*album "Italian food"/),
          },
        ],
      });
    });

    it('should explain a workflow with its rule, the steps a rule cannot express and a preview', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue({
        ...italianFood,
        steps: [
          ...italianFood.steps,
          { method: 'immich-plugin-core#webhook', config: { url: 'https://example.com' }, enabled: true },
        ],
      } as never);
      mocks.search.searchStatistics.mockResolvedValue({ total: 7 });

      const result = parse(await call('explain_workflow', { workflowId, withPreview: true }));

      expect(result).toMatchObject({
        rule: { filters: { place: { country: 'Italy' }, tags: ['Food'] }, actions: { album: albumId } },
        otherSteps: [{ method: 'immich-plugin-core#webhook', title: 'Trigger Webhook', enabled: true }],
        actions: ['add it to the album "Italian food"', 'send it to https://example.com'],
        preview: { count: 7 },
      });
    });
  });

  describe('update_workflow', () => {
    it('should rename and turn off a workflow, and record its previous state', async () => {
      const current = stored([{ method: RuleMethod.Archive, config: { inverse: false } }]);
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(current as never);
      const update = vi
        .spyOn(WorkflowService.prototype, 'update')
        .mockResolvedValue({ ...current, name: 'Archive', enabled: false } as never);

      const result = parse(await call('update_workflow', { workflowId, name: 'Archive', enabled: false }));

      expect(update).toHaveBeenCalledWith(auth, workflowId, {
        name: 'Archive',
        description: undefined,
        enabled: false,
      });
      expect(recorded).toEqual([
        expect.objectContaining({
          action: ActivityLogAction.WorkflowUpdate,
          undo: expect.objectContaining({
            workflowId,
            previous: expect.objectContaining({ name: 'Italian food', enabled: true }),
          }),
        }),
      ]);
      expect(result.summary).toMatch(/archive it/);
    });

    it('should replace the filters and keep the actions', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(
        stored([
          { method: RuleMethod.TagPath, config: { tag: 'Food' } },
          { method: RuleMethod.AddToSpace, config: { spaceIds: [spaceId] } },
        ]) as never,
      );
      const update = vi.spyOn(WorkflowService.prototype, 'update').mockResolvedValue(stored([]) as never);

      await call('update_workflow', { workflowId, filters: { type: 'video' } });

      expect(update).toHaveBeenCalledWith(auth, workflowId, {
        name: undefined,
        description: undefined,
        enabled: undefined,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [
          { method: RuleMethod.Type, config: { allowedTypes: [AssetType.Video] }, enabled: true },
          { method: RuleMethod.AddToSpace, config: { spaceIds: [spaceId] }, enabled: true },
        ],
      });
    });

    it('should not drop the steps a rule cannot express unless asked', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(
        stored([{ method: 'immich-plugin-core#webhook', config: { url: 'https://example.com' } }]) as never,
      );
      const update = vi.spyOn(WorkflowService.prototype, 'update').mockResolvedValue(stored([]) as never);

      expect(errorText(await call('update_workflow', { workflowId, actions: { archive: true } }))).toMatch(
        /dropOtherSteps/,
      );
      expect(update).not.toHaveBeenCalled();

      await call('update_workflow', { workflowId, actions: { archive: true }, dropOtherSteps: true });
      expect(update).toHaveBeenCalled();
    });

    it('should need something to change', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(stored([]) as never);
      expect(errorText(await call('update_workflow', { workflowId }))).toMatch(/Nothing to change/);
    });
  });

  describe('apply_workflow', () => {
    const [a, b, c] = [factory.uuid(), factory.uuid(), factory.uuid()];

    beforeEach(() => {
      mocks.search.searchStatistics.mockResolvedValue({ total: 3 });
      mocks.search.searchMetadata.mockResolvedValue({
        items: [searchAsset(a), searchAsset(b), searchAsset(c)],
        hasNextPage: false,
      });
    });

    it('should add the photos that match already to the album, and record what it added', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(
        stored([
          { method: RuleMethod.TagPath, config: { tag: 'Food' } },
          { method: RuleMethod.AddToAlbums, config: { albumIds: [albumId], albumName: 'Italian food' } },
        ]) as never,
      );
      vi.spyOn(AlbumService.prototype, 'get').mockResolvedValue({ id: albumId, albumName: 'Italian food' } as never);
      const addAssets = vi.spyOn(AlbumService.prototype, 'addAssets').mockResolvedValue([
        { id: a, success: true },
        { id: b, success: false, error: 'duplicate' },
        { id: c, success: true },
      ] as never);

      const result = parse(await call('apply_workflow', { workflowId }));

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        { page: 1, size: 5000 },
        expect.objectContaining({ userIds: [auth.user.id], tagIds: [foodTagId] }),
      );
      expect(addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [a, b, c] });
      expect(result).toEqual({
        workflowId,
        matched: 3,
        results: [{ albumId, album: 'Italian food', added: 2, failed: 0 }],
      });
      expect(recorded).toEqual([
        expect.objectContaining({
          action: ActivityLogAction.AlbumAddAssets,
          undo: { albumId, assetIds: [a, c] },
        }),
      ]);
    });

    it('should add to a space only the photos that are not in it, and to an album of a space', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(
        stored([
          { method: RuleMethod.Type, config: { allowedTypes: ['IMAGE'] } },
          { method: RuleMethod.AddToSpace, config: { spaceIds: [spaceId] } },
          { method: RuleMethod.AddToSpaceAlbum, config: { spaceId, albumName: 'Trips' } },
        ]) as never,
      );
      mocks.sharedSpace.getDirectAssetIds.mockResolvedValue([b]);
      const addToSpace = vi.spyOn(SharedSpaceService.prototype, 'addAssets').mockResolvedValue();
      const spaceAlbumId = factory.uuid();
      const resolveSpaceAlbum = vi
        .spyOn(GalleryWorkflowHostService.prototype, 'resolveSpaceAlbum')
        .mockResolvedValue(spaceAlbumId);
      vi.spyOn(AlbumService.prototype, 'addAssets').mockResolvedValue([{ id: a, success: true }] as never);

      const result = parse(await call('apply_workflow', { workflowId }));

      expect(resolveSpaceAlbum).toHaveBeenCalledWith(auth, spaceId, 'Trips');
      expect(addToSpace).toHaveBeenCalledWith(auth, spaceId, { assetIds: [a, c] });
      expect(result.results).toEqual([
        { albumId: spaceAlbumId, album: 'Trips', added: 1, failed: 0 },
        { spaceId, space: 'Family', added: 2, alreadyIn: 1 },
      ]);
      expect(recorded.map(({ action, undo }) => ({ action, undo }))).toEqual([
        { action: ActivityLogAction.AlbumAddAssets, undo: { albumId: spaceAlbumId, assetIds: [a] } },
        { action: ActivityLogAction.SpaceAddAssets, undo: { spaceId, assetIds: [a, c] } },
      ]);
    });

    it('should refuse a workflow that changes photos, which it does to new photos only', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(
        stored([
          { method: RuleMethod.FileName, config: { pattern: 'screenshot' } },
          { method: RuleMethod.Archive, config: { inverse: false } },
        ]) as never,
      );
      const addAssets = vi.spyOn(AlbumService.prototype, 'addAssets');

      expect(errorText(await call('apply_workflow', { workflowId }))).toMatch(/changes photos \(archive\)/);
      expect(addAssets).not.toHaveBeenCalled();
    });

    it('should refuse a workflow with a filter it cannot check', async () => {
      vi.spyOn(WorkflowService.prototype, 'get').mockResolvedValue(
        stored([
          { method: RuleMethod.FileName, config: { pattern: 'x', usePath: true } },
          { method: RuleMethod.AddToAlbums, config: { albumIds: [albumId] } },
        ]) as never,
      );

      expect(errorText(await call('apply_workflow', { workflowId }))).toMatch(/Filter by filename/);
    });
  });
});

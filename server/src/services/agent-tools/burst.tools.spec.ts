import { AuthDto } from 'src/dtos/auth.dto.js';
import { BurstGroupResponseDto } from 'src/dtos/burst.dto.js';
import { BurstGroupSource, BurstKeepReason } from 'src/enum.js';
import { BurstAgentTools } from 'src/services/agent-tools/burst.tools.js';
import { BurstService } from 'src/services/burst.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { factory } from 'test/small.factory.js';
import { newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

const photo = (assetId: string, isOwned = true) => ({
  assetId,
  isOwned,
  isRaw: false,
  isEdited: false,
  width: 4000,
  height: 3000,
  fileSize: 3_000_000,
  sharpness: 0.5,
  exposure: 0.5,
  faces: 0,
  score: 0.5,
});

const group = (ids: string[], readOnly = false): BurstGroupResponseDto => ({
  key: `burst:${ids[0]}`,
  source: BurstGroupSource.Burst,
  duplicateId: null,
  stackId: null,
  takenAt: new Date('2026-06-01T10:00:00.000Z'),
  assets: ids.map((id) => photo(id, !readOnly)),
  keepAssetId: ids[0],
  reasons: [BurstKeepReason.Sharpest],
  archiveAssetIds: readOnly ? [] : ids.slice(1),
  readOnly,
});

describe(BurstAgentTools.name, () => {
  let sut: BurstAgentTools;
  let auth: AuthDto;
  const [a, b, c, d] = [factory.uuid(), factory.uuid(), factory.uuid(), factory.uuid()];

  const call = (name: string, input: Record<string, unknown>, activity?: ActivityRecorder) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null, activity }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut } = newTestService(BurstAgentTools));
    auth = AuthFactory.create();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should find freely and clean up only with approval', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'find_bursts', mutating: false },
      { name: 'clean_up_bursts', mutating: true },
    ]);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/find_bursts/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/clean_up_bursts/);
  });

  it('should find the bursts of a date range, with what cleaning them up would archive', async () => {
    const find = vi.spyOn(BurstService.prototype, 'find').mockResolvedValue({
      groups: [group([a, b, c]), group([d, factory.uuid()], true)],
      total: 5,
      totalToArchive: 9,
      scanned: 120,
      truncated: false,
    });

    const result = parse(
      await call('find_bursts', {
        takenAfter: '2026-06-01',
        takenBefore: '2026-06-08',
        preferRaw: true,
        limit: 2,
      }),
    );

    expect(find).toHaveBeenCalledWith(auth, {
      albumId: undefined,
      takenAfter: new Date('2026-06-01'),
      takenBefore: new Date('2026-06-08'),
      rules: { preferRaw: true, preferEdited: undefined, preferLargest: undefined },
      limit: 2,
    });
    expect(result).toEqual({
      total: 5,
      shown: 2,
      wouldArchive: 9,
      scanned: 120,
      groups: [
        {
          key: `burst:${a}`,
          source: 'burst',
          takenAt: '2026-06-01T10:00:00.000Z',
          photos: 3,
          keepAssetId: a,
          reasons: ['sharpest'],
          archiveAssetIds: [b, c],
        },
        expect.objectContaining({ keepAssetId: d, readOnly: true }),
      ],
    });
  });

  it('should refuse an invalid date', async () => {
    const result = await call('find_bursts', { takenAfter: 'last summer' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Invalid date: last summer' });
  });

  it('should clean up every group of a scope it may, recorded for undo', async () => {
    vi.spyOn(BurstService.prototype, 'find').mockResolvedValue({
      groups: [group([a, b]), group([c, d], true)],
      total: 2,
      totalToArchive: 1,
      scanned: 4,
      truncated: false,
    });
    const clean = vi.spyOn(BurstService.prototype, 'clean').mockResolvedValue({
      dryRun: false,
      groups: [{ keepAssetId: a, archivedAssetIds: [b] }],
      archived: 1,
      activityId: null,
    });
    const activity = ActivityRecorder.assistant({
      sessionId: null,
      toolName: 'clean_up_bursts',
      groupId: factory.uuid(),
    });

    const result = parse(await call('clean_up_bursts', { albumId: factory.uuid() }, activity));

    expect(clean).toHaveBeenCalledWith(
      auth,
      { groups: [{ assetIds: [a, b], keepAssetId: a }], dryRun: undefined },
      activity,
    );
    expect(result).toEqual({ archived: 1, groups: 1, keptAssetIds: [a] });
  });

  it('should clean up the given groups, with the keeper the user picked', async () => {
    const find = vi.spyOn(BurstService.prototype, 'find');
    const clean = vi.spyOn(BurstService.prototype, 'clean').mockResolvedValue({
      dryRun: true,
      groups: [
        { keepAssetId: b, archivedAssetIds: [a] },
        { keepAssetId: c, archivedAssetIds: [], error: 'Some of the photos belong to someone else' },
      ],
      archived: 1,
      activityId: null,
    });

    const result = parse(
      await call('clean_up_bursts', {
        groups: [
          { assetIds: [a, b], keepAssetId: b },
          { assetIds: [c, d], keepAssetId: c },
        ],
        dryRun: true,
      }),
    );

    expect(find).not.toHaveBeenCalled();
    expect(clean).toHaveBeenCalledWith(
      auth,
      {
        groups: [
          { assetIds: [a, b], keepAssetId: b },
          { assetIds: [c, d], keepAssetId: c },
        ],
        dryRun: true,
      },
      undefined,
    );
    expect(result).toEqual({
      dryRun: true,
      archived: 1,
      groups: 1,
      keptAssetIds: [b],
      skipped: [{ keepAssetId: c, reason: 'Some of the photos belong to someone else' }],
    });
  });

  it('should need the photo to keep to be in its group', async () => {
    const clean = vi.spyOn(BurstService.prototype, 'clean');
    const result = await call('clean_up_bursts', { groups: [{ assetIds: [a, b], keepAssetId: c }] });
    expect(result.isError).toBe(true);
    expect(clean).not.toHaveBeenCalled();
  });

  it('should say when there is nothing to clean up', async () => {
    vi.spyOn(BurstService.prototype, 'find').mockResolvedValue({
      groups: [group([c, d], true)],
      total: 1,
      totalToArchive: 0,
      scanned: 2,
      truncated: false,
    });
    const clean = vi.spyOn(BurstService.prototype, 'clean');

    expect(parse(await call('clean_up_bursts', {}))).toEqual({
      archived: 0,
      groups: 0,
      message: 'No bursts to clean up in this scope',
    });
    expect(clean).not.toHaveBeenCalled();
  });
});

import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetType, MemoryType } from 'src/enum.js';
import { MemoryAgentTools } from 'src/services/agent-tools/memory.tools.js';
import { MemorySourceService } from 'src/services/memory-source.service.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { getMemorySource } from 'src/utils/memory-source.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

const trip = (id: string, place: string, start: string, end: string) => ({
  id,
  type: MemoryType.Rule,
  data: {
    ruleId: 'recent_trip',
    context: { placeLabel: place, tripWindowStart: start, tripWindowEnd: end },
  },
  memoryAt: new Date('2026-09-28T00:00:00.000Z'),
  isSaved: false,
  assets: [{ id: `${id}-photo` }],
});

describe(MemoryAgentTools.name, () => {
  let sut: MemoryAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(MemoryAgentTools));
    auth = AuthFactory.create();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should only read memories', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'list_memories', mutating: false },
      { name: 'get_memory', mutating: false },
    ]);
  });

  it('should tell the assistant to make a video of the last trip from its memory', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/list_memories/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/memoryId to make_highlight_video, auto_layout_book or make_collage/);
  });

  it('should list the user’s memories, the newest moment first, with their windows', async () => {
    mocks.memory.search.mockResolvedValue([
      trip('older', 'Rome, Italy', '2026-06-01T10:00:00.000Z', '2026-06-04T10:00:00.000Z'),
      {
        id: 'month',
        type: MemoryType.Rule,
        data: { ruleId: 'month_recap', context: { year: 2025, month: 10 } },
        memoryAt: new Date('2025-10-01T00:00:00.000Z'),
        isSaved: true,
        assets: [],
      },
      trip('last', 'Athens, Greece', '2026-09-12T10:00:00.000Z', '2026-09-19T10:00:00.000Z'),
    ] as any);

    const all = parse(await call('list_memories', {}));
    expect(mocks.memory.search).toHaveBeenCalledWith(auth.user.id, { size: 200 });
    expect(all.memories.map(({ memoryId }: { memoryId: string }) => memoryId)).toEqual(['last', 'older', 'month']);
    expect(all.memories[0]).toEqual({
      memoryId: 'last',
      type: 'recent_trip',
      kind: 'trip',
      title: 'Recent trip to Athens, Greece',
      from: '2026-09-12',
      to: '2026-09-19',
      dates: '12–19 September 2026',
      photoCount: 1,
      memoryAt: '2026-09-28',
    });
    expect(all.memories[2]).toMatchObject({ kind: 'period', title: 'October 2025', saved: true });

    const trips = parse(await call('list_memories', { kind: 'trip', limit: 1 }));
    expect(trips.memories.map(({ memoryId }: { memoryId: string }) => memoryId)).toEqual(['last']);
  });

  it('should say when there is no memory of a kind', async () => {
    mocks.memory.search.mockResolvedValue([]);
    const result = parse(await call('list_memories', { kind: 'birthday' }));
    expect(result).toEqual({ memories: [], note: expect.stringContaining('No memories of kind birthday') });
  });

  it('should tell how many photos and videos the window of a memory holds', async () => {
    const memory = trip('last', 'Athens, Greece', '2026-09-12T10:00:00.000Z', '2026-09-19T10:00:00.000Z');
    vi.spyOn(MemorySourceService.prototype, 'resolve').mockResolvedValue({
      source: getMemorySource({ ...memory, assetIds: ['last-photo'] }),
      memory: { memoryAt: memory.memoryAt, isSaved: false },
      assets: [
        { id: 'a', type: AssetType.Image, time: 1 },
        { id: 'b', type: AssetType.Image, time: 2 },
        { id: 'c', type: AssetType.Video, time: 3 },
      ],
    });

    const result = parse(await call('get_memory', { memoryId: 'last' }));

    expect(result).toMatchObject({
      memoryId: 'last',
      kind: 'trip',
      from: '2026-09-12',
      to: '2026-09-19',
      windowPhotoCount: 2,
      windowVideoCount: 1,
      cardAssetIds: ['last-photo'],
    });
  });

  it('should refuse a memory of someone else', async () => {
    mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set());
    const result = await call('get_memory', { memoryId: 'not-mine' });
    expect(result.isError).toBe(true);
    expect(mocks.memory.get).not.toHaveBeenCalled();
  });
});

import { BadRequestException } from '@nestjs/common';
import { AssetType, MemoryType } from 'src/enum.js';
import { MemorySourceService } from 'src/services/memory-source.service.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(MemorySourceService.name, () => {
  let sut: MemorySourceService;
  let mocks: ServiceMocks;
  const auth = authStub.admin;
  const memoryId = newUuid();

  const tripMemory = (assets: Array<{ id: string; type?: AssetType; localDateTime: string }>) =>
    ({
      id: memoryId,
      ownerId: auth.user.id,
      type: MemoryType.Rule,
      data: {
        ruleId: 'recent_trip',
        dedupeKey: 'recent_trip:gr|athens:2026-09-28',
        context: {
          placeLabel: 'Athens, Greece',
          tripWindowStart: '2026-09-12T08:00:00.000Z',
          tripWindowEnd: '2026-09-14T20:00:00.000Z',
        },
      },
      memoryAt: new Date('2026-09-28T00:00:00.000Z'),
      isSaved: false,
      assets: assets.map(({ type = AssetType.Image, ...asset }) => ({ ...asset, type })),
    }) as any;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(MemorySourceService));
  });

  it('should require the memory to be the user’s', async () => {
    mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set());

    await expect(sut.resolve(auth, memoryId)).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.memory.get).not.toHaveBeenCalled();
    expect(mocks.bookDraft.getWindowAssets).not.toHaveBeenCalled();
  });

  it('should give every photo and video of the trip window, with the memory’s own photos', async () => {
    mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memoryId]));
    mocks.access.asset.checkOwnerAccess.mockImplementation((_, ids) => Promise.resolve(new Set(ids)));
    mocks.memory.get.mockResolvedValue(
      tripMemory([
        { id: 'curated-1', localDateTime: '2026-09-12T10:00:00.000Z' },
        { id: 'outside', localDateTime: '2026-09-20T10:00:00.000Z' },
      ]),
    );
    mocks.bookDraft.getWindowAssets.mockResolvedValue([
      { id: 'curated-1', type: AssetType.Image, time: Date.parse('2026-09-12T10:00:00.000Z') },
      { id: 'first-day', type: AssetType.Image, time: Date.parse('2026-09-12T06:00:00.000Z') },
      { id: 'clip', type: AssetType.Video, time: Date.parse('2026-09-13T12:00:00.000Z') },
      { id: 'last-day', type: AssetType.Image, time: Date.parse('2026-09-14T23:00:00.000Z') },
    ]);

    const { source, assets, memory } = await sut.resolve(auth, memoryId);

    expect(mocks.bookDraft.getWindowAssets).toHaveBeenCalledWith(auth.user.id, {
      from: new Date('2026-09-12T00:00:00.000Z'),
      to: new Date('2026-09-14T23:59:59.999Z'),
      personIds: [],
      favoritesOnly: false,
      videosOnly: false,
      exclusions: { personIds: [], dateRanges: [], albumIds: [], documents: false },
    });
    expect(source).toMatchObject({ kind: 'trip', title: 'Recent trip to Athens, Greece' });
    expect(memory).toEqual({ memoryAt: new Date('2026-09-28T00:00:00.000Z'), isSaved: false });
    expect(assets.map(({ id }) => id)).toEqual(['first-day', 'curated-1', 'clip', 'last-day', 'outside']);
  });

  it('should leave out a photo of the memory the user can no longer read', async () => {
    mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memoryId]));
    mocks.memory.get.mockResolvedValue(tripMemory([{ id: 'shared-photo', localDateTime: '2026-09-12T10:00:00.000Z' }]));
    mocks.bookDraft.getWindowAssets.mockResolvedValue([]);

    const { assets } = await sut.resolve(auth, memoryId);

    expect(assets).toEqual([]);
  });

  it('should give a memory without a window its own photos', async () => {
    mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memoryId]));
    mocks.access.asset.checkOwnerAccess.mockImplementation((_, ids) => Promise.resolve(new Set(ids)));
    mocks.memory.get.mockResolvedValue({
      ...tripMemory([
        { id: 'sunset-1', localDateTime: '2024-06-01T20:00:00.000Z' },
        { id: 'sunset-2', localDateTime: '2023-06-01T20:00:00.000Z' },
      ]),
      data: { ruleId: 'themed', context: { theme: 'sunset', year: 2024 } },
    });

    const { source, assets } = await sut.resolve(auth, memoryId);

    expect(source.kind).toBe('curated');
    expect(mocks.bookDraft.getWindowAssets).not.toHaveBeenCalled();
    expect(assets.map(({ id }) => id)).toEqual(['sunset-2', 'sunset-1']);
  });
});

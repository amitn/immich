import { BadRequestException } from '@nestjs/common';
import { ActivityLogAction, MemoryExclusionType, UserMetadataKey } from 'src/enum.js';
import { MemoryExclusionService, toMemoryExclusions } from 'src/services/memory-exclusion.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { factory, newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  type: MemoryExclusionType.Person,
  personGroupId: null as string | null,
  albumId: null as string | null,
  startDate: null as string | null,
  endDate: null as string | null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  personName: null as string | null,
  personType: null as string | null,
  albumName: null as string | null,
  ...overrides,
});

const preferences = (value: Record<string, unknown>) => [{ key: UserMetadataKey.Preferences, value }] as never;

describe(MemoryExclusionService.name, () => {
  let sut: MemoryExclusionService;
  let mocks: ServiceMocks;
  const auth = factory.auth();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(MemoryExclusionService));
    mocks.user.getMetadata.mockResolvedValue([]);
    mocks.memoryExclusion.create.mockImplementation(() => Promise.resolve({ id: newUuid() }));
    mocks.memoryExclusion.delete.mockResolvedValue([]);
    mocks.activityLog.create.mockResolvedValue({ id: newUuid() } as never);
  });

  describe('toMemoryExclusions', () => {
    it('reads each kind of exclusion, and the documents switch', () => {
      expect(
        toMemoryExclusions(
          [
            row({ type: MemoryExclusionType.Person, personGroupId: 'p1' }),
            row({ type: MemoryExclusionType.Album, albumId: 'a1' }),
            row({ type: MemoryExclusionType.DateRange, startDate: '2026-03-01', endDate: '2026-03-14' }),
          ],
          preferences({ memoryExclusions: { documents: true } }),
        ),
      ).toEqual({
        personIds: ['p1'],
        albumIds: ['a1'],
        dateRanges: [{ from: '2026-03-01', to: '2026-03-14' }],
        documents: true,
      });
    });

    it('leaves documents in by default', () => {
      expect(toMemoryExclusions([], [])).toEqual({ personIds: [], albumIds: [], dateRanges: [], documents: false });
    });
  });

  describe('getAll', () => {
    it('lists the exclusions with their names', async () => {
      mocks.memoryExclusion.getAll.mockResolvedValue([
        row({ id: 'e1', personGroupId: 'p1', personName: 'Rex', personType: 'pet' }),
        row({ id: 'e2', type: MemoryExclusionType.Album, albumId: 'a1', albumName: 'Work' }),
      ] as never);
      mocks.user.getMetadata.mockResolvedValue(preferences({ memoryExclusions: { documents: true } }));

      await expect(sut.getAll(auth)).resolves.toEqual({
        exclusions: [
          {
            id: 'e1',
            type: MemoryExclusionType.Person,
            person: { id: 'p1', name: 'Rex', isPet: true },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'e2',
            type: MemoryExclusionType.Album,
            album: { id: 'a1', albumName: 'Work' },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        documents: true,
      });
    });
  });

  describe('create', () => {
    it('leaves one of the user’s people out, and records the change', async () => {
      const personId = newUuid();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
      mocks.memoryExclusion.getAll
        .mockResolvedValueOnce([])
        .mockResolvedValue([row({ id: 'new', personGroupId: personId, personName: 'Dana' })] as never);
      mocks.memoryExclusion.create.mockResolvedValue({ id: 'new' });

      const result = await sut.create(
        auth,
        { type: MemoryExclusionType.Person, personId },
        ActivityRecorder.web('6f9e5a3c-6c5e-4f7b-8f1e-2a3b4c5d6e7f'),
      );

      expect(result).toMatchObject({ id: 'new', person: { id: personId, name: 'Dana', isPet: false } });
      expect(mocks.memoryExclusion.create).toHaveBeenCalledWith({
        ownerId: auth.user.id,
        type: MemoryExclusionType.Person,
        personGroupId: personId,
        albumId: null,
        startDate: null,
        endDate: null,
      });
      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ActivityLogAction.MemoryExclusionChange,
          summary: 'Memories: left “Dana” out',
          undo: { addedIds: ['new'], removed: [] },
        }),
      );
    });

    it('refuses someone else’s person', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.memoryExclusion.getAll.mockResolvedValue([]);

      await expect(sut.create(auth, { type: MemoryExclusionType.Person, personId: newUuid() })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.memoryExclusion.create).not.toHaveBeenCalled();
    });

    it('needs access to an album', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
      mocks.memoryExclusion.getAll.mockResolvedValue([]);

      await expect(sut.create(auth, { type: MemoryExclusionType.Album, albumId: newUuid() })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.memoryExclusion.create).not.toHaveBeenCalled();
    });

    it('returns the exclusion already there, without recording a change', async () => {
      const existing = row({ type: MemoryExclusionType.DateRange, startDate: '2026-03-01', endDate: '2026-03-14' });
      mocks.memoryExclusion.getAll.mockResolvedValue([existing] as never);

      const result = await sut.create(
        auth,
        { type: MemoryExclusionType.DateRange, startDate: '2026-03-01', endDate: '2026-03-14' },
        ActivityRecorder.web(),
      );

      expect(result.id).toBe(existing.id);
      expect(mocks.memoryExclusion.create).not.toHaveBeenCalled();
      expect(mocks.activityLog.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lets the photos back in', async () => {
      const existing = row({ type: MemoryExclusionType.Album, albumId: 'a1', albumName: 'Work' });
      mocks.memoryExclusion.getAll
        .mockResolvedValueOnce([existing] as never)
        .mockResolvedValueOnce([existing] as never);
      mocks.memoryExclusion.getAll.mockResolvedValue([]);
      mocks.memoryExclusion.delete.mockResolvedValue([existing] as never);

      await sut.remove(auth, existing.id, ActivityRecorder.web());

      expect(mocks.memoryExclusion.delete).toHaveBeenCalledWith(auth.user.id, [existing.id]);
      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: 'Memories: let the album “Work” back',
          undo: {
            addedIds: [],
            removed: [
              { type: MemoryExclusionType.Album, personGroupId: null, albumId: 'a1', startDate: null, endDate: null },
            ],
          },
        }),
      );
    });

    it('refuses an exclusion of someone else', async () => {
      mocks.memoryExclusion.getAll.mockResolvedValue([]);

      await expect(sut.remove(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.memoryExclusion.delete).not.toHaveBeenCalled();
    });
  });

  describe('change', () => {
    it('switches the documents off, and remembers the switch for the undo', async () => {
      mocks.memoryExclusion.getAll.mockResolvedValue([]);

      await sut.change(auth, { documents: true }, ActivityRecorder.web());

      expect(mocks.user.upsertMetadata).toHaveBeenCalledWith(auth.user.id, {
        key: UserMetadataKey.Preferences,
        value: { memoryExclusions: { documents: true } },
      });
      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: 'Memories: left screenshots, receipts and documents out',
          undo: { addedIds: [], removed: [], previousDocuments: false },
        }),
      );
    });

    it('refuses an unknown exclusion before changing anything', async () => {
      mocks.memoryExclusion.getAll.mockResolvedValue([]);

      await expect(
        sut.change(auth, {
          add: [{ type: MemoryExclusionType.DateRange, startDate: '2026-01-01', endDate: '2026-01-02' }],
          removeIds: [newUuid()],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.memoryExclusion.create).not.toHaveBeenCalled();
    });
  });

  describe('revert', () => {
    it('puts the exclusions back as they were', async () => {
      await sut.revert(auth.user.id, {
        addedIds: ['added'],
        removed: [
          { type: MemoryExclusionType.Person, personGroupId: 'p1', albumId: null, startDate: null, endDate: null },
        ],
        previousDocuments: false,
      });

      expect(mocks.memoryExclusion.delete).toHaveBeenCalledWith(auth.user.id, ['added']);
      expect(mocks.memoryExclusion.create).toHaveBeenCalledWith({
        ownerId: auth.user.id,
        type: MemoryExclusionType.Person,
        personGroupId: 'p1',
        albumId: null,
        startDate: null,
        endDate: null,
      });
      expect(mocks.user.upsertMetadata).toHaveBeenCalledWith(auth.user.id, {
        key: UserMetadataKey.Preferences,
        value: {},
      });
    });
  });
});

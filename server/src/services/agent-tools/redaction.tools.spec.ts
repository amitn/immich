import { AuthDto } from 'src/dtos/auth.dto.js';
import { ActivityLogAction, AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { RedactionAgentTools } from 'src/services/agent-tools/redaction.tools.js';
import { AlbumService } from 'src/services/album.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { RedactionService } from 'src/services/redaction.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { RedactionRegion } from 'src/utils/redaction.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

const asset = (id: string, type = AssetType.Image) =>
  ({
    id,
    ownerId: 'owner',
    type,
    isEdited: false,
    deletedAt: null,
    visibility: AssetVisibility.Timeline,
    originalPath: `/data/${id}.jpg`,
    originalFileName: `${id}.jpg`,
    livePhotoVideoId: null,
    exifImageWidth: 1000,
    exifImageHeight: 500,
    orientation: null,
    colorspace: null,
    profileDescription: null,
    bitsPerSample: null,
    projectionType: null,
    edits: [],
    files: [{ type: AssetFileType.Preview, path: `/data/${id}-preview.jpg`, isEdited: false }],
  }) as Awaited<ReturnType<RedactionService['getAssets']>>[number];

const faceRegion = (personId: string, selected: boolean): RedactionRegion => ({
  id: `face:${personId}`,
  kind: 'face',
  reason: selected ? 'person' : 'notChosen',
  selected,
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.2,
  personId,
  personName: personId,
});

describe(RedactionAgentTools.name, () => {
  let sut: RedactionAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;
  const [kid, other, a, b, c] = [factory.uuid(), factory.uuid(), factory.uuid(), factory.uuid(), factory.uuid()];

  const call = (name: string, input: Record<string, unknown>, activity?: ActivityRecorder) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null, activity }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(RedactionAgentTools));
    auth = AuthFactory.create();
    mocks.access.asset.checkOwnerAccess.mockImplementation((_, ids) =>
      Promise.resolve(new Set([...ids].filter((id) => id !== c))),
    );
    mocks.access.album.checkOwnerAccess.mockImplementation((_, ids) => Promise.resolve(new Set(ids)));
    // c is a partner's photo: readable, not the user's to copy
    mocks.access.asset.checkPartnerAccess.mockImplementation((_, ids) =>
      Promise.resolve(new Set([...ids].filter((id) => id === c))),
    );
    mocks.activityLog.create.mockResolvedValue({ id: 'entry' } as any);
    mocks.activityLog.getAlbumState.mockResolvedValue({ albumName: 'Summer' } as any);
    vi.spyOn(CollectionService.prototype, 'getPrivateSourceIds').mockResolvedValue(new Set());
    vi.spyOn(RedactionService.prototype, 'getAssets').mockImplementation((ids) =>
      Promise.resolve(ids.map((id) => asset(id))),
    );
    // a and c show the kid and someone else, b nobody
    vi.spyOn(RedactionService.prototype, 'getSuggestions').mockImplementation((photo, options) => {
      const only = options?.onlyPersonIds;
      const regions =
        photo.id === b
          ? []
          : [faceRegion(kid, !only || only.includes(kid)), faceRegion(other, !only || only.includes(other))];
      return Promise.resolve({ regions, scene: null, hasFaces: regions.length > 0, hasText: false });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should suggest freely and redact only with approval', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'suggest_redactions', mutating: false },
      { name: 'redact_photos', mutating: true },
    ]);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/suggest_redactions/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/redact_photos/);
  });

  describe('suggest_redactions', () => {
    it('should say what would be blurred, without the text', async () => {
      const result = parse(await call('suggest_redactions', { ids: [a, b, c], onlyPersonIds: [kid] }));
      expect(result.photos).toEqual([
        {
          id: a,
          blur: '1 face',
          faces: [
            { personId: kid, name: kid, blurred: true, reason: 'person' },
            { personId: other, name: other, blurred: false, reason: 'notChosen' },
          ],
        },
        expect.objectContaining({ id: c }),
      ]);
      expect(result).toMatchObject({ nothingToBlur: [b], notOwned: [c] });
    });

    it('should show previews, but never of a private source', async () => {
      vi.spyOn(CollectionService.prototype, 'getPrivateSourceIds').mockResolvedValue(new Set([c]));
      const result = await call('suggest_redactions', { ids: [a, c], preview: true });
      expect(result.content.filter(({ type }) => type === 'image')).toHaveLength(1);
      expect(mocks.media.redactImage).toHaveBeenCalledTimes(1);
    });
  });

  describe('redact_photos', () => {
    it("should blur the kids' faces in copies that replace the originals in the album, undoably", async () => {
      const albumId = factory.uuid();
      mocks.assetJob.getForAgentEvents.mockResolvedValue([{ id: a }, { id: b }, { id: c }] as any);
      const create = vi
        .spyOn(RedactionService.prototype, 'createRedactedCopy')
        .mockImplementation((_, id) =>
          Promise.resolve({ id: `copy-${id}`, sourceId: id, regionCount: 1, description: '1 face', duplicate: false }),
        );
      const addAssets = vi
        .spyOn(AlbumService.prototype, 'addAssets')
        .mockResolvedValue([{ id: `copy-${a}`, success: true }]);
      const removeAssets = vi
        .spyOn(AlbumService.prototype, 'removeAssets')
        .mockResolvedValue([{ id: a, success: true }]);
      const activity = ActivityRecorder.assistant({ sessionId: null, toolName: 'redact_photos', groupId: 'turn' });

      const result = parse(
        await call('redact_photos', { albumId, onlyPersonIds: [kid], replaceInAlbum: true }, activity),
      );

      // only the kid's face of the user's own photo with something to blur
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(auth, a, {
        regions: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2, kind: 'face' }],
        style: undefined,
      });
      expect(result).toMatchObject({
        redacted: [{ sourceId: a, id: `copy-${a}`, blurred: '1 face' }],
        skipped: [{ id: c, reason: expect.stringContaining('not your photo') }],
        album: { albumId, added: 1, removed: 1 },
        copies: { [a]: `copy-${a}` },
      });
      expect(addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [`copy-${a}`] });
      expect(removeAssets).toHaveBeenCalledWith(auth, albumId, { ids: [a] });
      expect(mocks.activityLog.create.mock.calls.map(([entry]) => [entry.action, entry.undo])).toEqual([
        [ActivityLogAction.AssetCopy, { copies: [{ id: `copy-${a}`, sourceId: a }] }],
        [ActivityLogAction.AlbumAddAssets, { albumId, assetIds: [`copy-${a}`] }],
        [ActivityLogAction.AlbumRemoveAssets, { albumId, assetIds: [a] }],
      ]);
    });

    it('should skip the photos with nothing to blur, and refuse bad input', async () => {
      const result = await call('redact_photos', { ids: [b] });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('nothing to blur');

      await expect(
        call('redact_photos', { ids: [a], onlyPersonIds: [kid], keepPersonIds: [other] }),
      ).resolves.toMatchObject({
        isError: true,
      });
      await expect(call('redact_photos', { ids: [a], replaceInAlbum: true })).resolves.toMatchObject({ isError: true });
    });
  });
});

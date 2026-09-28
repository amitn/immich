import { BadRequestException } from '@nestjs/common';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto.js';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { JobName, JobStatus, OrientationStatus, SystemMetadataKey } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { OrientationService, clearOrientationPrompts } from 'src/services/orientation.service.js';
import { ORIENTATION_PROMPTS } from 'src/utils/orientation.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** 4-dimensional embeddings: the upright, sideways and upside-down prompts, and anything else */
const axis = (index: number) => [0, 1, 2, 3].map((i) => (i === index ? 1 : 0));
const look = (index: number) => JSON.stringify(axis(index).map((value, i) => (i === 3 ? 1 : value * 0.5)));
/** the looks of the views of an upright photo turned by 0, 90, 180 and 270 */
const LOOKS = [0, 1, 2, 1];

const promptVector = (text: string) =>
  JSON.stringify(
    axis(
      (ORIENTATION_PROMPTS.upright as readonly string[]).includes(text)
        ? 0
        : (ORIENTATION_PROMPTS.sideways as readonly string[]).includes(text)
          ? 1
          : 2,
    ),
  );

/** a photo stored turned by `stored` from upright */
const candidate = (stored = 90, overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  width: 960,
  height: 1440,
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  fileCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
  embedding: look(LOOKS[stored / 90]),
  ocrAt: null,
  facesRecognizedAt: null,
  previewPath: '/data/thumbs/preview.jpeg',
  stored,
  ...overrides,
});

describe(OrientationService.name, () => {
  let sut: OrientationService;
  let mocks: ServiceMocks;
  const auth = authStub.admin;

  const setup = (stored: number) => {
    mocks.media.turnToJpeg.mockImplementation((_, angle) => Promise.resolve(Buffer.from(String(angle))));
    mocks.machineLearning.encodeImage.mockImplementation((image) =>
      Promise.resolve(look(LOOKS[((stored + Number((image as Buffer).toString())) / 90) % 4])),
    );
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(OrientationService));
    clearOrientationPrompts();
    mocks.machineLearning.encodeText.mockImplementation((text) => Promise.resolve(promptVector(text)));
    mocks.machineLearning.detectFaces.mockResolvedValue({ imageWidth: 100, imageHeight: 100, faces: [] });
    mocks.machineLearning.ocr.mockResolvedValue({ text: [], box: [], boxScore: [], textScore: [] });
    mocks.book.getFaces.mockResolvedValue([]);
    mocks.ocr.getByAssetId.mockResolvedValue([]);
    mocks.user.getList.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }] as never);
  });

  describe('handleQueueAll', () => {
    it('should check the photos of every user', async () => {
      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Success);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.OrientationCheck, data: { userId: 'user-1', nightly: true } },
        { name: JobName.OrientationCheck, data: { userId: 'user-2', nightly: true } },
      ]);
    });

    it('should skip without smart search', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { clip: { enabled: false } } });
      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('handleCheck', () => {
    it('should suggest turning a sideways upload of the last night, and move the cursor', async () => {
      const asset = candidate(90);
      setup(90);
      mocks.systemMetadata.get.mockImplementation((key) =>
        Promise.resolve(
          key === SystemMetadataKey.OrientationCheckState
            ? { users: { [auth.user.id]: '2026-08-31T00:00:00.000Z' } }
            : {},
        ),
      );
      mocks.asset.getForOrientationCheck.mockResolvedValue([asset] as never);

      await expect(sut.handleCheck({ userId: auth.user.id, nightly: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.asset.getForOrientationCheck).toHaveBeenCalledWith(auth.user.id, {
        key: 'immich.orientation',
        limit: 500,
        createdAfter: new Date('2026-08-31T00:00:00.000Z'),
      });
      // the stored view is the stored embedding; the other three views are encoded
      expect(mocks.machineLearning.encodeImage).toHaveBeenCalledTimes(3);
      expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(asset.id, [
        {
          key: 'immich.orientation',
          value: expect.objectContaining({ status: OrientationStatus.Suggested, rotate: 270 }),
        },
      ]);
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.OrientationCheckState, {
        users: { [auth.user.id]: asset.createdAt.toISOString() },
      });
    });

    it('should start with the uploads of the last 30 days', async () => {
      mocks.systemMetadata.get.mockResolvedValue({});
      mocks.asset.getForOrientationCheck.mockResolvedValue([]);
      await sut.handleCheck({ userId: auth.user.id, nightly: true });
      const { createdAfter } = mocks.asset.getForOrientationCheck.mock.calls[0][1];
      expect(Date.now() - createdAfter!.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -5);
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('should leave upright photos without a trace', async () => {
      setup(0);
      mocks.asset.getForOrientationCheck.mockResolvedValue([candidate(0)] as never);
      await sut.handleCheck({ userId: auth.user.id, albumId: 'album-id' });
      expect(mocks.asset.getForOrientationCheck).toHaveBeenCalledWith(auth.user.id, {
        key: 'immich.orientation',
        limit: 200,
        albumId: 'album-id',
        takenAfter: undefined,
        takenBefore: undefined,
      });
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
      // CLIP sees the stored view upright: nothing more is asked
      expect(mocks.machineLearning.encodeImage).not.toHaveBeenCalled();
    });

    it('should page through a scope by the capture time', async () => {
      setup(0);
      const page = Array.from({ length: 200 }, () => candidate(0));
      mocks.asset.getForOrientationCheck.mockResolvedValueOnce(page as never).mockResolvedValueOnce([]);
      await sut.handleCheck({ userId: auth.user.id, takenAfter: '2026-01-01T00:00:00.000Z' });
      expect(mocks.asset.getForOrientationCheck).toHaveBeenCalledTimes(2);
      expect(mocks.asset.getForOrientationCheck.mock.calls[1][1]).toMatchObject({
        takenAfter: new Date('2026-01-01T00:00:00.000Z'),
        takenBefore: page[199].fileCreatedAt,
      });
    });

    it('should read the stored faces and text, and check them in the turned view', async () => {
      const asset = candidate(90, { ocrAt: new Date(), facesRecognizedAt: new Date() });
      setup(90);
      mocks.asset.getForOrientationCheck.mockResolvedValue([asset] as never);
      mocks.machineLearning.detectFaces.mockResolvedValue({
        imageWidth: 1440,
        imageHeight: 960,
        faces: [{ boundingBox: { x1: 600, y1: 200, x2: 700, y2: 350 }, score: 0.9, embedding: '[]' }],
      });

      await sut.handleCheck({ userId: auth.user.id });

      expect(mocks.book.getFaces).toHaveBeenCalledWith([asset.id]);
      expect(mocks.ocr.getByAssetId).toHaveBeenCalledWith(asset.id);
      expect(mocks.machineLearning.detectFaces).toHaveBeenCalledWith(Buffer.from('270'), expect.anything());
      expect(mocks.machineLearning.ocr).toHaveBeenCalledWith(Buffer.from('270'), expect.anything());
      expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(asset.id, [
        {
          key: 'immich.orientation',
          value: expect.objectContaining({ reasons: expect.arrayContaining(['faces: upright when turned']) }),
        },
      ]);
    });

    it('should go on when a photo cannot be checked', async () => {
      mocks.asset.getForOrientationCheck.mockResolvedValue([candidate(90), candidate(90)] as never);
      mocks.media.turnToJpeg.mockRejectedValue(new Error('broken preview'));
      await expect(sut.handleCheck({ userId: auth.user.id })).resolves.toBe(JobStatus.Success);
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });
  });

  describe('scan', () => {
    it('should check a scope in the background', async () => {
      await sut.scan(auth, { takenAfter: new Date('2025-01-01T00:00:00.000Z') });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.OrientationCheck,
        data: {
          userId: auth.user.id,
          albumId: undefined,
          takenAfter: '2025-01-01T00:00:00.000Z',
          takenBefore: undefined,
        },
      });
    });

    it('should require access to the album', async () => {
      await expect(sut.scan(auth, { albumId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should require smart search', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { enabled: false } });
      await expect(sut.scan(auth, {})).rejects.toThrow('Smart search');
    });
  });

  describe('find', () => {
    it('should check photos now and store nothing', async () => {
      const asset = candidate(180);
      setup(180);
      mocks.asset.getForOrientationCheck.mockResolvedValue([asset] as never);
      await expect(sut.find(auth, { assetIds: [asset.id] })).resolves.toEqual([
        { assetId: asset.id, rotate: 180, confidence: expect.any(Number), reasons: expect.any(Array) },
      ]);
      expect(mocks.asset.getForOrientationCheck).toHaveBeenCalledWith(auth.user.id, {
        assetIds: [asset.id],
        limit: 100,
      });
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });
  });

  describe('getSuggestions', () => {
    it('should list the suggestions of a status', async () => {
      const value = {
        status: 'suggested',
        rotate: 90,
        confidence: 0.91234,
        reasons: ['CLIP'],
        checkedAt: '2026-09-01',
      };
      mocks.asset.getMetadataByKeyForUser.mockResolvedValue([
        { assetId: 'a', value, updatedAt: new Date() },
        { assetId: 'b', value: { ...value, status: 'rejected' }, updatedAt: new Date() },
      ] as never);

      await expect(sut.getSuggestions(auth)).resolves.toEqual([
        {
          assetId: 'a',
          status: OrientationStatus.Suggested,
          rotate: 90,
          confidence: 0.912,
          reasons: ['CLIP'],
          checkedAt: new Date('2026-09-01'),
        },
      ]);
      await expect(sut.getSuggestions(auth, OrientationStatus.Rejected)).resolves.toHaveLength(1);
      expect(mocks.asset.getMetadataByKeyForUser).toHaveBeenCalledWith(auth.user.id, 'immich.orientation');
    });
  });

  describe('review', () => {
    const id = newUuid();
    const record = { status: 'suggested', rotate: 90, confidence: 0.9, reasons: ['CLIP'], checkedAt: '2026-09-01' };
    let editAsset: ReturnType<typeof vi.spyOn>;
    let removeAssetEdits: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([id]));
      mocks.asset.getMetadataByKey.mockResolvedValue({ key: 'immich.orientation', value: record } as never);
      mocks.assetEdit.getAll.mockResolvedValue([]);
      editAsset = vi.spyOn(AssetService.prototype, 'editAsset').mockResolvedValue({} as never);
      removeAssetEdits = vi.spyOn(AssetService.prototype, 'removeAssetEdits').mockResolvedValue();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should fix a photo with a rotate edit', async () => {
      await expect(sut.fix(auth, { assetIds: [id] })).resolves.toEqual([{ id, success: true }]);
      expect(editAsset).toHaveBeenCalledWith(auth, id, {
        edits: [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }],
      });
      expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(id, [
        {
          key: 'immich.orientation',
          value: expect.objectContaining({
            status: OrientationStatus.Fixed,
            rotate: 90,
            reviewedAt: expect.any(String),
          }),
        },
      ]);
    });

    it('should keep the other edits of the photo', async () => {
      const crop = { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 10, height: 10 } };
      mocks.assetEdit.getAll.mockResolvedValue([
        { id: 'edit-1', ...crop },
        { id: 'edit-2', action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ] as never);
      await sut.fix(auth, { assetIds: [id] });
      expect(editAsset).toHaveBeenCalledWith(auth, id, {
        edits: [crop, { action: AssetEditAction.Rotate, parameters: { angle: 180 } }],
      });
    });

    it('should turn a photo without a suggestion by the given turn', async () => {
      mocks.asset.getMetadataByKey.mockResolvedValue(undefined);
      await expect(sut.fix(auth, { assetIds: [id], rotate: 180 })).resolves.toEqual([{ id, success: true }]);
      expect(editAsset).toHaveBeenCalledWith(auth, id, {
        edits: [{ action: AssetEditAction.Rotate, parameters: { angle: 180 } }],
      });
    });

    it('should not fix a photo without a suggestion', async () => {
      mocks.asset.getMetadataByKey.mockResolvedValue(undefined);
      await expect(sut.fix(auth, { assetIds: [id] })).resolves.toEqual([
        { id, success: false, error: BulkIdErrorReason.VALIDATION, errorMessage: expect.stringContaining('Nothing') },
      ]);
      expect(editAsset).not.toHaveBeenCalled();
    });

    it('should report a photo that cannot be edited', async () => {
      editAsset.mockRejectedValue(new BadRequestException('Editing live photos is not supported'));
      await expect(sut.fix(auth, { assetIds: [id] })).resolves.toEqual([
        { id, success: false, error: BulkIdErrorReason.UNKNOWN, errorMessage: 'Editing live photos is not supported' },
      ]);
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });

    it('should require access to every photo', async () => {
      const other = newUuid();
      const results = await sut.fix(auth, { assetIds: [id, other] });
      expect(results[1]).toEqual({ id: other, success: false, error: BulkIdErrorReason.NO_PERMISSION });
    });

    it('should reject a suggestion', async () => {
      await expect(sut.reject(auth, [id])).resolves.toEqual([{ id, success: true }]);
      expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(id, [
        { key: 'immich.orientation', value: expect.objectContaining({ status: OrientationStatus.Rejected }) },
      ]);
      expect(editAsset).not.toHaveBeenCalled();
    });

    it("should not reject the suggestion of another member's photo for a space editor", async () => {
      const theirs = newUuid();
      mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([theirs]));

      await expect(sut.reject(auth, [theirs])).resolves.toEqual([
        { id: theirs, success: false, error: BulkIdErrorReason.NO_PERMISSION },
      ]);
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });

    it('should undo a fix and suggest it again', async () => {
      mocks.asset.getMetadataByKey.mockResolvedValue({
        key: 'immich.orientation',
        value: { ...record, status: 'fixed' },
      } as never);
      mocks.assetEdit.getAll.mockResolvedValue([
        { id: 'edit-1', action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ] as never);

      await expect(sut.undo(auth, [id])).resolves.toEqual([{ id, success: true }]);
      expect(removeAssetEdits).toHaveBeenCalledWith(auth, id);
      expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(id, [
        { key: 'immich.orientation', value: expect.objectContaining({ status: OrientationStatus.Suggested }) },
      ]);
    });

    it('should not undo a photo that was not fixed', async () => {
      await expect(sut.undo(auth, [id])).resolves.toEqual([
        { id, success: false, error: BulkIdErrorReason.VALIDATION, errorMessage: expect.stringContaining('undo') },
      ]);
    });
  });
});

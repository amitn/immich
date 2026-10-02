import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { ActivityLogAction, ActivityLogSource, AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { RedactionService, clearRedactionCaches, isRedactingLink } from 'src/services/redaction.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { ImmichStreamResponse } from 'src/utils/file.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const PREVIEW = '/data/thumbs/preview.jpeg';
const EDITED_PREVIEW = '/data/thumbs/preview_edited.jpeg';

type RedactionRow = Awaited<ReturnType<ServiceMocks['assetJob']['getForRedaction']>>[number];

const photo = (overrides: Partial<RedactionRow> = {}): RedactionRow => ({
  id: newUuid(),
  ownerId: newUuid(),
  type: AssetType.Image,
  isEdited: false,
  deletedAt: null,
  visibility: AssetVisibility.Timeline,
  originalPath: '/data/library/IMG_0001.jpg',
  originalFileName: 'IMG_0001.jpg',
  livePhotoVideoId: null,
  exifImageWidth: 1000,
  exifImageHeight: 500,
  orientation: null,
  colorspace: null,
  profileDescription: null,
  bitsPerSample: null,
  projectionType: null,
  edits: [],
  files: [{ type: AssetFileType.Preview, path: PREVIEW, isEdited: false }],
  ...overrides,
});

const face = (assetId: string, overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  assetId,
  imageWidth: 1000,
  imageHeight: 500,
  boundingBoxX1: 100,
  boundingBoxY1: 100,
  boundingBoxX2: 200,
  boundingBoxY2: 200,
  personId: null as string | null,
  personName: null as string | null,
  isPet: false,
  identityIds: [] as string[],
  ...overrides,
});

const ocr = (assetId: string, text: string, x = 0.5, y = 0.8, width = 0.1, height = 0.03) => ({
  id: newUuid(),
  assetId,
  text,
  x1: x,
  y1: y,
  x2: x + width,
  y2: y,
  x3: x + width,
  y3: y + height,
  x4: x,
  y4: y + height,
});

const link = (overrides = {}) =>
  factory.auth({ sharedLink: { albumId: newUuid(), redactFaces: true, redactText: false, ...overrides } }).sharedLink!;

describe(RedactionService.name, () => {
  let sut: RedactionService;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const own = (...ids: string[]) => mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(ids));

  beforeEach(() => {
    ({ sut, mocks } = newTestService(RedactionService));
    auth = AuthFactory.create();
    clearRedactionCaches();
    mocks.assetJob.getRedactionFaces.mockResolvedValue([]);
    mocks.assetJob.getRedactionOcr.mockResolvedValue([]);
    mocks.assetJob.getRedactionPeople.mockResolvedValue([]);
    mocks.assetJob.getLivePhotoStillIds.mockResolvedValue([]);
    mocks.media.decodeImage.mockResolvedValue({
      data: Buffer.from('pixels'),
      info: { width: 1000, height: 500, channels: 3 },
    } as any);
    mocks.media.encodeJpeg.mockResolvedValue({ data: Buffer.from('redacted'), width: 1000, height: 500 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('suggest', () => {
    it('should require access', async () => {
      await expect(sut.suggest(auth, newUuid())).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.assetJob.getForRedaction).not.toHaveBeenCalled();
    });

    it('should suggest the faces and the text, never a pet', async () => {
      const asset = photo({ ownerId: auth.user.id });
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      mocks.assetJob.getRedactionFaces.mockResolvedValue([
        face(asset.id, { personId: 'p-alice', personName: 'Alice' }),
        face(asset.id, { isPet: true }),
      ]);
      mocks.assetJob.getRedactionOcr.mockResolvedValue([
        ocr(asset.id, 'AB12 CDE', 0.4, 0.8, 0.12, 0.05),
        ocr(asset.id, 'Trattoria', 0.1, 0.1, 0.2, 0.05),
      ]);

      const result = await sut.suggest(auth, asset.id);

      expect(result).toMatchObject({ assetId: asset.id, width: 1000, height: 500, hasFaces: true, hasText: true });
      expect(
        result.regions.map(({ kind, reason, selected, personName }) => ({ kind, reason, selected, personName })),
      ).toEqual([
        { kind: 'face', reason: 'person', selected: true, personName: 'Alice' },
        { kind: 'plate', reason: 'plate', selected: true, personName: undefined },
        { kind: 'text', reason: 'other', selected: false, personName: undefined },
      ]);
      // smart search is off in the default config: no CLIP check
      expect(result.scene).toBeNull();
    });

    it('should keep the chosen people, by face identity too', async () => {
      const asset = photo();
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      mocks.assetJob.getRedactionFaces.mockResolvedValue([
        face(asset.id, { personId: 'p-kid', personName: 'Kid' }),
        face(asset.id, { personId: 'p-other', personName: 'Kid', identityIds: ['identity-kid'] }),
        face(asset.id),
      ]);
      mocks.assetJob.getRedactionPeople.mockResolvedValue([
        { id: 'p-kid', ownerId: auth.user.id, name: 'Kid', type: 'person', identityId: 'identity-kid' },
      ]);

      const { regions } = await sut.suggest(auth, asset.id, { keepPersonIds: ['p-kid'] });
      expect(regions.map(({ selected, reason }) => ({ selected, reason }))).toEqual([
        { selected: false, reason: 'kept' },
        { selected: false, reason: 'kept' },
        { selected: true, reason: 'unknown' },
      ]);

      const only = await sut.suggest(auth, asset.id, { onlyPersonIds: ['p-kid'] });
      expect(only.regions.map(({ selected }) => selected)).toEqual([true, true, false]);
    });

    it('should place the regions on the edited photo', async () => {
      const asset = photo({
        isEdited: true,
        edits: [{ action: AssetEditAction.Crop, parameters: { x: 50, y: 50, width: 500, height: 250 } }],
      });
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      mocks.assetJob.getRedactionFaces.mockResolvedValue([face(asset.id)]);

      const result = await sut.suggest(auth, asset.id, { text: false });
      expect(result).toMatchObject({ width: 500, height: 250 });
      expect(result.regions[0].x).toBeCloseTo((85 - 50) / 500);
    });

    it('should only redact photos', async () => {
      const asset = photo({ type: AssetType.Video });
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      await expect(sut.suggest(auth, asset.id)).rejects.toThrow('Only photos can be redacted');
    });
  });

  describe('renderPreview', () => {
    it('should blur the preview', async () => {
      const asset = photo();
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      const regions = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }];

      await expect(sut.renderPreview(auth, asset.id, { regions, style: 'pixelate' })).resolves.toEqual(
        Buffer.from('redacted'),
      );
      expect(mocks.media.redactImage).toHaveBeenCalledWith(PREVIEW, regions, {
        style: 'pixelate',
        quality: 85,
        size: 1440,
      });
    });

    it('should not blur the unedited preview of an edited photo', async () => {
      const asset = photo({ isEdited: true });
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      await expect(
        sut.renderPreview(auth, asset.id, { regions: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] }),
      ).rejects.toThrow('preview');
    });
  });

  describe('createRedactedCopy', () => {
    it('should not copy a photo of someone else', async () => {
      const asset = photo();
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      await expect(
        sut.createRedactedCopy(auth, asset.id, { regions: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] }),
      ).rejects.toThrow('asset.copy');
      expect(mocks.media.decodeImage).not.toHaveBeenCalled();
    });

    it('should blur the regions of the original into a stacked copy, and record it', async () => {
      const asset = photo({ ownerId: auth.user.id });
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      const create = vi
        .spyOn(DerivedAssetService.prototype, 'createDerivedAsset')
        .mockResolvedValue({ id: 'copy-id', duplicate: false });
      mocks.activityLog.create.mockResolvedValue({ id: 'entry' } as any);
      const activity = ActivityRecorder.web();

      const result = await sut.createRedactedCopy(
        auth,
        asset.id,
        { regions: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.4, kind: 'face' }], style: 'pixelate' },
        activity,
      );

      expect(result).toEqual({
        id: 'copy-id',
        sourceId: asset.id,
        regionCount: 1,
        description: '1 face',
        duplicate: false,
      });
      expect(mocks.media.decodeImage).toHaveBeenCalledWith(asset.originalPath, expect.anything());
      expect(mocks.media.applyBitmapEdits).not.toHaveBeenCalled();
      expect(mocks.media.redactBitmap).toHaveBeenCalledWith(
        expect.anything(),
        [{ x: 100, y: 100, width: 200, height: 200 }],
        'pixelate',
      );
      expect(create).toHaveBeenCalledWith(
        auth,
        asset.id,
        { buffer: Buffer.from('redacted'), extension: 'jpg' },
        { description: 'Redacted: 1 face', suffix: 'redacted', stack: true },
      );
      expect(mocks.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: ActivityLogSource.Web,
          action: ActivityLogAction.AssetCopy,
          assetIds: ['copy-id', asset.id],
          undo: { copies: [{ id: 'copy-id', sourceId: asset.id }] },
        }),
      );
      // the original is never written
      expect(mocks.asset.update).not.toHaveBeenCalled();
      expect(mocks.storage.createFile).not.toHaveBeenCalledWith(asset.originalPath, expect.anything());
    });

    it('should blur the selected suggestions without regions, and apply the edits first', async () => {
      const asset = photo({
        ownerId: auth.user.id,
        isEdited: true,
        edits: [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }],
      });
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      mocks.assetJob.getRedactionFaces.mockResolvedValue([face(asset.id), face(asset.id, { isPet: true })]);
      vi.spyOn(DerivedAssetService.prototype, 'createDerivedAsset').mockResolvedValue({
        id: 'copy-id',
        duplicate: true,
      });

      const result = await sut.createRedactedCopy(auth, asset.id, {});
      expect(result).toMatchObject({ regionCount: 1, duplicate: true });
      expect(mocks.media.applyBitmapEdits).toHaveBeenCalledWith(expect.anything(), asset.edits);
      // a duplicate is not recorded again
      expect(mocks.activityLog.create).not.toHaveBeenCalled();
    });

    it('should refuse a photo with nothing to blur', async () => {
      const asset = photo({ ownerId: auth.user.id });
      own(asset.id);
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      await expect(sut.createRedactedCopy(auth, asset.id, {})).rejects.toThrow('nothing to blur');
    });
  });

  describe('shared links', () => {
    it('should blur nothing for a link without the options', async () => {
      expect(isRedactingLink(link({ redactFaces: false }))).toBe(false);
      await expect(sut.getLinkRedaction(link({ redactFaces: false }))).resolves.toBeNull();
      await expect(sut.getLinkRedaction(undefined)).resolves.toBeNull();
    });

    it('should keep the people of the album, and blur the others', async () => {
      const sharedLink = link();
      const asset = photo();
      mocks.assetJob.getRedactionPeopleCounts.mockResolvedValue([
        { key: 'alice', personIds: ['p-alice'], identityIds: [], photos: 12 },
        { key: 'bob', personIds: ['p-bob'], identityIds: [], photos: 1 },
      ]);
      mocks.assetJob.countRedactionAssets.mockResolvedValue(40);
      mocks.assetJob.getRedactionFaces.mockResolvedValue([
        face(asset.id, { personId: 'p-alice', personName: 'Alice' }),
        face(asset.id, { personId: 'p-bob', personName: 'Bob' }),
        face(asset.id),
      ]);

      const redaction = (await sut.getLinkRedaction(sharedLink))!;
      expect(mocks.assetJob.getRedactionPeopleCounts).toHaveBeenCalledWith({ albumId: sharedLink.albumId });
      const regions = await sut.getLinkRegions(redaction, [asset.id]);
      expect(regions.get(asset.id)).toHaveLength(2);
      // the text is left alone without redactText
      expect(mocks.assetJob.getRedactionOcr).not.toHaveBeenCalled();

      // remembered for the next requests of the page
      await sut.getLinkRedaction(sharedLink);
      expect(mocks.assetJob.getRedactionPeopleCounts).toHaveBeenCalledTimes(1);
    });

    it('should count the people of a book on its pages', async () => {
      const bookId = newUuid();
      const [a, b] = [newUuid(), newUuid()];
      mocks.book.get.mockResolvedValue({ id: bookId, coverAssetId: a } as any);
      mocks.book.getPages.mockResolvedValue([{ assets: [{ assetId: a }, { assetId: b }] }] as any);
      mocks.assetJob.getRedactionPeopleCounts.mockResolvedValue([]);

      await sut.getLinkRedaction(link({ albumId: null, bookId }));
      expect(mocks.assetJob.getRedactionPeopleCounts).toHaveBeenCalledWith({ assetIds: [a, b] });
    });

    it('should serve a thumbnail with the regions blurred, and the file as it is without any', async () => {
      const asset = photo({ files: [{ type: AssetFileType.Preview, path: PREVIEW, isEdited: false }] });
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      mocks.assetJob.getRedactionOcr.mockResolvedValue([ocr(asset.id, 'Via del Corso')]);
      const redaction = (await sut.getLinkRedaction(link({ redactFaces: false, redactText: true })))!;

      const response = await sut.getLinkThumbnail(redaction, asset.id, PREVIEW, 'photo_preview.jpg');
      expect(response).toBeInstanceOf(ImmichStreamResponse);
      expect(response).toMatchObject({ contentType: 'image/jpeg', fileName: 'photo_preview.jpg' });
      expect(mocks.media.redactImage).toHaveBeenCalledWith(
        PREVIEW,
        [expect.objectContaining({ x: expect.any(Number) })],
        {
          style: 'blur',
          quality: 85,
        },
      );

      // rendered once: the next request is served from the cache
      await sut.getLinkThumbnail(redaction, asset.id, PREVIEW, 'photo_preview.jpg');
      expect(mocks.media.redactImage).toHaveBeenCalledTimes(1);

      mocks.assetJob.getRedactionOcr.mockResolvedValue([]);
      await expect(sut.getLinkThumbnail(redaction, asset.id, PREVIEW, 'photo_preview.jpg')).resolves.toBeNull();
    });

    it('should move the regions with the edits on an edited file', async () => {
      const asset = photo({
        isEdited: true,
        edits: [{ action: AssetEditAction.Crop, parameters: { x: 500, y: 0, width: 500, height: 500 } }],
        files: [
          { type: AssetFileType.Preview, path: PREVIEW, isEdited: false },
          { type: AssetFileType.Preview, path: EDITED_PREVIEW, isEdited: true },
        ],
      });
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      // a face on the right half, which the crop keeps
      mocks.assetJob.getRedactionFaces.mockResolvedValue([face(asset.id, { boundingBoxX1: 700, boundingBoxX2: 800 })]);
      mocks.assetJob.getRedactionPeopleCounts.mockResolvedValue([]);
      mocks.assetJob.countRedactionAssets.mockResolvedValue(10);
      const redaction = (await sut.getLinkRedaction(link()))!;

      await sut.getLinkThumbnail(redaction, asset.id, EDITED_PREVIEW, 'photo.jpg');
      const [, [rect]] = mocks.media.redactImage.mock.calls[0];
      expect(rect.x).toBeCloseTo((685 - 500) / 500);
    });

    it('should serve a blurred JPEG instead of the original', async () => {
      const asset = photo();
      mocks.assetJob.getForRedaction.mockResolvedValue([asset]);
      mocks.assetJob.getRedactionOcr.mockResolvedValue([ocr(asset.id, 'Via del Corso')]);
      const redaction = (await sut.getLinkRedaction(link({ redactFaces: false, redactText: true })))!;

      const response = await sut.getLinkOriginal(redaction, asset.id, { download: true, edited: true });
      expect(response).toMatchObject({ fileName: 'IMG_0001.jpg', disposition: 'attachment' });
      expect(mocks.media.redactImage).toHaveBeenCalledWith(asset.originalPath, expect.any(Array), {
        style: 'blur',
        quality: 90,
      });
    });

    it('should withhold a video, or the motion of a live photo, with something to blur', async () => {
      const video = photo({ type: AssetType.Video });
      const still = photo({ livePhotoVideoId: video.id });
      mocks.assetJob.getForRedaction.mockResolvedValue([video]);
      mocks.assetJob.getLivePhotoStillIds.mockResolvedValue([{ id: still.id, livePhotoVideoId: video.id }]);
      mocks.assetJob.getRedactionOcr.mockResolvedValue([ocr(still.id, 'Via del Corso')]);
      const redaction = (await sut.getLinkRedaction(link({ redactFaces: false, redactText: true })))!;

      await expect(sut.requireVideoShown(redaction, video.id)).rejects.toThrow('This video is not shared');
      await expect(sut.getLinkOriginal(redaction, video.id, { edited: true })).rejects.toThrow('not shared');

      mocks.assetJob.getRedactionOcr.mockResolvedValue([]);
      await expect(sut.requireVideoShown(redaction, video.id)).resolves.toBeUndefined();
    });
  });
});

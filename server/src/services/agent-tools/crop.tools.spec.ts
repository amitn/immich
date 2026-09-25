import { Stats } from 'node:fs';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetFileType, AssetType, Colorspace } from 'src/enum.js';
import { CropAgentTools } from 'src/services/agent-tools/crop.tools.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AssetFaceFactory } from 'test/factories/asset-face.factory.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { AssetExifLike, AssetLike } from 'test/factories/types.js';
import { getForAsset, getForAssetFace } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const PREVIEW_PATH = '/data/thumbs/preview.jpeg';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return JSON.parse((result.content[0] as { text: string }).text);
};

const errorText = (result: AgentToolResult) => {
  expect(result.isError).toBe(true);
  return (result.content[0] as { text: string }).text;
};

/** a level image with one strong line at the given angle (image coordinates, y down) */
const tilted = (lineAngle: number) => {
  const width = 512;
  const height = 384;
  const data = new Uint8Array(width * height);
  const radians = (lineAngle * Math.PI) / 180;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = (y - height / 2) * Math.cos(radians) - (x - width / 2) * Math.sin(radians);
      data[y * width + x] = Math.round(60 + 140 / (1 + Math.exp(distance / 0.7)));
    }
  }
  return { data, width, height };
};

describe(CropAgentTools.name, () => {
  let sut: CropAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  const setupAsset = (dto: AssetLike = {}, exif: AssetExifLike = {}) => {
    const asset = AssetFactory.from({ ownerId: auth.user.id, originalFileName: 'IMG_0001.jpg', ...dto })
      .exif({ exifImageWidth: 4000, exifImageHeight: 3000, orientation: null, projectionType: null, ...exif })
      .file({ type: AssetFileType.Preview, path: PREVIEW_PATH, isEdited: false })
      .build();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    return asset;
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CropAgentTools));
    auth = AuthFactory.create();
    mocks.person.getFaces.mockResolvedValue([]);
    mocks.media.decodeImage.mockResolvedValue({
      data: Buffer.from('preview'),
      info: { width: 1440, height: 1080, channels: 3 },
    } as any);
    mocks.media.cropImage.mockResolvedValue({ data: Buffer.from('jpeg'), width: 768, height: 768 });
    mocks.storage.stat.mockResolvedValue({ size: 1000 } as Stats);
    mocks.crypto.randomUUID.mockReturnValue('new-asset-id');
    mocks.asset.create.mockImplementation((asset) => Promise.resolve({ ...AssetFactory.create(), ...asset }) as any);
    mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);
  });

  it('should expose the crop tools', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'suggest_crop', mutating: false },
      { name: 'crop_photo', mutating: true },
      { name: 'straighten_photo', mutating: true },
    ]);
  });

  describe('suggest_crop', () => {
    it('should require access', async () => {
      const text = errorText(await call('suggest_crop', { id: newUuid(), aspectRatio: '1:1' }));
      expect(text).toContain('Not found or no asset.view access');
      expect(mocks.asset.getById).not.toHaveBeenCalled();
    });

    it('should report the tilt and suggest a straightened crop', async () => {
      const asset = setupAsset();
      mocks.media.straightenImage.mockResolvedValue({ data: Buffer.from('straight-preview'), width: 768, height: 576 });

      const result = await call('suggest_crop', { id: asset.id, rotate: 5 });
      const suggestion = parse(result);

      expect(suggestion.rotate).toBe(5);
      expect(suggestion.width).toBeLessThan(4000);
      expect(suggestion.width / suggestion.height).toBeCloseTo(4 / 3, 2);
      expect(suggestion.rectNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
      expect(suggestion.tilt).toEqual({ angle: 0, confidence: 0, recommended: false });
      expect(mocks.media.straightenImage).toHaveBeenCalledWith(
        expect.anything(),
        5,
        expect.objectContaining({ x: 0, y: 0 }),
        expect.objectContaining({ size: 768 }),
      );
      expect(result.content[1]).toMatchObject({
        type: 'image',
        data: Buffer.from('straight-preview').toString('base64'),
      });
    });

    it('should suggest a face-aware crop with a preview', async () => {
      const asset = setupAsset();
      const face = AssetFaceFactory.from({
        assetId: asset.id,
        imageWidth: 1440,
        imageHeight: 1080,
        boundingBoxX1: 648,
        boundingBoxY1: 288,
        boundingBoxX2: 864,
        boundingBoxY2: 540,
      })
        .person({ name: 'Mia' })
        .build();
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);

      const result = await call('suggest_crop', { id: asset.id, aspectRatio: '1:1' });
      const suggestion = parse(result);

      // the face is 1800..2400 in the original, so a centred square starts at 600
      expect(suggestion).toMatchObject({
        assetId: asset.id,
        width: 4000,
        height: 3000,
        feasible: true,
        aspectRatio: 1,
        basis: 'faces',
        rect: { x: 600, y: 0, width: 3000, height: 3000 },
        rectNormalized: { x: 0.15, y: 0, width: 0.75, height: 1 },
        faces: [{ faceId: face.id, personId: face.personGroupId, name: 'Mia', included: true }],
      });
      expect(mocks.person.getFaces).toHaveBeenCalledWith(asset.id, { viewingUserId: auth.user.id });
      expect(mocks.media.getAttentionPoint).not.toHaveBeenCalled();

      expect(result.content[1]).toEqual({
        type: 'image',
        data: Buffer.from('jpeg').toString('base64'),
        mimeType: 'image/jpeg',
      });
      expect(mocks.media.decodeImage).toHaveBeenCalledWith(PREVIEW_PATH, {
        colorspace: Colorspace.Srgb,
        processInvalidImages: false,
      });
      expect(mocks.media.cropImage).toHaveBeenCalledWith(
        expect.anything(),
        { x: 216, y: 0, width: 1080, height: 1080 },
        { colorspace: Colorspace.Srgb, quality: 80, size: 768 },
      );
    });

    it('should use the upright dimensions of a rotated photo', async () => {
      const asset = setupAsset({}, { orientation: '6' });

      const suggestion = parse(await call('suggest_crop', { id: asset.id, aspectRatio: '1:1' }));

      expect(suggestion).toMatchObject({ width: 3000, height: 4000, rect: { width: 3000, height: 3000 } });
    });

    it('should fall back to the salient region without faces', async () => {
      const asset = setupAsset();
      mocks.media.getAttentionPoint.mockResolvedValue({ x: 0.9, y: 0.5 });

      const suggestion = parse(await call('suggest_crop', { id: asset.id, aspectRatio: '1:1' }));

      expect(mocks.media.getAttentionPoint).toHaveBeenCalledWith(PREVIEW_PATH);
      expect(suggestion).toMatchObject({ basis: 'saliency', rect: { x: 1000, y: 0 }, faces: [] });
    });

    it('should centre the crop when the focal point cannot be found', async () => {
      const asset = setupAsset();
      mocks.media.getAttentionPoint.mockRejectedValue(new Error('bad image'));

      const suggestion = parse(await call('suggest_crop', { id: asset.id, aspectRatio: '1:1' }));

      expect(suggestion).toMatchObject({ basis: 'center', rect: { x: 500, y: 0 } });
    });

    it('should return only json without a preview file', async () => {
      const asset = AssetFactory.from({ ownerId: auth.user.id })
        .exif({ exifImageWidth: 4000, exifImageHeight: 3000, orientation: null })
        .build();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.asset.getById.mockResolvedValue(getForAsset(asset));

      const result = await call('suggest_crop', { id: asset.id, aspectRatio: 1.5 });

      expect(result.content).toHaveLength(1);
      expect(parse(result)).toMatchObject({ basis: 'center', rect: { x: 0, y: 167, width: 4000, height: 2667 } });
    });

    it('should reject videos', async () => {
      const asset = setupAsset({ type: AssetType.Video });
      expect(errorText(await call('suggest_crop', { id: asset.id, aspectRatio: '1:1' }))).toContain(
        'Only photos can be cropped',
      );
    });

    it('should reject photos without dimensions', async () => {
      const asset = setupAsset({}, { exifImageWidth: null, exifImageHeight: null });
      expect(errorText(await call('suggest_crop', { id: asset.id, aspectRatio: '1:1' }))).toContain(
        'dimensions of this photo are not known',
      );
    });

    it('should reject an invalid aspect ratio', async () => {
      const asset = setupAsset();
      expect(errorText(await call('suggest_crop', { id: asset.id, aspectRatio: 'wide' }))).toContain(
        'Invalid aspect ratio',
      );
    });
  });

  describe('getCropSuggestion', () => {
    it('should not render a preview', async () => {
      const asset = setupAsset();
      await expect(sut.getCropSuggestion(auth, asset.id, '4:5')).resolves.toMatchObject({
        feasible: true,
        rect: { x: 800, y: 0, width: 2400, height: 3000 },
        rectNormalized: { x: 0.2, y: 0, width: 0.6, height: 1 },
      });
      expect(mocks.media.cropImage).not.toHaveBeenCalled();
    });
  });

  describe('straighten_photo', () => {
    beforeEach(() => {
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('original'),
        info: { width: 4000, height: 3000, channels: 3 },
      } as any);
      mocks.media.straightenImage.mockResolvedValue({ data: Buffer.from('straight'), width: 3700, height: 2775 });
    });

    it('should use the measured tilt', async () => {
      const asset = setupAsset();
      mocks.media.getGrayscale.mockResolvedValue(tilted(-2.5));

      const result = parse(await call('straighten_photo', { id: asset.id }));

      expect(result.rotate).toBeCloseTo(2.5, 0);
      expect(mocks.media.getGrayscale).toHaveBeenCalledWith(PREVIEW_PATH);
      expect(mocks.media.straightenImage).toHaveBeenCalledWith(
        expect.anything(),
        result.rotate,
        null,
        expect.anything(),
      );
    });

    it('should refuse when there is no clear tilt', async () => {
      const asset = setupAsset();
      mocks.media.getGrayscale.mockResolvedValue(tilted(0));

      expect(errorText(await call('straighten_photo', { id: asset.id }))).toContain('No clear tilt');
      expect(mocks.media.straightenImage).not.toHaveBeenCalled();
    });

    it('should use an explicit angle', async () => {
      const asset = setupAsset();
      await call('straighten_photo', { id: asset.id, rotate: -4 });
      expect(mocks.media.getGrayscale).not.toHaveBeenCalled();
      expect(mocks.media.straightenImage).toHaveBeenCalledWith(expect.anything(), -4, null, expect.anything());
    });

    it('should reject large rotations', () => {
      const tool = sut.getTools().find(({ name }) => name === 'straighten_photo')!;
      expect(() => tool.input.parse({ id: newUuid(), rotate: 45 })).toThrow();
    });
  });

  describe('crop_photo', () => {
    beforeEach(() => {
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('original'),
        info: { width: 4000, height: 3000, channels: 3 },
      } as any);
      mocks.media.cropImage.mockResolvedValue({ data: Buffer.from('cropped'), width: 3000, height: 3000 });
    });

    it('should require owner access', async () => {
      const text = errorText(await call('crop_photo', { id: newUuid(), aspectRatio: '1:1' }));
      expect(text).toContain('Not found or no asset.update access');
      expect(mocks.media.decodeImage).not.toHaveBeenCalled();
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should require one crop or a rotation', async () => {
      const asset = setupAsset();
      expect(errorText(await call('crop_photo', { id: asset.id }))).toContain('Pass one of');
      expect(
        errorText(
          await call('crop_photo', { id: asset.id, aspectRatio: '1:1', rect: { x: 0, y: 0, width: 10, height: 10 } }),
        ),
      ).toContain('Pass one of');
    });

    it('should straighten the whole photo', async () => {
      const asset = setupAsset();
      mocks.media.straightenImage.mockResolvedValue({ data: Buffer.from('straight'), width: 3600, height: 2700 });

      const result = parse(await call('crop_photo', { id: asset.id, rotate: 3 }));

      expect(result).toEqual({ id: 'new-asset-id', sourceId: asset.id, width: 3600, height: 2700, duplicate: false });
      expect(mocks.media.straightenImage).toHaveBeenCalledWith(
        expect.objectContaining({ data: Buffer.from('original') }),
        3,
        null,
        { colorspace: Colorspace.Srgb, quality: 95 },
      );
      expect(mocks.media.cropImage).not.toHaveBeenCalled();
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalFileName: 'IMG_0001-straight.jpg' }),
      );
      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ Description: 'Straightened (3°) from IMG_0001.jpg' }),
      );
    });

    it('should straighten and then crop inside the straightened photo', async () => {
      const asset = setupAsset();
      mocks.media.straightenImage.mockResolvedValue({ data: Buffer.from('straight'), width: 2000, height: 2000 });

      await call('crop_photo', { id: asset.id, rotate: -2, aspectRatio: '1:1' });

      const [, angle, crop] = mocks.media.straightenImage.mock.calls[0];
      expect(angle).toBe(-2);
      // a square inside the straightened 4:3 photo, which is smaller than the 4000x3000 original
      expect(crop!.width).toBe(crop!.height);
      expect(crop!.height).toBeLessThan(3000);
      expect(crop!.x + crop!.width).toBeLessThanOrEqual(4000);
    });

    it('should create a cropped copy stacked with the original', async () => {
      const asset = setupAsset();

      const result = parse(await call('crop_photo', { id: asset.id, aspectRatio: '1:1' }));

      expect(result).toEqual({ id: 'new-asset-id', sourceId: asset.id, width: 3000, height: 3000, duplicate: false });
      expect(mocks.media.decodeImage).toHaveBeenCalledWith(
        asset.originalPath,
        expect.objectContaining({ size: undefined }),
      );
      expect(mocks.media.cropImage).toHaveBeenCalledWith(
        expect.objectContaining({ data: Buffer.from('original') }),
        { x: 500, y: 0, width: 3000, height: 3000 },
        { colorspace: Colorspace.Srgb, quality: 95 },
      );
      expect(mocks.storage.createFile).toHaveBeenCalledWith(
        expect.stringMatching(/new-asset-id\.jpg$/),
        Buffer.from('cropped'),
      );
      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(
        expect.stringMatching(/new-asset-id\.jpg$/),
        expect.objectContaining({ Description: 'Cropped from IMG_0001.jpg', Orientation: 'Horizontal (normal)' }),
      );
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: auth.user.id, originalFileName: 'IMG_0001-crop.jpg' }),
      );
      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: auth.user.id }, [asset.id, 'new-asset-id']);
    });

    it('should scale the crop to the decoded image', async () => {
      const asset = setupAsset({ originalFileName: 'IMG_0001.CR2', originalPath: '/data/library/IMG_0001.CR2' });
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('embedded'),
        info: { width: 2000, height: 1500, channels: 3 },
      } as any);

      await call('crop_photo', { id: asset.id, rect: { x: 1000, y: 500, width: 2000, height: 1000 } });

      expect(mocks.media.cropImage).toHaveBeenCalledWith(
        expect.anything(),
        { x: 500, y: 250, width: 1000, height: 500 },
        expect.anything(),
      );
    });

    it('should accept a normalized crop', async () => {
      const asset = setupAsset();

      await call('crop_photo', { id: asset.id, rectNormalized: { x: 0.25, y: 0.5, width: 0.5, height: 0.5 } });

      expect(mocks.media.cropImage).toHaveBeenCalledWith(
        expect.anything(),
        { x: 1000, y: 1500, width: 2000, height: 1500 },
        expect.anything(),
      );
    });

    it('should reject a crop that is out of bounds', async () => {
      const asset = setupAsset();
      const text = errorText(
        await call('crop_photo', { id: asset.id, rect: { x: 3000, y: 0, width: 2000, height: 10 } }),
      );
      expect(text).toContain('out of bounds');
      expect(mocks.media.decodeImage).not.toHaveBeenCalled();
    });

    it('should reject a tiny crop', async () => {
      const asset = setupAsset();
      const text = errorText(await call('crop_photo', { id: asset.id, rect: { x: 0, y: 0, width: 8, height: 8 } }));
      expect(text).toContain('at least');
    });

    it('should refuse an aspect ratio that cannot hold the main face', async () => {
      const asset = setupAsset();
      const face = AssetFaceFactory.create({
        assetId: asset.id,
        imageWidth: 4000,
        imageHeight: 3000,
        boundingBoxX1: 500,
        boundingBoxY1: 0,
        boundingBoxX2: 3500,
        boundingBoxY2: 3000,
      });
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);

      const text = errorText(await call('crop_photo', { id: asset.id, aspectRatio: '1:3' }));
      expect(text).toContain('main face does not fit');
      expect(text).toContain('Pass an explicit rect');
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it.each([
      [{ originalFileName: 'anim.gif', originalPath: '/data/anim.gif' }, {}, 'GIF'],
      [{ originalFileName: 'logo.svg', originalPath: '/data/logo.svg' }, {}, 'SVG'],
      [{}, { projectionType: 'EQUIRECTANGULAR' }, 'panorama'],
      [{ type: AssetType.Video }, {}, 'Only photos'],
    ])('should refuse unsupported assets (%#)', async (dto, exif, message) => {
      const asset = setupAsset(dto, exif);
      expect(errorText(await call('crop_photo', { id: asset.id, aspectRatio: '1:1' }))).toContain(message);
      expect(mocks.media.decodeImage).not.toHaveBeenCalled();
    });
  });
});

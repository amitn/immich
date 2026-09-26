import { Stats } from 'node:fs';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetFileType, AssetType } from 'src/enum.js';
import { EnhanceAgentTools } from 'src/services/agent-tools/enhance.tools.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { ImproveService } from 'src/services/improve.service.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { computeImageStats } from 'src/utils/enhance.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { AssetLike } from 'test/factories/types.js';
import { getForAsset } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return JSON.parse((result.content[0] as { text: string }).text);
};

const errorText = (result: AgentToolResult) => {
  expect(result.isError).toBe(true);
  return (result.content[0] as { text: string }).text;
};

const agentRow = (id: string) =>
  ({ id, checksum: Buffer.from(id), previewPath: '/p.jpeg', width: 4000, height: 3000, faces: [] }) as never;

const darkStats = () => {
  const size = 64;
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const value = Math.round((((i % size) + Math.floor(i / size)) / (2 * size)) * 90 + ((i * 7) % 5));
    data.set([value, value, value], i * 3);
  }
  return computeImageStats(data, size, size, 3);
};

describe(EnhanceAgentTools.name, () => {
  let sut: EnhanceAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  const setupAsset = (dto: AssetLike = {}) => {
    const asset = AssetFactory.from({ ownerId: auth.user.id, originalFileName: 'IMG_0001.jpg', ...dto })
      .exif({ exifImageWidth: 4000, exifImageHeight: 3000, orientation: null, projectionType: null })
      .file({ type: AssetFileType.Preview, path: '/data/thumbs/preview.jpeg', isEdited: false })
      .build();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    return asset;
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(EnhanceAgentTools));
    // no photo is a private source (a travel document) unless a test says so
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    auth = AuthFactory.create();
    mocks.media.decodeImage.mockResolvedValue({
      data: Buffer.from('pixels'),
      info: { width: 1440, height: 1080, channels: 3 },
    } as any);
    mocks.media.getEnhanceStats.mockResolvedValue(darkStats());
    mocks.media.renderEnhanceComparison.mockResolvedValue(Buffer.from('comparison'));
    mocks.media.enhanceImage.mockResolvedValue({ data: Buffer.from('enhanced'), width: 4000, height: 3000 });
    mocks.storage.stat.mockResolvedValue({ size: 1000 } as Stats);
    mocks.crypto.randomUUID.mockReturnValue('new-asset-id');
    mocks.asset.create.mockImplementation((asset) => Promise.resolve({ ...AssetFactory.create(), ...asset }) as any);
    mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should expose the enhance tools', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'suggest_enhancement', mutating: false },
      { name: 'improve_photos', mutating: true },
      { name: 'enhance_photo', mutating: true },
    ]);
    const [suggest, , enhance] = sut.getTools();
    expect(suggest.description).toMatch(/no AI/);
    expect(suggest.description).toMatch(/skip photos that do not need it/);
    expect(enhance.description).toMatch(/no AI/);
    expect(enhance.description).toMatch(/original is never changed/);
    expect(enhance.description).toMatch(/stacked with the original/);
    expect(enhance.description).toMatch(/suggest_enhancement first/);
  });

  describe('suggest_enhancement', () => {
    it('should require access', async () => {
      const text = errorText(await call('suggest_enhancement', { id: newUuid() }));
      expect(text).toContain('Not found or no asset.view access');
    });

    it('should return the analysis and the before/after image', async () => {
      const asset = setupAsset();

      const result = await call('suggest_enhancement', { id: asset.id, strength: 'subtle' });

      expect(parse(result)).toMatchObject({
        assetId: asset.id,
        strength: 'subtle',
        needed: true,
        adjustments: expect.arrayContaining([expect.stringMatching(/^Auto levels/)]),
      });
      expect(result.content[1]).toEqual({
        type: 'image',
        data: Buffer.from('comparison').toString('base64'),
        mimeType: 'image/jpeg',
      });
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should reject an invalid strength', () => {
      expect(() => call('suggest_enhancement', { id: newUuid(), strength: 'extreme' })).toThrow();
    });
  });

  describe('enhance_photo', () => {
    it('should require owner access', async () => {
      const text = errorText(await call('enhance_photo', { id: newUuid() }));
      expect(text).toContain('Not found or no asset.update access');
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should refuse videos', async () => {
      const asset = setupAsset({ type: AssetType.Video });
      expect(errorText(await call('enhance_photo', { id: asset.id }))).toContain('Only photos can be enhanced');
    });

    it('should create an enhanced copy', async () => {
      const asset = setupAsset();
      const createEnhancedCopy = vi.spyOn(EnhanceService.prototype, 'createEnhancedCopy');

      const result = parse(await call('enhance_photo', { id: asset.id, strength: 'strong', only: ['levels'] }));

      expect(result).toEqual({
        id: 'new-asset-id',
        sourceId: asset.id,
        adjustments: [expect.stringMatching(/^Auto levels/)],
        duplicate: false,
      });
      expect(createEnhancedCopy).toHaveBeenCalledWith(auth, asset.id, { strength: 'strong', only: ['levels'] });
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalFileName: 'IMG_0001-enhanced.jpg' }),
      );
    });
  });

  describe('improve_photos', () => {
    const recipe = {
      rotate: 2.4,
      crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
      enhance: { strength: 'normal' },
    };

    beforeEach(() => {
      mocks.media.straightenBitmap.mockResolvedValue({
        data: Buffer.from('straight'),
        info: { width: 1200, height: 900, channels: 3 },
      });
      mocks.media.cropBitmap.mockResolvedValue({
        data: Buffer.from('cropped'),
        info: { width: 1200, height: 900, channels: 3 },
      });
      mocks.media.encodeJpeg.mockResolvedValue({ data: Buffer.from('encoded'), width: 1200, height: 900 });
      mocks.media.enhanceImage.mockResolvedValue({ data: Buffer.from('improved'), width: 1200, height: 900 });
    });

    it('should require owner access', async () => {
      const text = errorText(await call('improve_photos', { photos: [{ id: newUuid(), ...recipe }] }));
      expect(text).toContain('Not found or no asset.update access');
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should need photos', async () => {
      expect(errorText(await call('improve_photos', {}))).toContain('Pass photos');
    });

    it('should create one combined copy per photo, stacked with the original', async () => {
      const asset = setupAsset();

      const result = parse(await call('improve_photos', { photos: [{ id: asset.id, ...recipe, gain: 0.1 }] }));

      expect(result).toEqual({
        improved: [{ sourceId: asset.id, id: 'new-asset-id', description: expect.stringMatching(/^Improved from/) }],
        copies: { [asset.id]: 'new-asset-id' },
      });
      expect(result.improved[0].description).toMatch(
        /^Improved from IMG_0001\.jpg: straightened 2\.4°, cropped, auto-enhanced \(/,
      );

      // decoded once, straightened and cropped in one step, enhanced, and encoded once
      expect(mocks.media.decodeImage).toHaveBeenCalledTimes(1);
      expect(mocks.media.straightenBitmap).toHaveBeenCalledTimes(1);
      const [, angle, crop] = mocks.media.straightenBitmap.mock.calls[0];
      expect(angle).toBe(2.4);
      expect(crop).toEqual(expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
      expect(mocks.media.cropBitmap).not.toHaveBeenCalled();
      expect(mocks.media.enhanceImage).toHaveBeenCalledTimes(1);
      expect(mocks.media.straightenImage).not.toHaveBeenCalled();
      expect(mocks.media.cropImage).not.toHaveBeenCalled();

      expect(mocks.asset.create).toHaveBeenCalledTimes(1);
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalFileName: 'IMG_0001-improved.jpg' }),
      );
      expect(mocks.metadata.writeTags).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ TagsList: ['Edits/Improved'], Description: result.improved[0].description }),
      );
      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: asset.ownerId }, [asset.id, 'new-asset-id']);
    });

    it('should crop without straightening and encode without enhancing', async () => {
      const asset = setupAsset();

      const result = parse(
        await call('improve_photos', { photos: [{ id: asset.id, crop: { x: 0, y: 0, width: 0.9, height: 0.9 } }] }),
      );

      expect(result.improved[0].description).toBe('Improved from IMG_0001.jpg: cropped');
      expect(mocks.media.cropBitmap).toHaveBeenCalledWith(expect.anything(), { x: 0, y: 0, width: 1296, height: 972 });
      expect(mocks.media.straightenBitmap).not.toHaveBeenCalled();
      expect(mocks.media.enhanceImage).not.toHaveBeenCalled();
      expect(mocks.media.encodeJpeg).toHaveBeenCalledTimes(1);
    });

    it('should choose the fixes automatically', async () => {
      const asset = setupAsset();
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(asset.id)]);
      const estimate = vi.spyOn(ImproveService.prototype, 'estimate').mockResolvedValue({
        now: 0.5,
        potential: 0.6,
        gain: 0.1,
        recipe: { rotate: -1.5 },
      });

      const result = parse(await call('improve_photos', { ids: [asset.id] }));

      expect(estimate).toHaveBeenCalledTimes(1);
      expect(result.improved[0].description).toBe('Improved from IMG_0001.jpg: straightened 1.5°');
      expect(mocks.media.straightenBitmap).toHaveBeenCalledWith(expect.anything(), -1.5, null);
    });

    it('should skip photos that need nothing and report them', async () => {
      const asset = setupAsset();
      vi.spyOn(ImproveService.prototype, 'estimate').mockResolvedValue({
        now: 0.8,
        potential: 0.8,
        gain: 0,
        recipe: {},
      });
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(asset.id)]);

      const text = errorText(await call('improve_photos', { ids: [asset.id] }));

      expect(text).toContain('does not need to be improved');
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('should refuse videos', async () => {
      const asset = setupAsset({ type: AssetType.Video });
      const text = errorText(await call('improve_photos', { photos: [{ id: asset.id, rotate: 2 }] }));
      expect(text).toContain('Only photos can be improved');
    });
  });
});

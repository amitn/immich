import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { EnhanceAnalysisResponseDto, EnhanceResponseDto } from 'src/dtos/enhance.dto.js';
import { AssetFileType, AssetType, Colorspace, Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { getDimensions, isPanorama } from 'src/utils/asset.util.js';
import { EnhanceCorrectionType, EnhanceStrength, planEnhancement } from 'src/utils/enhance.js';
import { decodeOriginal } from 'src/utils/image-decode.js';

const ENHANCE_QUALITY = 93;
const COMPARISON_WIDTH = 1024;
const COMPARISON_GAP = 8;

export type EnhanceInput = { strength?: EnhanceStrength; only?: EnhanceCorrectionType[] };

type EnhanceAsset = NonNullable<Awaited<ReturnType<EnhanceService['getAsset']>>>;

/** Automatic photo enhancement with local image processing (no AI); the original is never changed */
@Injectable()
export class EnhanceService extends BaseService {
  /** Decides which corrections a photo needs, from its preview */
  async analyze(auth: AuthDto, assetId: string, input: EnhanceInput = {}): Promise<EnhanceAnalysisResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });
    const asset = await this.getAsset(assetId);
    const preview = await this.decodePreview(asset);
    const stats = await this.mediaRepository.getEnhanceStats(preview);
    const { width, height } = asset.exifInfo ? getDimensions(asset.exifInfo) : { width: 0, height: 0 };

    const analysis = planEnhancement(stats, {
      ...input,
      outputSize: Math.max(width ?? 0, height ?? 0) || undefined,
      iso: asset.exifInfo?.iso,
    });
    return { assetId, needed: analysis.corrections.length > 0, ...analysis };
  }

  /** The preview before and after the corrections, side by side */
  async renderEnhancePreview(auth: AuthDto, assetId: string, input: EnhanceInput = {}): Promise<Buffer> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });
    const asset = await this.getAsset(assetId);
    const preview = await this.decodePreview(asset);
    const stats = await this.mediaRepository.getEnhanceStats(preview);
    const { plan } = planEnhancement(stats, {
      ...input,
      outputSize: Math.floor((COMPARISON_WIDTH - COMPARISON_GAP) / 2),
      iso: asset.exifInfo?.iso,
    });
    return this.mediaRepository.renderEnhanceComparison(preview, plan, { width: COMPARISON_WIDTH });
  }

  /** Enhances the full-resolution original into a new asset, stacked with the original */
  async createEnhancedCopy(auth: AuthDto, assetId: string, input: EnhanceInput = {}): Promise<EnhanceResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [assetId] });
    const asset = await this.getAsset(assetId);
    const exifInfo = asset.exifInfo!;

    const { image } = await this.getConfig({ withCache: true });
    const decoded = await decodeOriginal(
      this.mediaRepository,
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo },
      image,
    );

    const stats = await this.mediaRepository.getEnhanceStats(decoded);
    const { plan, adjustments } = planEnhancement(stats, {
      ...input,
      outputSize: Math.max(decoded.info.width, decoded.info.height),
      iso: exifInfo.iso,
    });
    if (adjustments.length === 0) {
      throw new BadRequestException('This photo does not need to be enhanced');
    }

    const output = await this.mediaRepository.enhanceImage(decoded, plan, {
      colorspace: decoded.colorspace,
      quality: ENHANCE_QUALITY,
    });

    const { id, duplicate } = await BaseService.create(DerivedAssetService, this).createDerivedAsset(
      auth,
      assetId,
      { buffer: output.data, extension: 'jpg' },
      { description: `Auto-enhanced: ${adjustments.join(', ')}`, suffix: 'enhanced', stack: true },
    );

    return { id, sourceId: assetId, adjustments, duplicate };
  }

  private async getAsset(assetId: string) {
    const asset = await this.assetRepository.getById(assetId, { exifInfo: true, files: true });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException('Asset not found');
    }

    if (asset.type !== AssetType.Image) {
      throw new BadRequestException('Only photos can be enhanced');
    }

    const names = [asset.originalFileName, asset.originalPath].map((name) => name.toLowerCase());
    if (names.some((name) => name.endsWith('.gif'))) {
      throw new BadRequestException('Enhancing GIF images is not supported');
    }

    if (names.some((name) => name.endsWith('.svg'))) {
      throw new BadRequestException('Enhancing SVG images is not supported');
    }

    if (!asset.exifInfo) {
      throw new BadRequestException('The metadata of this photo has not been extracted yet, try again later');
    }

    if (isPanorama({ projectionType: asset.exifInfo.projectionType, originalFileName: asset.originalFileName })) {
      throw new BadRequestException('Enhancing panorama images is not supported');
    }

    return asset;
  }

  private decodePreview(asset: EnhanceAsset) {
    const previewPath = asset.files?.find((file) => file.type === AssetFileType.Preview && !file.isEdited)?.path;
    if (!previewPath) {
      throw new BadRequestException('The preview of this photo has not been generated yet, try again later');
    }

    return this.mediaRepository.decodeImage(previewPath, { colorspace: Colorspace.Srgb, processInvalidImages: false });
  }
}

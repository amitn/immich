import { BadRequestException, Injectable } from '@nestjs/common';
import z from 'zod';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetFileType, AssetType, Colorspace, Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import {
  CropRect,
  CropSuggestion,
  normalizeRect,
  parseAspectRatio,
  scaleBox,
  suggestCrop,
} from 'src/utils/agent/crop.js';
import { AgentTool, defineTool, toolError, toolImage, toolJson } from 'src/utils/agent/tools.js';
import { getDimensions, isPanorama } from 'src/utils/asset.util.js';
import { decodeOriginal } from 'src/utils/image-decode.js';

const CROP_PREVIEW_SIZE = 768;
const CROP_QUALITY = 95;
const MIN_CROP_SIZE = 16;

const AspectRatioSchema = z
  .union([z.string(), z.number().positive()])
  .describe('Target aspect ratio as width:height, e.g. "1:1", "4:3", "3:4", "16:9", "2:3", or a number such as 1.5');

const RectSchema = z
  .object({
    x: z.int().min(0),
    y: z.int().min(0),
    width: z.int().min(1),
    height: z.int().min(1),
  })
  .describe('Crop rectangle in pixels of the upright original, as returned by suggest_crop');

const NormalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .describe('Crop rectangle as fractions (0..1) of the upright original, as returned by suggest_crop');

export type CropSuggestionFace = {
  faceId: string;
  personId: string | null;
  name: string | null;
  included: boolean;
};

export type CropSuggestionResult = Omit<CropSuggestion, 'includedFaces' | 'droppedFaces'> & {
  assetId: string;
  /** upright dimensions of the original */
  width: number;
  height: number;
  /** the crop as fractions (0..1) of the original, for crops that are applied to other renditions */
  rectNormalized: CropRect;
  basis: 'faces' | 'saliency' | 'center';
  faces: CropSuggestionFace[];
};

export type CroppedCopyResult = {
  id: string;
  sourceId: string;
  width: number;
  height: number;
  /** an identical cropped copy already existed and was returned instead */
  duplicate: boolean;
};

export type CropInput = { aspectRatio?: number | string; rect?: CropRect; rectNormalized?: CropRect };

type CropAsset = NonNullable<Awaited<ReturnType<CropAgentTools['getAsset']>>>;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const clampRect = (rect: CropRect, width: number, height: number): CropRect => {
  const x = Math.min(Math.max(Math.round(rect.x), 0), width - 1);
  const y = Math.min(Math.max(Math.round(rect.y), 0), height - 1);
  return {
    x,
    y,
    width: Math.min(Math.max(Math.round(rect.width), 1), width - x),
    height: Math.min(Math.max(Math.round(rect.height), 1), height - y),
  };
};

/** Face-aware crop suggestions and cropped copies */
@Injectable()
export class CropAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'suggest_crop',
        title: 'Suggest crop',
        description:
          'Suggest a face-aware crop of a photo for an aspect ratio, without changing anything. Keeps faces whole with headroom, puts the eye line on the upper third and falls back to the most salient region when there are no faces. Returns the crop in original pixels (rect) and as fractions (rectNormalized), whether it is feasible, which faces it keeps, and a preview image of the crop to check it visually.',
        input: z.object({
          id: z.uuidv4().describe('Asset ID of the photo'),
          aspectRatio: AspectRatioSchema,
        }),
        mutating: false,
        handler: async ({ auth }, { id, aspectRatio }) => {
          try {
            const suggestion = await this.getCropSuggestion(auth, id, aspectRatio);
            const preview = await this.renderCropPreview(auth, id, suggestion.rectNormalized);
            return preview ? toolImage(preview, 'image/jpeg', suggestion) : toolJson(suggestion);
          } catch (error) {
            return toolError(`Could not suggest a crop for ${id}: ${errorMessage(error)}`);
          }
        },
      }),

      defineTool({
        name: 'crop_photo',
        title: 'Crop photo',
        description:
          'Create a cropped copy of a photo. The original is never changed: the copy is a new asset stacked with the original, which stays the primary asset of the stack. Pass either aspectRatio (uses the suggest_crop crop and fails if it is not feasible) or an explicit rect / rectNormalized. Returns the ID of the new asset.',
        input: z.object({
          id: z.uuidv4().describe('Asset ID of the photo'),
          aspectRatio: AspectRatioSchema.optional(),
          rect: RectSchema.optional(),
          rectNormalized: NormalizedRectSchema.optional(),
        }),
        mutating: true,
        handler: async ({ auth }, { id, ...crop }) => {
          try {
            return toolJson(await this.createCroppedCopy(auth, id, crop));
          } catch (error) {
            return toolError(`Could not crop ${id}: ${errorMessage(error)}`);
          }
        },
      }),
    ];
  }

  /** Computes a face-aware crop of an image asset, in original pixels and normalized, without rendering anything. */
  async getCropSuggestion(auth: AuthDto, assetId: string, aspectRatio: number | string): Promise<CropSuggestionResult> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    const asset = await this.getAsset(assetId);
    const { width, height } = this.getImageDimensions(asset);
    const ratio = parseAspectRatio(aspectRatio);

    const faces = await this.personRepository.getFaces(assetId, { viewingUserId: auth.user.id });
    const boxes = faces.map((face) =>
      scaleBox(
        { x1: face.boundingBoxX1, y1: face.boundingBoxY1, x2: face.boundingBoxX2, y2: face.boundingBoxY2 },
        { width: face.imageWidth, height: face.imageHeight },
        { width, height },
      ),
    );

    const point = boxes.length === 0 ? await this.getAttentionPoint(asset) : null;
    const saliency = point ? { x: point.x * width, y: point.y * height } : undefined;

    const {
      includedFaces,
      droppedFaces: _,
      ...suggestion
    } = suggestCrop({
      width,
      height,
      aspectRatio: ratio,
      faces: boxes,
      saliency,
    });
    const included = new Set(includedFaces);

    return {
      assetId,
      width,
      height,
      ...suggestion,
      rectNormalized: normalizeRect(suggestion.rect, width, height),
      basis: boxes.length > 0 ? 'faces' : saliency ? 'saliency' : 'center',
      faces: faces.map((face, index) => ({
        faceId: face.id,
        personId: face.personGroupId,
        name: face.person?.name || null,
        included: included.has(index),
      })),
    };
  }

  /** Crops the full-resolution original into a new asset, stacked with the original. */
  async createCroppedCopy(auth: AuthDto, assetId: string, crop: CropInput): Promise<CroppedCopyResult> {
    const modes = [crop.aspectRatio, crop.rect, crop.rectNormalized].filter((value) => value !== undefined);
    if (modes.length !== 1) {
      throw new BadRequestException('Pass exactly one of aspectRatio, rect or rectNormalized');
    }

    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [assetId] });

    const asset = await this.getAsset(assetId);
    const { width, height } = this.getImageDimensions(asset);
    const exifInfo = asset.exifInfo!;

    if (asset.originalFileName.toLowerCase().endsWith('.gif') || asset.originalPath.toLowerCase().endsWith('.gif')) {
      throw new BadRequestException('Cropping GIF images is not supported');
    }

    if (asset.originalFileName.toLowerCase().endsWith('.svg') || asset.originalPath.toLowerCase().endsWith('.svg')) {
      throw new BadRequestException('Cropping SVG images is not supported');
    }

    if (isPanorama({ projectionType: exifInfo.projectionType, originalFileName: asset.originalFileName })) {
      throw new BadRequestException('Cropping panorama images is not supported');
    }

    let rect: CropRect;
    if (crop.aspectRatio === undefined) {
      rect = crop.rect ?? {
        x: crop.rectNormalized!.x * width,
        y: crop.rectNormalized!.y * height,
        width: crop.rectNormalized!.width * width,
        height: crop.rectNormalized!.height * height,
      };
      if (rect.x + rect.width > width + 1 || rect.y + rect.height > height + 1) {
        throw new BadRequestException(`Crop is out of bounds of the ${width}x${height} image`);
      }
    } else {
      const suggestion = await this.getCropSuggestion(auth, assetId, crop.aspectRatio);
      if (!suggestion.feasible) {
        throw new BadRequestException(`${suggestion.reason}. Pass an explicit rect to crop anyway.`);
      }
      rect = suggestion.rect;
    }

    rect = clampRect(rect, width, height);
    if (rect.width < MIN_CROP_SIZE || rect.height < MIN_CROP_SIZE) {
      throw new BadRequestException(`Crop must be at least ${MIN_CROP_SIZE}x${MIN_CROP_SIZE} pixels`);
    }

    const { image } = await this.getConfig({ withCache: true });
    const decoded = await decodeOriginal(
      this.mediaRepository,
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo },
      image,
    );

    // the decoded image can differ in size from the original, e.g. for the embedded preview of a RAW file
    const scaleX = decoded.info.width / width;
    const scaleY = decoded.info.height / height;
    const scaled = clampRect(
      { x: rect.x * scaleX, y: rect.y * scaleY, width: rect.width * scaleX, height: rect.height * scaleY },
      decoded.info.width,
      decoded.info.height,
    );

    const output = await this.mediaRepository.cropImage(decoded, scaled, {
      colorspace: decoded.colorspace,
      quality: CROP_QUALITY,
    });

    const { id, duplicate } = await BaseService.create(DerivedAssetService, this).createDerivedAsset(
      auth,
      assetId,
      { buffer: output.data, extension: 'jpg' },
      { description: `Cropped from ${asset.originalFileName}`, suffix: 'crop', stack: true },
    );

    return { id, sourceId: assetId, width: output.width, height: output.height, duplicate };
  }

  /** Renders a normalized crop from the preview of an asset, for the agent to check visually */
  async renderCropPreview(auth: AuthDto, assetId: string, rect: CropRect): Promise<Buffer | null> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });
    const asset = await this.getAsset(assetId);
    const previewPath = this.getPreviewPath(asset);
    if (!previewPath) {
      return null;
    }

    const preview = await this.mediaRepository.decodeImage(previewPath, {
      colorspace: Colorspace.Srgb,
      processInvalidImages: false,
    });
    const { width, height } = preview.info;
    const crop = clampRect(
      { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height },
      width,
      height,
    );
    const { data } = await this.mediaRepository.cropImage(preview, crop, {
      colorspace: Colorspace.Srgb,
      quality: 80,
      size: CROP_PREVIEW_SIZE,
    });
    return data;
  }

  private async getAsset(assetId: string) {
    const asset = await this.assetRepository.getById(assetId, { exifInfo: true, files: true });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException('Asset not found');
    }

    if (asset.type !== AssetType.Image) {
      throw new BadRequestException('Only photos can be cropped');
    }

    return asset;
  }

  private getImageDimensions(asset: CropAsset) {
    const dimensions = asset.exifInfo ? getDimensions(asset.exifInfo) : { width: 0, height: 0 };
    if (!dimensions.width || !dimensions.height) {
      throw new BadRequestException('The dimensions of this photo are not known yet, try again later');
    }
    return dimensions;
  }

  private async getAttentionPoint(asset: CropAsset) {
    const previewPath = this.getPreviewPath(asset);
    if (!previewPath) {
      return null;
    }

    try {
      return await this.mediaRepository.getAttentionPoint(previewPath);
    } catch (error) {
      this.logger.warn(`Could not find the focal point of asset ${asset.id}: ${error}`);
      return null;
    }
  }

  private getPreviewPath(asset: CropAsset) {
    return asset.files?.find((file) => file.type === AssetFileType.Preview && !file.isEdited)?.path;
  }
}

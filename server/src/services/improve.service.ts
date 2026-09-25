import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetType, Permission } from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { Bitmap } from 'src/types.js';
import { analysisCache, getAnalysisKey, getSimulatedAnalysisKey, tiltCache } from 'src/utils/agent/analysis-cache.js';
import { CropRect } from 'src/utils/agent/crop.js';
import {
  IMPROVE_STEP_MARGIN,
  ImproveEstimate,
  ImproveRecipe,
  SIMULATED_CORRECTIONS,
  ScoreExtra,
  Size,
  chooseAspectCrop,
  chooseTighteningCrop,
  describeImprovement,
  getOverallScore,
  getPotentialScore,
  getRecipeKey,
  hasPrintResolution,
  isEmptyRecipe,
  mapFaces,
  toEstimate,
} from 'src/utils/agent/improve.js';
import { ImageAnalysis, ScoreFace, normalizeFaceBox } from 'src/utils/agent/scoring.js';
import { TiltEstimate, estimateTilt, getStraightenedSize } from 'src/utils/agent/straighten.js';
import { getDimensions, isPanorama } from 'src/utils/asset.util.js';
import { EnhanceCorrectionType, planEnhancement } from 'src/utils/enhance.js';
import { decodeOriginal } from 'src/utils/image-decode.js';

const IMPROVED_QUALITY = 93;
const SIMULATION_SIZE = 512;
const SIMULATION_CONCURRENCY = 4;
const SIMULATED_STRENGTH = 'normal';

type AgentAsset = Awaited<ReturnType<AssetJobRepository['getForAgent']>>[number];

/** what the simulation needs to know about a photo */
export type ImproveSource = {
  id: string;
  checksum: Buffer;
  previewPath: string | null;
  /** size of the upright original, 0 when unknown */
  width: number;
  height: number;
  faces: ScoreFace[];
  isFavorite?: boolean;
  rating?: number | null;
};

export type ImproveOptions = {
  /** crop to this aspect ratio (e.g. of a book slot) when it helps; default: only a tightening crop */
  aspectRatio?: number | string;
  /** print size of the crop, for the resolution guard */
  printMm?: Size;
  /** default true; false when the photo is cropped anyway, e.g. by a book slot */
  crop?: boolean;
};

export type ImprovedCopyResult = {
  id: string;
  sourceId: string;
  width: number;
  height: number;
  description: string;
  /** what was applied; the enhancement lists its corrections */
  applied: { rotate?: number; crop?: CropRect; enhance?: EnhanceCorrectionType[] };
  /** an identical improved copy already existed and was returned instead */
  duplicate: boolean;
};

export const toImproveSource = (row: AgentAsset): ImproveSource => ({
  id: row.id,
  checksum: row.checksum,
  previewPath: row.previewPath,
  width: row.width ?? row.exifImageWidth ?? 0,
  height: row.height ?? row.exifImageHeight ?? 0,
  faces: row.faces.map((face) => ({ ...normalizeFaceBox(face), personId: face.personId, name: face.name })),
  isFavorite: row.isFavorite,
  rating: row.rating,
});

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

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/**
 * Potential-aware photo selection: simulates the fixes the app can make (straightening, a crop, auto-enhance) on the
 * small preview of a photo and scores the result, and applies the fixes to the full-resolution original as one new
 * copy stacked with it.
 */
@Injectable()
export class ImproveService extends BaseService {
  /** the analysis of the preview as it is, cached */
  async getAnalysis(source: Pick<ImproveSource, 'id' | 'checksum' | 'previewPath'>): Promise<ImageAnalysis | null> {
    if (!source.previewPath) {
      return null;
    }

    const key = getAnalysisKey({ ...source, previewPath: source.previewPath });
    const cached = analysisCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const analysis = await this.mediaRepository.analyzeImage(source.previewPath);
      analysisCache.set(key, analysis);
      return analysis;
    } catch (error) {
      this.logger.warn(`Unable to analyze preview of asset ${source.id}: ${error}`);
      return null;
    }
  }

  estimateMany(sources: ImproveSource[], options: ImproveOptions = {}): Promise<Array<ImproveEstimate | null>> {
    return mapLimit(sources, SIMULATION_CONCURRENCY, (source) => this.estimate(source, options));
  }

  /**
   * Stage 2 for one photo: straightens it when the tilt is recommended, tries a crop, then auto-enhance, each on the
   * small preview, and keeps the fixes that raise the score by `IMPROVE_STEP_MARGIN` or more. Null without a preview.
   */
  async estimate(source: ImproveSource, options: ImproveOptions = {}): Promise<ImproveEstimate | null> {
    if (!source.previewPath) {
      return null;
    }

    const previewPath = source.previewPath;
    const asset = { ...source, previewPath };
    const extra: ScoreExtra = { isFavorite: source.isFavorite, rating: source.rating };
    const size = { width: source.width, height: source.height };
    // the preview is decoded once, small, for the analysis, the tilt and every simulated fix
    const bitmaps = new Map<string, Promise<Bitmap>>();

    let now = analysisCache.get(getAnalysisKey(asset));
    if (!now) {
      try {
        now = await this.mediaRepository.analyzeImage(await this.render(bitmaps, previewPath, {}, size));
        analysisCache.set(getAnalysisKey(asset), now);
      } catch (error) {
        this.logger.warn(`Unable to analyze preview of asset ${source.id}: ${error}`);
        return null;
      }
    }
    const nowScore = getOverallScore(now, source.faces, extra);

    try {
      const analyze = async (recipe: ImproveRecipe) => {
        const key = getSimulatedAnalysisKey(asset, getRecipeKey(recipe));
        let analysis = analysisCache.get(key);
        if (!analysis) {
          analysis = await this.mediaRepository.analyzeImage(await this.render(bitmaps, previewPath, recipe, size));
          analysisCache.set(key, analysis);
        }
        return analysis;
      };

      let recipe: ImproveRecipe = {};
      let best = nowScore;
      let bestAnalysis = now;
      let faces = source.faces;

      const tilt = await this.getTilt(asset, () => this.render(bitmaps, previewPath, {}, size));
      if (tilt?.recommended) {
        const candidate = { rotate: tilt.angle };
        const rotatedFaces = mapFaces(source.faces, candidate, size);
        const analysis = await analyze(candidate);
        const score = getPotentialScore(analysis, now, rotatedFaces, extra, candidate);
        if (score >= best + IMPROVE_STEP_MARGIN) {
          recipe = candidate;
          best = score;
          bestAnalysis = analysis;
          faces = rotatedFaces;
        }
      }

      if (options.crop !== false) {
        const frame = recipe.rotate ? getStraightenedSize(size.width, size.height, recipe.rotate) : size;
        const focus = { x: bestAnalysis.focusX, y: bestAnalysis.focusY };
        const crop =
          options.aspectRatio === undefined
            ? chooseTighteningCrop({ focus, faces })
            : chooseAspectCrop({ size: frame, aspectRatio: options.aspectRatio, focus, faces });
        if (crop && hasPrintResolution(crop, frame, options.printMm)) {
          const candidate = { ...recipe, crop };
          const croppedFaces = mapFaces(source.faces, candidate, size);
          const analysis = await analyze(candidate);
          const score = getPotentialScore(analysis, now, croppedFaces, extra, candidate);
          if (score >= best + IMPROVE_STEP_MARGIN) {
            recipe = candidate;
            best = score;
            bestAnalysis = analysis;
            faces = croppedFaces;
          }
        }
      }

      const candidate = { ...recipe, enhance: { strength: SIMULATED_STRENGTH } as const };
      const analysis = await analyze(candidate);
      const score = getPotentialScore(analysis, now, faces, extra, candidate);
      if (score >= best + IMPROVE_STEP_MARGIN) {
        recipe = candidate;
        best = score;
      }

      return toEstimate(nowScore, best, recipe);
    } catch (error) {
      this.logger.warn(`Unable to simulate improvements of asset ${source.id}: ${error}`);
      return toEstimate(nowScore, nowScore, {});
    }
  }

  /**
   * Creates one improved copy of a photo at full resolution: decoded once, straightened, cropped and enhanced, stacked
   * with the original (which is never changed). With 'auto' the fixes are chosen as by `estimate`.
   */
  async createImprovedCopy(
    auth: AuthDto,
    assetId: string,
    input: ImproveRecipe | 'auto',
    options: ImproveOptions = {},
  ): Promise<ImprovedCopyResult> {
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [assetId] });
    const asset = await this.getAsset(assetId);
    const exifInfo = asset.exifInfo!;

    let recipe: ImproveRecipe;
    if (input === 'auto') {
      const [row] = await this.assetJobRepository.getForAgent([assetId], auth.user.id);
      const estimate = row ? await this.estimate(toImproveSource(row), options) : null;
      if (!estimate) {
        throw new BadRequestException('The preview of this photo has not been generated yet, try again later');
      }
      recipe = estimate.recipe;
    } else {
      recipe = input;
    }
    if (isEmptyRecipe(recipe)) {
      throw new BadRequestException('This photo does not need to be improved');
    }

    const { image } = await this.getConfig({ withCache: true });
    const decoded = await decodeOriginal(
      this.mediaRepository,
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo },
      image,
    );

    const rotate = recipe.rotate ?? 0;
    const { width, height } = decoded.info;
    const frame = rotate ? getStraightenedSize(width, height, rotate) : { width, height };
    const crop = recipe.crop
      ? clampRect(
          {
            x: recipe.crop.x * frame.width,
            y: recipe.crop.y * frame.height,
            width: recipe.crop.width * frame.width,
            height: recipe.crop.height * frame.height,
          },
          Math.floor(frame.width),
          Math.floor(frame.height),
        )
      : null;

    let geometry: Bitmap = decoded;
    if (rotate) {
      geometry = await this.mediaRepository.straightenBitmap(decoded, rotate, crop);
    } else if (crop) {
      geometry = await this.mediaRepository.cropBitmap(decoded, crop);
    }

    let corrections: EnhanceCorrectionType[] = [];
    let output: { data: Buffer; width: number; height: number };
    if (recipe.enhance) {
      const stats = await this.mediaRepository.getEnhanceStats(geometry);
      const analysis = planEnhancement(stats, {
        strength: recipe.enhance.strength,
        outputSize: Math.max(geometry.info.width, geometry.info.height),
        iso: exifInfo.iso,
      });
      corrections = analysis.corrections.map(({ type }) => type);
      output =
        corrections.length > 0
          ? await this.mediaRepository.enhanceImage(geometry, analysis.plan, {
              colorspace: decoded.colorspace,
              quality: IMPROVED_QUALITY,
            })
          : await this.mediaRepository.encodeJpeg(geometry, {
              colorspace: decoded.colorspace,
              quality: IMPROVED_QUALITY,
            });
    } else {
      output = await this.mediaRepository.encodeJpeg(geometry, {
        colorspace: decoded.colorspace,
        quality: IMPROVED_QUALITY,
      });
    }

    if (!rotate && !crop && corrections.length === 0) {
      throw new BadRequestException('This photo does not need to be improved');
    }

    const description = describeImprovement(asset.originalFileName, { rotate, cropped: !!crop, corrections });
    const { id, duplicate } = await BaseService.create(DerivedAssetService, this).createDerivedAsset(
      auth,
      assetId,
      { buffer: output.data, extension: 'jpg' },
      { description, suffix: 'improved', stack: true },
    );

    return {
      id,
      sourceId: assetId,
      width: output.width,
      height: output.height,
      description,
      applied: {
        ...(rotate && { rotate }),
        ...(recipe.crop && { crop: recipe.crop }),
        ...(corrections.length > 0 && { enhance: corrections }),
      },
      duplicate,
    };
  }

  /** the measured tilt of the preview, cached; null when it can't be measured */
  private async getTilt(
    asset: { id: string; checksum: Buffer; previewPath: string },
    preview: () => Promise<Bitmap>,
  ): Promise<TiltEstimate | null> {
    const key = getAnalysisKey(asset);
    const cached = tiltCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const tilt = estimateTilt(await this.mediaRepository.getGrayscale(await preview(), SIMULATION_SIZE));
      tiltCache.set(key, tilt);
      return tilt;
    } catch (error) {
      this.logger.warn(`Could not measure the tilt of asset ${asset.id}: ${error}`);
      return null;
    }
  }

  /** the small preview after the fixes of a recipe, memoized in `bitmaps` */
  private render(
    bitmaps: Map<string, Promise<Bitmap>>,
    previewPath: string,
    recipe: ImproveRecipe,
    size: Size,
  ): Promise<Bitmap> {
    const key = getRecipeKey(recipe);
    let bitmap = bitmaps.get(key);
    if (!bitmap) {
      bitmap = this.renderSimulation(previewPath, recipe, size, (base) =>
        this.render(bitmaps, previewPath, base, size),
      );
      bitmaps.set(key, bitmap);
    }
    return bitmap;
  }

  /** builds on the rendering of the recipe without its last fix */
  private async renderSimulation(
    previewPath: string,
    recipe: ImproveRecipe,
    size: Size,
    render: (recipe: ImproveRecipe) => Promise<Bitmap>,
  ): Promise<Bitmap> {
    if (recipe.enhance) {
      const { enhance: _, ...geometry } = recipe;
      const base = await render(geometry);
      const stats = await this.mediaRepository.getEnhanceStats(base, SIMULATION_SIZE);
      const { plan, corrections } = planEnhancement(stats, {
        strength: recipe.enhance.strength,
        only: SIMULATED_CORRECTIONS,
        outputSize: Math.max(size.width, size.height) || undefined,
      });
      return corrections.length > 0 ? this.mediaRepository.enhanceBitmap(base, plan) : base;
    }

    if (recipe.crop) {
      const { crop, ...rest } = recipe;
      const base = await render(rest);
      const { width, height } = base.info;
      return this.mediaRepository.cropBitmap(
        base,
        clampRect(
          { x: crop.x * width, y: crop.y * height, width: crop.width * width, height: crop.height * height },
          width,
          height,
        ),
      );
    }

    const small = await this.mediaRepository.getSmallRgb(previewPath, SIMULATION_SIZE);
    return recipe.rotate ? this.mediaRepository.straightenBitmap(small, recipe.rotate, null) : small;
  }

  private async getAsset(assetId: string) {
    const asset = await this.assetRepository.getById(assetId, { exifInfo: true });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException('Asset not found');
    }

    if (asset.type !== AssetType.Image) {
      throw new BadRequestException('Only photos can be improved');
    }

    const names = [asset.originalFileName, asset.originalPath].map((name) => name.toLowerCase());
    if (names.some((name) => name.endsWith('.gif') || name.endsWith('.svg'))) {
      throw new BadRequestException('Improving GIF and SVG images is not supported');
    }

    if (!asset.exifInfo) {
      throw new BadRequestException('The metadata of this photo has not been extracted yet, try again later');
    }

    if (isPanorama({ projectionType: asset.exifInfo.projectionType, originalFileName: asset.originalFileName })) {
      throw new BadRequestException('Improving panorama images is not supported');
    }

    const { width, height } = getDimensions(asset.exifInfo);
    if (!width || !height) {
      throw new BadRequestException('The dimensions of this photo are not known yet, try again later');
    }

    return asset;
  }
}

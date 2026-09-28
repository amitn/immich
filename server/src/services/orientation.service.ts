import { BadRequestException, Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { BulkIdErrorReason, BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { AssetEditActionItem } from 'src/dtos/editing.dto.js';
import {
  OrientationFixDto,
  OrientationRecord,
  OrientationScanDto,
  OrientationSuggestionResponseDto,
  mapOrientationSuggestion,
} from 'src/dtos/orientation.dto.js';
import {
  AssetMetadataKey,
  JobName,
  JobStatus,
  OrientationStatus,
  Permission,
  QueueName,
  SystemMetadataKey,
} from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { AssetService } from 'src/services/asset.service.js';
import { BaseService } from 'src/services/base.service.js';
import { LocalFiles } from 'src/utils/local-files.js';
import { isFacialRecognitionEnabled, isOcrEnabled, isSmartSearchEnabled } from 'src/utils/misc.js';
import {
  OrientationFace,
  OrientationPrompts,
  OrientationResult,
  OrientationText,
  Rotation,
  addRotation,
  detectOrientation,
  getOrientationPromptTexts,
  getOrientationPrompts,
} from 'src/utils/orientation.js';
import { requireNotSharedLink } from 'src/utils/shared-link.js';

/** photos looked at per user each night: the new uploads, oldest first */
export const NIGHTLY_ORIENTATION_LIMIT = 500;
/** photos looked at by a check the user asked for, newest first */
export const SCAN_ORIENTATION_LIMIT = 5000;
/** photos looked at by the assistant at once */
export const LIVE_ORIENTATION_LIMIT = 100;
/** the first nightly check looks at the uploads of this many days */
const FIRST_NIGHT_DAYS = 30;
const BATCH_SIZE = 200;

const ORIENTATION_KEY = AssetMetadataKey.Orientation;

type CheckAsset = Awaited<ReturnType<AssetRepository['getForOrientationCheck']>>[number];

/** the prompts of every CLIP model used so far */
const promptCache = new Map<string, Promise<OrientationPrompts>>();

const parseEmbedding = (value: unknown): Float32Array | null => {
  try {
    const values = typeof value === 'string' ? (JSON.parse(value) as number[]) : (value as number[]);
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    const vector = Float32Array.from(values);
    const norm = Math.hypot(...vector) || 1;
    return vector.map((item) => item / norm);
  } catch {
    return null;
  }
};

/**
 * Photos stored sideways or upside down: a background check (every night for the new uploads, or for a scope the user
 * asks for) suggests a turn for the confident cases (see `detectOrientation`), and the user fixes them with Immich's own
 * edits (a rotate edit, reversible), never with a copy. The suggestions and their review are kept in the metadata of
 * the assets (`immich.orientation`); photos checked and found upright leave no trace.
 */
@Injectable()
export class OrientationService extends BaseService {
  @OnJob({ name: JobName.OrientationCheckQueueAll, queue: QueueName.BackgroundTask })
  async handleQueueAll(): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const users = await this.userRepository.getList({ withDeleted: false });
    await this.jobRepository.queueAll(
      users.map((user) => ({ name: JobName.OrientationCheck, data: { userId: user.id, nightly: true } })),
    );
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.OrientationCheck, queue: QueueName.BackgroundTask })
  async handleCheck({ userId, nightly, albumId, takenAfter, takenBefore }: JobOf<JobName.OrientationCheck>) {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let flagged = 0;
    let checked = 0;
    if (nightly) {
      const state = (await this.systemMetadataRepository.get(SystemMetadataKey.OrientationCheckState)) ?? {};
      const cursor = state.users?.[userId]
        ? new Date(state.users[userId])
        : new Date(Date.now() - FIRST_NIGHT_DAYS * 24 * 60 * 60 * 1000);
      const assets = await this.assetRepository.getForOrientationCheck(userId, {
        key: ORIENTATION_KEY,
        limit: NIGHTLY_ORIENTATION_LIMIT,
        createdAfter: cursor,
      });
      for (const asset of assets) {
        flagged += (await this.checkAndRecord(asset, machineLearning)) ? 1 : 0;
      }
      checked = assets.length;
      const last = assets.at(-1);
      if (last) {
        const latest = (await this.systemMetadataRepository.get(SystemMetadataKey.OrientationCheckState)) ?? {};
        await this.systemMetadataRepository.set(SystemMetadataKey.OrientationCheckState, {
          users: { ...latest.users, [userId]: new Date(last.createdAt).toISOString() },
        });
      }
    } else {
      let before = takenBefore ? new Date(takenBefore) : undefined;
      while (checked < SCAN_ORIENTATION_LIMIT) {
        const assets = await this.assetRepository.getForOrientationCheck(userId, {
          key: ORIENTATION_KEY,
          limit: Math.min(BATCH_SIZE, SCAN_ORIENTATION_LIMIT - checked),
          albumId,
          takenAfter: takenAfter ? new Date(takenAfter) : undefined,
          takenBefore: before,
        });
        for (const asset of assets) {
          flagged += (await this.checkAndRecord(asset, machineLearning)) ? 1 : 0;
        }
        checked += assets.length;
        if (assets.length < BATCH_SIZE) {
          break;
        }
        before = new Date(assets.at(-1)!.fileCreatedAt);
      }
    }

    this.logger.log(`Checked the orientation of ${checked} photos of user ${userId}: ${flagged} to turn`);
    return JobStatus.Success;
  }

  /** checks the photos of a scope in the background: all, an album or the photos taken in a date range */
  async scan(auth: AuthDto, dto: OrientationScanDto): Promise<void> {
    requireNotSharedLink(auth);
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search (CLIP) must be enabled to check the orientation of photos');
    }
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    }
    await this.jobRepository.queue({
      name: JobName.OrientationCheck,
      data: {
        userId: auth.user.id,
        albumId: dto.albumId,
        takenAfter: dto.takenAfter?.toISOString(),
        takenBefore: dto.takenBefore?.toISOString(),
      },
    });
  }

  async getSuggestions(
    auth: AuthDto,
    status: OrientationStatus = OrientationStatus.Suggested,
  ): Promise<OrientationSuggestionResponseDto[]> {
    requireNotSharedLink(auth);
    const rows = await this.assetRepository.getMetadataByKeyForUser(auth.user.id, ORIENTATION_KEY);
    return rows.map((row) => mapOrientationSuggestion(row)).filter((item) => item.status === status);
  }

  /**
   * Checks photos now, without storing anything (for the assistant): the given photos, or those of a scope, at most
   * `LIVE_ORIENTATION_LIMIT`; only the ones to turn are returned
   */
  async find(
    auth: AuthDto,
    scope: { assetIds?: string[]; albumId?: string; takenAfter?: Date; takenBefore?: Date },
  ): Promise<Array<{ assetId: string } & Pick<OrientationResult, 'rotate' | 'confidence' | 'reasons'>>> {
    requireNotSharedLink(auth);
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search (CLIP) must be enabled to check the orientation of photos');
    }
    if (scope.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [scope.albumId] });
    }

    // only the user's own photos can be turned, suggested or not
    const assets: CheckAsset[] = await this.assetRepository.getForOrientationCheck(
      auth.user.id,
      scope.assetIds
        ? { assetIds: scope.assetIds.slice(0, LIVE_ORIENTATION_LIMIT), limit: LIVE_ORIENTATION_LIMIT }
        : {
            key: ORIENTATION_KEY,
            limit: LIVE_ORIENTATION_LIMIT,
            albumId: scope.albumId,
            takenAfter: scope.takenAfter,
            takenBefore: scope.takenBefore,
          },
    );

    const results = [];
    for (const asset of assets) {
      const result = await this.check(asset, machineLearning);
      if (result?.flagged) {
        results.push({
          assetId: asset.id,
          rotate: result.rotate,
          confidence: result.confidence,
          reasons: result.reasons,
        });
      }
    }
    return results;
  }

  /**
   * Checks the user's own photos now and records the confident suggestions, e.g. the photos the assistant found before
   * it fixes them; the number of photos to turn
   */
  async suggest(auth: AuthDto, assetIds: string[]): Promise<number> {
    requireNotSharedLink(auth);
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search (CLIP) must be enabled to check the orientation of photos');
    }
    const assets = await this.assetRepository.getForOrientationCheck(auth.user.id, {
      assetIds: assetIds.slice(0, LIVE_ORIENTATION_LIMIT),
      limit: LIVE_ORIENTATION_LIMIT,
    });
    let flagged = 0;
    for (const asset of assets) {
      flagged += (await this.checkAndRecord(asset, machineLearning)) ? 1 : 0;
    }
    return flagged;
  }

  /** turns photos with a rotate edit: by the suggested turn, or by `rotate` */
  async fix(auth: AuthDto, dto: OrientationFixDto): Promise<BulkIdResponseDto[]> {
    return this.review(auth, dto.assetIds, Permission.AssetEditCreate, async (id, record) => {
      const rotate = (dto.rotate ?? record?.rotate) as Rotation | undefined;
      if (!rotate || (!dto.rotate && record?.status !== OrientationStatus.Suggested)) {
        return 'Nothing to fix: the photo has no suggested turn';
      }
      await this.turn(auth, id, rotate);
      return {
        status: OrientationStatus.Fixed,
        rotate,
        confidence: record?.confidence ?? 1,
        reasons: record?.reasons ?? [],
        checkedAt: record?.checkedAt ?? new Date().toISOString(),
      };
    });
  }

  /** keeps photos as they are: their suggestions are not made again */
  async reject(auth: AuthDto, assetIds: string[]): Promise<BulkIdResponseDto[]> {
    return this.review(auth, assetIds, Permission.AssetUpdate, (_, record) => {
      if (!record) {
        return Promise.resolve('Nothing to reject: the photo has no suggested turn');
      }
      return Promise.resolve({ ...record, status: OrientationStatus.Rejected });
    });
  }

  /** turns fixed photos back, and suggests the turn again */
  async undo(auth: AuthDto, assetIds: string[]): Promise<BulkIdResponseDto[]> {
    return this.review(auth, assetIds, Permission.AssetEditCreate, async (id, record) => {
      if (record?.status !== OrientationStatus.Fixed) {
        return 'Nothing to undo: the photo was not turned';
      }
      await this.turn(auth, id, ((360 - record.rotate) % 360) as Rotation);
      return { ...record, status: OrientationStatus.Suggested };
    });
  }

  private async review(
    auth: AuthDto,
    assetIds: string[],
    permission: Permission,
    handler: (id: string, record: OrientationRecord | undefined) => Promise<OrientationRecord | string>,
  ): Promise<BulkIdResponseDto[]> {
    requireNotSharedLink(auth);
    const allowed = await this.checkAccess({ auth, permission, ids: new Set(assetIds) });
    const results: BulkIdResponseDto[] = [];
    for (const id of assetIds) {
      if (!allowed.has(id)) {
        results.push({ id, success: false, error: BulkIdErrorReason.NO_PERMISSION });
        continue;
      }
      try {
        const row = await this.assetRepository.getMetadataByKey(id, ORIENTATION_KEY);
        const outcome = await handler(id, row?.value as OrientationRecord | undefined);
        if (typeof outcome === 'string') {
          results.push({ id, success: false, error: BulkIdErrorReason.VALIDATION, errorMessage: outcome });
          continue;
        }
        await this.assetRepository.upsertMetadata(id, [
          { key: ORIENTATION_KEY, value: { ...outcome, reviewedAt: new Date().toISOString() } },
        ]);
        results.push({ id, success: true });
      } catch (error: any) {
        results.push({
          id,
          success: false,
          error: BulkIdErrorReason.UNKNOWN,
          errorMessage: error?.response?.message ?? error?.message ?? String(error),
        });
      }
    }
    return results;
  }

  /** adds a clockwise turn to the edits of a photo, through the asset edit endpoint's checks */
  private async turn(auth: AuthDto, id: string, rotate: Rotation) {
    const current = await this.assetEditRepository.getAll(id);
    const edits = addRotation(
      current.map(({ action, parameters }) => ({ action, parameters }) as AssetEditActionItem),
      rotate,
    );
    const assets = BaseService.create(AssetService, this);
    await (edits.length > 0 ? assets.editAsset(auth, id, { edits }) : assets.removeAssetEdits(auth, id));
  }

  /** checks a photo and stores a suggestion when it should be turned; true when it should */
  private async checkAndRecord(asset: CheckAsset, machineLearning: SystemConfig['machineLearning']) {
    const result = await this.check(asset, machineLearning);
    if (!result?.flagged) {
      return false;
    }
    const record: OrientationRecord = {
      status: OrientationStatus.Suggested,
      rotate: result.rotate,
      confidence: result.confidence,
      reasons: result.reasons,
      checkedAt: new Date().toISOString(),
    };
    await this.assetRepository.upsertMetadata(asset.id, [{ key: ORIENTATION_KEY, value: record }]);
    return true;
  }

  private async check(asset: CheckAsset, machineLearning: SystemConfig['machineLearning']) {
    const previewPath = asset.previewPath;
    if (!previewPath) {
      return null;
    }

    // the preview is fetched from its storage backend once, when a turned view is first needed
    const files = new LocalFiles((path) => this.ensureLocalFile(path));
    try {
      const prompts = await this.getPrompts(machineLearning);
      const turned = new Map<Rotation, Promise<Buffer>>();
      const view = (rotation: Rotation) => {
        let image = turned.get(rotation);
        if (!image) {
          image = files.get(previewPath).then((path) => this.mediaRepository.turnToJpeg(path, rotation));
          turned.set(rotation, image);
        }
        return image;
      };
      const encode = async (rotation: Rotation) =>
        parseEmbedding(await this.machineLearningRepository.encodeImage(await view(rotation), machineLearning.clip))!;
      const stored = parseEmbedding(asset.embedding);
      const faceOptions = {
        modelName: machineLearning.facialRecognition.modelName,
        minScore: machineLearning.facialRecognition.minScore,
      };

      return await detectOrientation(
        {
          width: asset.width ?? 0,
          height: asset.height ?? 0,
          getClip: async (rotation) => {
            if (rotation === 0 && stored && stored.length === prompts.upright.length) {
              return stored;
            }
            return encode(rotation);
          },
          getFaces: async (rotation) => {
            if (!isFacialRecognitionEnabled(machineLearning)) {
              return null;
            }
            if (rotation === 0) {
              return asset.facesRecognizedAt ? this.getStoredFaces(asset.id) : null;
            }
            const { faces, imageWidth, imageHeight } = await this.machineLearningRepository.detectFaces(
              await view(rotation),
              faceOptions,
            );
            return faces.map(({ boundingBox, score }): OrientationFace => ({
              x1: boundingBox.x1 / imageWidth,
              y1: boundingBox.y1 / imageHeight,
              x2: boundingBox.x2 / imageWidth,
              y2: boundingBox.y2 / imageHeight,
              score,
            }));
          },
          getText: async (rotation) => {
            if (!isOcrEnabled(machineLearning)) {
              return null;
            }
            if (rotation === 0) {
              return asset.ocrAt ? this.getStoredText(asset.id) : null;
            }
            const ocr = await this.machineLearningRepository.ocr(await view(rotation), machineLearning.ocr);
            return ocr.text.map((text, i): OrientationText => {
              const [x1, y1, x2, y2, x3, y3, x4, y4] = ocr.box.slice(i * 8, i * 8 + 8);
              return { x1, y1, x2, y2, x3, y3, x4, y4, textScore: ocr.textScore[i], length: text.length };
            });
          },
        },
        prompts,
      );
    } catch (error: any) {
      this.logger.warn(`Unable to check the orientation of asset ${asset.id}: ${error?.message ?? error}`);
      return null;
    } finally {
      await files.cleanup();
    }
  }

  private async getStoredFaces(assetId: string): Promise<OrientationFace[]> {
    const faces = await this.bookRepository.getFaces([assetId]);
    return faces
      .filter((face) => face.imageWidth > 0 && face.imageHeight > 0)
      .map((face) => ({
        x1: face.boundingBoxX1 / face.imageWidth,
        y1: face.boundingBoxY1 / face.imageHeight,
        x2: face.boundingBoxX2 / face.imageWidth,
        y2: face.boundingBoxY2 / face.imageHeight,
        // stored faces passed the minimum score of face detection
        score: 1,
      }));
  }

  private async getStoredText(assetId: string): Promise<OrientationText[]> {
    const boxes = await this.ocrRepository.getByAssetId(assetId);
    return boxes.map(({ x1, y1, x2, y2, x3, y3, x4, y4, textScore, text }) => ({
      x1,
      y1,
      x2,
      y2,
      x3,
      y3,
      x4,
      y4,
      textScore,
      length: text.length,
    }));
  }

  private getPrompts(machineLearning: SystemConfig['machineLearning']) {
    const { modelName } = machineLearning.clip;
    let prompts = promptCache.get(modelName);
    if (!prompts) {
      prompts = (async () => {
        const texts = new Map<string, Float32Array>();
        for (const text of getOrientationPromptTexts()) {
          const embedding = parseEmbedding(await this.machineLearningRepository.encodeText(text, { modelName }));
          if (!embedding) {
            throw new Error(`Unable to encode "${text}"`);
          }
          texts.set(text, embedding);
        }
        return getOrientationPrompts(texts);
      })();
      prompts.catch(() => promptCache.delete(modelName));
      promptCache.set(modelName, prompts);
    }
    return prompts;
  }
}

/** for tests */
export const clearOrientationPrompts = () => promptCache.clear();

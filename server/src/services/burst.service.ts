import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  BurstCleanDto,
  BurstCleanGroup,
  BurstCleanGroupResult,
  BurstCleanResponseDto,
  BurstGroupResponseDto,
  BurstRulesInput,
  BurstSearchDto,
  BurstSearchResponseDto,
} from 'src/dtos/burst.dto.js';
import { ActivityLogAction, AssetType, AssetVisibility, Permission } from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetService } from 'src/services/asset.service.js';
import { BaseService } from 'src/services/base.service.js';
import { StackService } from 'src/services/stack.service.js';
import { ActivityRecorder, ActivityUndoMap, countPhotos, recordActivity } from 'src/utils/activity-log.js';
import { analysisCache, getAnalysisKey } from 'src/utils/agent/analysis-cache.js';
import {
  BurstCandidate,
  BurstGroupDraft,
  BurstRules,
  BurstScanAsset,
  clusterBursts,
  getBurstCandidates,
  getBurstDefaults,
  partitionBurstScan,
  rankBurst,
  toBurstDrafts,
  toBurstRules,
} from 'src/utils/agent/bursts.js';
import { parseEmbedding } from 'src/utils/agent/clustering.js';
import { ImageAnalysis, normalizeFaceBox, scorePhoto } from 'src/utils/agent/scoring.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { requireNotSharedLink } from 'src/utils/shared-link.js';

/** the newest photos of a scope that one search looks at */
export const BURST_SCAN_LIMIT = 50_000;
/** the most groups the assistant ranks (and cleans up) in one call */
export const BURST_TOOL_MAX_GROUPS = 200;

const DEFAULT_PAGE_SIZE = 20;
const CHUNK = 1000;

export type BurstScope = { albumId?: string; takenAfter?: Date; takenBefore?: Date };

type ScanRow = Awaited<ReturnType<AssetJobRepository['getForBurstScan']>>[number];
type AgentRow = Awaited<ReturnType<AssetJobRepository['getForAgent']>>[number];

type Scan = {
  /** every group with at least one photo of the user, newest first */
  drafts: BurstGroupDraft[];
  rows: Map<string, ScanRow>;
  scanned: number;
  truncated: boolean;
};

/** the archive of one group: what a cleanup did, as the activity log keeps it to undo it */
export type BurstCleanupGroupRecord = ActivityUndoMap[ActivityLogAction.BurstCleanup]['groups'][number];

const unique = <T>(values: T[]) => [...new Set(values)];

const chunks = <T>(values: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

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

const toNumber = (value: string | number | bigint | null | undefined) => (value === null || value === undefined ? 0 : Number(value));

const dimensionsOf = (row: ScanRow) => ({
  width: row.width ?? row.exifImageWidth ?? null,
  height: row.height ?? row.exifImageHeight ?? null,
});

/** "a burst", "3 bursts" */
const countGroups = (count: number) => (count === 1 ? 'a burst' : `${count} bursts`);

export const getBurstCleanupSummary = (groups: number, archived: number) =>
  `Kept the best photo of ${countGroups(groups)} and archived ${countPhotos(archived)}`;

/**
 * Burst cleanup (#9): finds groups of near-identical photos (noodle's duplicate groups and stacks, and bursts taken
 * seconds apart that are in neither), ranks each with the quality score after the user's rules, and archives all but
 * the photo to keep. Nothing is trashed, so the duplicate detection's checksum tombstones never apply; a duplicate group
 * stays as it is (noodle's resolve only trashes), with its archived photos. Only the user's own photos are archived
 * (#21): a group with photos of others is shown read-only.
 */
@Injectable()
export class BurstService extends BaseService {
  async search(auth: AuthDto, dto: BurstSearchDto): Promise<BurstSearchResponseDto> {
    const scan = await this.scan(auth, dto);
    const size = dto.size ?? DEFAULT_PAGE_SIZE;
    const start = ((dto.page ?? 1) - 1) * size;
    const page = scan.drafts.slice(start, start + size);
    const groups = await this.rank(auth, page, scan.rows, toBurstRules(dto.rules));

    return {
      groups,
      total: scan.drafts.length,
      totalToArchive: this.countToArchive(auth, scan),
      scanned: scan.scanned,
      truncated: scan.truncated,
      hasNextPage: start + size < scan.drafts.length,
    };
  }

  /** every group of a scope, ranked, at most `limit` (the newest); for the assistant */
  async find(auth: AuthDto, scope: BurstScope & { rules?: BurstRulesInput; limit?: number }) {
    const scan = await this.scan(auth, scope);
    const limit = scope.limit ?? BURST_TOOL_MAX_GROUPS;
    const groups = await this.rank(auth, scan.drafts.slice(0, limit), scan.rows, toBurstRules(scope.rules));
    return {
      groups,
      total: scan.drafts.length,
      totalToArchive: this.countToArchive(auth, scan),
      scanned: scan.scanned,
      truncated: scan.truncated,
    };
  }

  /**
   * Keeps the given photo of each group and archives the others: only the user's own photos that are on the timeline
   * (a group with photos of others is skipped), and never the head of a stack the kept photo is not in, which would
   * hide the whole stack. A kept photo whose stack was headed by an archived one becomes its head. The cleanup is one
   * change of the activity log, which undoing un-archives exactly those photos.
   */
  async clean(auth: AuthDto, dto: BurstCleanDto, recorder?: ActivityRecorder): Promise<BurstCleanResponseDto> {
    requireNotSharedLink(auth);
    const allIds = unique(dto.groups.flatMap(({ assetIds }) => assetIds));
    const owned = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids: allIds });
    const assets = new Map<string, { visibility: AssetVisibility; deletedAt: Date | null; stackId: string | null }>();
    for (const ids of chunks(allIds)) {
      for (const asset of await this.assetRepository.getByIds(ids)) {
        assets.set(asset.id, asset);
      }
    }

    const stackIds = unique(
      allIds.map((id) => assets.get(id)?.stackId).filter((id): id is string => !!id),
    );
    const primaries = new Map<string, string>();
    for (const stackId of stackIds) {
      const stack = await this.stackRepository.getById(stackId);
      if (stack) {
        primaries.set(stackId, stack.primaryAssetId);
      }
    }

    const taken = new Set<string>();
    const results: BurstCleanGroupResult[] = [];
    const records: BurstCleanupGroupRecord[] = [];
    for (const group of dto.groups) {
      const outcome = this.planGroup(group, { owned, assets, primaries, taken });
      results.push(outcome.result);
      if (outcome.record) {
        records.push(outcome.record);
        for (const id of [outcome.record.keepAssetId, ...outcome.record.archivedAssetIds]) {
          taken.add(id);
        }
      }
    }

    const archive = records.flatMap(({ archivedAssetIds }) => archivedAssetIds);
    if (dto.dryRun || archive.length === 0) {
      return { dryRun: !!dto.dryRun, groups: results, archived: archive.length, activityId: null };
    }

    const stackService = BaseService.create(StackService, this);
    for (const { keepAssetId, stack } of records) {
      if (stack) {
        await stackService.update(auth, stack.stackId, { primaryAssetId: keepAssetId });
      }
    }
    const assetService = BaseService.create(AssetService, this);
    for (const ids of chunks(archive)) {
      await assetService.updateAll(auth, { ids, visibility: AssetVisibility.Archive });
    }

    const activityId = await recordActivity(
      { repository: this.activityLogRepository, logger: this.logger },
      auth.user.id,
      recorder,
      {
        action: ActivityLogAction.BurstCleanup,
        summary: getBurstCleanupSummary(records.length, archive.length),
        assetIds: archive,
        undo: { groups: records },
      },
    );

    return { dryRun: false, groups: results, archived: archive.length, activityId: activityId ?? null };
  }

  private planGroup(
    group: BurstCleanGroup,
    state: {
      owned: Set<string>;
      assets: Map<string, { visibility: AssetVisibility; deletedAt: Date | null; stackId: string | null }>;
      primaries: Map<string, string>;
      taken: Set<string>;
    },
  ): { result: BurstCleanGroupResult; record?: BurstCleanupGroupRecord } {
    const { keepAssetId } = group;
    const skip = (error: string) => ({ result: { keepAssetId, archivedAssetIds: [], error } });
    const ids = unique(group.assetIds);

    if (ids.some((id) => !state.owned.has(id))) {
      return skip('Some of the photos belong to someone else, so the group is left as it is');
    }
    const keeper = state.assets.get(keepAssetId);
    if (!keeper || keeper.deletedAt) {
      return skip('The photo to keep is no longer in the library');
    }
    if (ids.some((id) => state.taken.has(id))) {
      return skip('Some of the photos are in another group of this cleanup');
    }

    const keeperStack = keeper.stackId;
    let stack: BurstCleanupGroupRecord['stack'];
    const archived: string[] = [];
    for (const id of ids) {
      const asset = state.assets.get(id);
      if (id === keepAssetId || !asset || asset.deletedAt || asset.visibility !== AssetVisibility.Timeline) {
        continue;
      }
      const headsStack = !!asset.stackId && state.primaries.get(asset.stackId) === id;
      if (headsStack && asset.stackId !== keeperStack) {
        // archiving the head of a stack would hide all of it
        continue;
      }
      if (headsStack && keeperStack) {
        stack = { stackId: keeperStack, previousPrimaryAssetId: id };
      }
      archived.push(id);
    }

    if (archived.length === 0) {
      return skip('Nothing to archive: the other photos are no longer on the timeline');
    }
    return {
      result: { keepAssetId, archivedAssetIds: archived },
      record: { keepAssetId, archivedAssetIds: archived, ...(stack && { stack }) },
    };
  }

  private async scan(auth: AuthDto, scope: BurstScope): Promise<Scan> {
    requireNotSharedLink(auth);
    if (scope.takenAfter && scope.takenBefore && scope.takenAfter >= scope.takenBefore) {
      throw new BadRequestException('takenAfter must be before takenBefore');
    }
    if (scope.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [scope.albumId] });
    }

    const result = await this.assetJobRepository.getForBurstScan({
      userId: auth.user.id,
      albumId: scope.albumId,
      takenAfter: scope.takenAfter,
      takenBefore: scope.takenBefore,
      limit: BURST_SCAN_LIMIT + 1,
    });
    const truncated = result.length > BURST_SCAN_LIMIT;
    const scanRows = result.slice(0, BURST_SCAN_LIMIT);
    const rows = new Map(scanRows.map((row) => [row.id, row]));
    const assets = new Map<string, BurstScanAsset>(
      scanRows.map((row) => [
        row.id,
        {
          id: row.id,
          ownerId: row.ownerId,
          time: row.fileCreatedAt.getTime(),
          isImage: row.type === AssetType.Image,
          duplicateId: row.duplicateId,
          stackId: row.stackId,
          isCopy: !!row.isCopy,
        },
      ]),
    );

    const { groups, rest } = partitionBurstScan([...assets.values()]);
    const { machineLearning } = await this.getConfig({ withCache: true });
    const options = getBurstDefaults(machineLearning.duplicateDetection.maxDistance);
    const candidates = [...getBurstCandidates(rest, options.maxSeconds)];
    const embeddings = new Map<string, Float32Array>();
    for (const ids of chunks(candidates)) {
      for (const { assetId, embedding } of await this.searchRepository.getEmbeddings(ids)) {
        embeddings.set(assetId, parseEmbedding(embedding));
      }
    }
    const bursts = clusterBursts(
      candidates.map((id) => ({ id, time: assets.get(id)!.time, embedding: embeddings.get(id) })),
      options,
    );

    const drafts = [...groups, ...toBurstDrafts(bursts, assets)]
      // a group of others' photos only (e.g. in a shared album) is theirs to clean up
      .filter(({ assetIds }) => assetIds.some((id) => rows.get(id)?.ownerId === auth.user.id))
      .toSorted((a, b) => b.time - a.time || a.key.localeCompare(b.key));

    return { drafts, rows, scanned: scanRows.length, truncated };
  }

  /** the photos that cleaning up every group of a scan would archive */
  private countToArchive(auth: AuthDto, scan: Scan) {
    return scan.drafts
      .filter((draft) => !this.isReadOnly(auth, draft, scan.rows))
      .reduce((sum, { assetIds }) => sum + assetIds.length - 1, 0);
  }

  private isReadOnly(auth: AuthDto, draft: BurstGroupDraft, rows: Map<string, ScanRow>) {
    return draft.assetIds.some((id) => rows.get(id)?.ownerId !== auth.user.id);
  }

  private async rank(
    auth: AuthDto,
    drafts: BurstGroupDraft[],
    rows: Map<string, ScanRow>,
    rules: BurstRules,
  ): Promise<BurstGroupResponseDto[]> {
    const ids = unique(drafts.flatMap(({ assetIds }) => assetIds));
    const agentRows = new Map<string, AgentRow>();
    for (const chunk of chunks(ids)) {
      for (const row of await this.assetJobRepository.getForAgent(chunk, auth.user.id)) {
        agentRows.set(row.id, row);
      }
    }
    const analyses = new Map<string, ImageAnalysis | null>();
    await mapLimit(ids, 4, async (id) => {
      const row = agentRows.get(id);
      analyses.set(id, row ? await this.getAnalysis(row) : null);
    });

    return drafts.map((draft) => {
      const candidates: BurstCandidate[] = [];
      const photos = new Map<string, BurstGroupResponseDto['assets'][number]>();
      for (const id of draft.assetIds) {
        const row = rows.get(id)!;
        const agent = agentRows.get(id);
        const { width, height } = dimensionsOf(row);
        const score = scorePhoto(
          analyses.get(id) ?? null,
          (agent?.faces ?? []).map((face) => ({ ...normalizeFaceBox(face), personId: face.personId, name: face.name })),
          { isFavorite: agent?.isFavorite, rating: agent?.rating },
        );
        const isRaw = mimeTypes.isRaw(row.originalFileName);
        const fileSize = toNumber(row.fileSizeInByte);
        candidates.push({
          id,
          isRaw,
          isEdited: row.isEdited,
          pixels: (width ?? 0) * (height ?? 0),
          fileSize,
          isFavorite: !!agent?.isFavorite,
          rating: agent?.rating ?? null,
          score,
        });
        photos.set(id, {
          assetId: id,
          isOwned: row.ownerId === auth.user.id,
          isRaw,
          isEdited: row.isEdited,
          width,
          height,
          fileSize: fileSize || null,
          sharpness: score.sharpness,
          exposure: score.exposure,
          faces: score.faces,
          score: score.overall,
        });
      }

      const ranking = rankBurst(candidates, rules);
      const readOnly = this.isReadOnly(auth, draft, rows);
      return {
        key: draft.key,
        source: draft.source,
        duplicateId: draft.duplicateId,
        stackId: draft.stackId,
        takenAt: new Date(draft.time),
        assets: ranking.order.map((id) => photos.get(id)!),
        keepAssetId: ranking.keepId,
        reasons: ranking.reasons,
        archiveAssetIds: readOnly ? [] : ranking.order.filter((id) => id !== ranking.keepId),
        readOnly,
      };
    });
  }

  private async getAnalysis(row: AgentRow): Promise<ImageAnalysis | null> {
    if (!row.previewPath) {
      return null;
    }

    const key = getAnalysisKey({ ...row, previewPath: row.previewPath });
    const cached = analysisCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const analysis = await this.withLocalFile(row.previewPath, (path) => this.mediaRepository.analyzeImage(path));
      analysisCache.set(key, analysis);
      return analysis;
    } catch (error) {
      this.logger.warn(`Unable to analyze preview of asset ${row.id}: ${error}`);
      return null;
    }
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetType, Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { MemoryExclusions, hasMemoryExclusions } from 'src/utils/memory-exclusions.js';
import { MemorySource, getMemorySource } from 'src/utils/memory-source.js';
import { requireNotSharedLink } from 'src/utils/shared-link.js';

export type MemorySourceAsset = { id: string; type: AssetType; time: number };

export type ResolvedMemorySource = {
  source: MemorySource;
  /** what the owner keeps out of their memories, which the assets leave out (#12) */
  exclusions?: MemoryExclusions;
  memory: { memoryAt: Date; isSaved: boolean };
  /** the photos and videos of the window and the memory's own, in time order */
  assets: MemorySourceAsset[];
};

/**
 * Turns a memory of the rule engine into what a highlight video, a book or a collage is made from (#5): the whole
 * window the memory stands for, e.g. every photo of a trip rather than its ten curated ones (see
 * `src/utils/memory-source.ts`). Memories are their owner's only, so only the owner can make something of one. The
 * photos the owner keeps out of their memories (#12) are left out, the memory's own included.
 */
@Injectable()
export class MemorySourceService extends BaseService {
  async resolve(auth: AuthDto, memoryId: string, now = new Date()): Promise<ResolvedMemorySource> {
    requireNotSharedLink(auth);
    await this.requireAccess({ auth, permission: Permission.MemoryRead, ids: [memoryId] });
    const memory = await this.memoryRepository.get(memoryId);
    if (!memory) {
      throw new BadRequestException('Memory not found');
    }

    const source = getMemorySource(
      {
        id: memory.id,
        type: memory.type,
        data: memory.data,
        memoryAt: new Date(memory.memoryAt),
        assetIds: memory.assets.map(({ id }) => id),
      },
      now,
    );

    const exclusions = await BaseService.create(MemoryExclusionService, this).getExclusions(auth.user.id);
    const assets = new Map<string, MemorySourceAsset>();
    if (source.from && source.to) {
      const rows = await this.bookDraftRepository.getWindowAssets(auth.user.id, {
        from: source.from,
        to: source.to,
        personIds: source.personIds,
        favoritesOnly: source.favoritesOnly,
        videosOnly: source.videosOnly,
        exclusions,
      });
      for (const row of rows) {
        assets.set(row.id, row);
      }
    }

    // the memory's own photos are in it even outside the window; a photo of someone else (e.g. of a space) is used
    // read-only, and only while the owner can still see it
    let own = memory.assets.filter(({ id }) => !assets.has(id));
    if (own.length > 0 && hasMemoryExclusions(exclusions)) {
      const kept = await this.memoryExclusionRepository.getKeptAssetIds(
        own.map(({ id }) => id),
        exclusions,
      );
      own = own.filter(({ id }) => kept.has(id));
    }
    const readable =
      own.length > 0
        ? await this.checkAccess({ auth, permission: Permission.AssetRead, ids: new Set(own.map(({ id }) => id)) })
        : new Set<string>();
    for (const asset of own) {
      if (readable.has(asset.id) && (asset.type === AssetType.Image || asset.type === AssetType.Video)) {
        assets.set(asset.id, { id: asset.id, type: asset.type, time: new Date(asset.localDateTime).getTime() });
      }
    }

    return {
      source,
      exclusions,
      memory: { memoryAt: new Date(memory.memoryAt), isSaved: memory.isSaved },
      assets: assets
        .values()
        .toArray()
        .toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id)),
    };
  }
}

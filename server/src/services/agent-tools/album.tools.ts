import { Injectable } from '@nestjs/common';
import z from 'zod';
import { AlbumResponseDto } from 'src/dtos/album.dto.js';
import { BulkIdErrorReason, BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto.js';
import { AlbumService } from 'src/services/album.service.js';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';

const MAX_ASSET_IDS = 5000;
const MAX_REPORTED_FAILURES = 20;

const AssetIdsSchema = z.array(z.uuidv4()).min(1).max(MAX_ASSET_IDS).describe('Photo/video asset IDs');

const toDate = (value?: string) => (value ? value.slice(0, 10) : null);

const toAlbumSummary = (album: AlbumResponseDto) => ({
  id: album.id,
  name: album.albumName,
  count: album.assetCount,
  start: toDate(album.startDate),
  end: toDate(album.endDate),
  shared: album.shared,
});

const unique = (ids: string[]) => [...new Set(ids)];

const toFailures = (results: BulkIdResponseDto[]) =>
  results.slice(0, MAX_REPORTED_FAILURES).map(({ id, error }) => ({ id, reason: error ?? 'unknown' }));

/** `duplicate` counts assets already in the album and repeated IDs in the request */
const summarizeAdd = (results: BulkIdResponseDto[], requested: string[]) => {
  const failed = results.filter(({ success, error }) => !success && error !== BulkIdErrorReason.DUPLICATE);
  return {
    added: results.filter(({ success }) => success).length,
    duplicate:
      results.filter(({ error }) => error === BulkIdErrorReason.DUPLICATE).length + requested.length - results.length,
    failed: failed.length,
    ...(failed.length > 0 && { failures: toFailures(failed) }),
  };
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Album management */
@Injectable()
export class AlbumAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const albums = () => BaseService.create(AlbumService, this);

    return [
      defineTool({
        name: 'list_albums',
        title: 'List albums',
        description:
          'List the albums the user owns or that are shared with them, newest first. Optionally filter by a case-insensitive name match. Dates are the local capture dates of the earliest and latest photo.',
        input: z.object({
          query: z.string().optional().describe('Only albums whose name contains this text'),
          shared: z.boolean().optional().describe('true = only shared albums, false = only albums that are not shared'),
          limit: z.int().min(1).max(500).default(50).describe('Maximum number of albums to return'),
        }),
        mutating: false,
        handler: async ({ auth }, { query, shared, limit }) => {
          const all = await albums().getAll(auth, { isShared: shared });
          const needle = query?.trim().toLowerCase();
          const matches = needle ? all.filter((album) => album.albumName.toLowerCase().includes(needle)) : all;
          return toolJson({
            total: matches.length,
            albums: matches.slice(0, limit).map((album) => toAlbumSummary(album)),
          });
        },
      }),

      defineTool({
        name: 'get_album',
        title: 'Get album',
        description: 'Get the details of an album, optionally with the IDs of its assets in capture order.',
        input: z.object({
          albumId: z.uuidv4().describe('Album ID'),
          includeAssetIds: z.boolean().default(false).describe('Include the asset IDs of the album'),
          limit: z.int().min(1).max(MAX_ASSET_IDS).default(1000).describe('Maximum number of asset IDs to return'),
        }),
        mutating: false,
        handler: async ({ auth }, { albumId, includeAssetIds, limit }) => {
          try {
            const album = await albums().get(auth, albumId);
            const assets = includeAssetIds ? await this.assetRepository.getIdsByAlbumId(albumId, limit) : undefined;
            const assetIds = assets?.map(({ id }) => id);
            return toolJson({
              ...toAlbumSummary(album),
              description: album.description || null,
              owner: album.albumUsers[0]?.user.name ?? null,
              isOwner: album.albumUsers[0]?.user.id === auth.user.id,
              users: album.albumUsers.map(({ user, role }) => ({ name: user.name, role })),
              thumbnailAssetId: album.albumThumbnailAssetId,
              ...(assetIds && { assetIds, assetIdsTruncated: assetIds.length < album.assetCount }),
            });
          } catch (error) {
            return toolError(`Could not get album ${albumId}: ${errorMessage(error)}`);
          }
        },
      }),

      defineTool({
        name: 'create_album',
        title: 'Create album',
        description:
          'Create a new album owned by the user, optionally with assets. Assets the user cannot share are skipped and counted as failed.',
        input: z.object({
          name: z.string().trim().min(1).max(200).describe('Album name'),
          description: z.string().max(2000).optional().describe('Album description'),
          assetIds: AssetIdsSchema.optional(),
        }),
        mutating: true,
        handler: async ({ auth }, { name, description, assetIds = [] }) => {
          try {
            const service = albums();
            const album = await service.create(auth, { albumName: name, description });
            const results =
              assetIds.length > 0 ? await service.addAssets(auth, album.id, { ids: unique(assetIds) }) : [];
            return toolJson({ id: album.id, name: album.albumName, ...summarizeAdd(results, assetIds) });
          } catch (error) {
            return toolError(`Could not create album: ${errorMessage(error)}`);
          }
        },
      }),

      defineTool({
        name: 'add_to_album',
        title: 'Add to album',
        description: 'Add assets to an album. Assets already in the album are counted as duplicate.',
        input: z.object({ albumId: z.uuidv4().describe('Album ID'), assetIds: AssetIdsSchema }),
        mutating: true,
        handler: async ({ auth }, { albumId, assetIds }) => {
          try {
            const results = await albums().addAssets(auth, albumId, { ids: unique(assetIds) });
            return toolJson({ albumId, ...summarizeAdd(results, assetIds) });
          } catch (error) {
            return toolError(`Could not add to album ${albumId}: ${errorMessage(error)}`);
          }
        },
      }),

      defineTool({
        name: 'remove_from_album',
        title: 'Remove from album',
        description: 'Remove assets from an album. The assets themselves are not deleted.',
        input: z.object({ albumId: z.uuidv4().describe('Album ID'), assetIds: AssetIdsSchema }),
        mutating: true,
        handler: async ({ auth }, { albumId, assetIds }) => {
          try {
            const results = await albums().removeAssets(auth, albumId, { ids: unique(assetIds) });
            const notInAlbum = results.filter(({ error }) => error === BulkIdErrorReason.NOT_FOUND).length;
            const failed = results.filter(({ success, error }) => !success && error !== BulkIdErrorReason.NOT_FOUND);
            return toolJson({
              albumId,
              removed: results.filter(({ success }) => success).length,
              notInAlbum,
              failed: failed.length,
              ...(failed.length > 0 && { failures: toFailures(failed) }),
            });
          } catch (error) {
            return toolError(`Could not remove from album ${albumId}: ${errorMessage(error)}`);
          }
        },
      }),
    ];
  }
}

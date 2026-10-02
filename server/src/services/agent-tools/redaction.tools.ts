import { Injectable } from '@nestjs/common';
import z from 'zod';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { ActivityLogAction, AssetFileType, AssetType, Permission } from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { AlbumService } from 'src/services/album.service.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { RedactionAsset, RedactionService } from 'src/services/redaction.service.js';
import { checkOwnedAssets } from 'src/utils/access.js';
import { countPhotos, quote } from 'src/utils/activity-log.js';
import { AgentTool, AgentToolContent, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';
import { RedactionRegion, describeRedaction, redactionStyles } from 'src/utils/redaction.js';

/** the most photos one call redacts: each is decoded and blurred at full resolution */
export const MAX_REDACT = 50;
/** the most photos of an album one call looks at */
const MAX_ALBUM_PHOTOS = 2000;
/** the most photos `suggest_redactions` describes, and shows */
const MAX_SUGGEST = 50;
const MAX_PREVIEWS = 4;
const PREVIEW_PX = 768;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const PeopleSchema = {
  onlyPersonIds: z
    .array(z.uuidv4())
    .max(50)
    .optional()
    .describe('Blur only the faces of these people (see find_people), e.g. the children'),
  keepPersonIds: z
    .array(z.uuidv4())
    .max(50)
    .optional()
    .describe('Blur every face except those of these people (see find_people)'),
  faces: z.boolean().optional().describe('Blur faces (default true); pets are never blurred'),
  text: z
    .boolean()
    .optional()
    .describe(
      'Blur text that looks personal (names, numbers, codes, contact details) and the text of documents (default false)',
    ),
  plates: z.boolean().optional().describe('Blur number plates (default false)'),
  screens: z.boolean().optional().describe('Blur the text of screens (default false)'),
};

type PeopleInput = {
  onlyPersonIds?: string[];
  keepPersonIds?: string[];
  faces?: boolean;
  text?: boolean;
  plates?: boolean;
  screens?: boolean;
};

const toOptions = ({ onlyPersonIds, keepPersonIds, faces, text, plates, screens }: PeopleInput) => ({
  onlyPersonIds,
  keepPersonIds,
  faces: faces ?? true,
  text: text ?? false,
  plates: plates ?? false,
  screens: screens ?? false,
});

/** what a photo's regions are, without the text OCR read (it may be personal) */
const summarize = (regions: RedactionRegion[]) => {
  const selected = regions.filter(({ selected }) => selected);
  return {
    blur: describeRedaction(selected) || 'nothing',
    faces: regions
      .filter(({ kind }) => kind === 'face')
      .map(({ personId, personName, selected, reason }) => ({
        ...(personId && { personId }),
        name: personName || null,
        blurred: selected,
        reason,
      })),
    ...(regions.some(({ kind }) => kind !== 'face') && {
      text: regions
        .filter(({ kind }) => kind !== 'face')
        .map(({ kind, reason, selected }) => ({ kind, reason, blurred: selected })),
    }),
  };
};

/** Redaction (#14): blurring faces, personal text, number plates and screens into copies, before sharing */
@Injectable()
export class RedactionAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const redactions = () => BaseService.create(RedactionService, this);

    return [
      defineTool({
        name: 'suggest_redactions',
        title: 'Suggest redactions',
        description:
          'Look at what redact_photos would blur on photos, without changing anything: the faces (with the person, ' +
          'and whether it would be blurred, from onlyPersonIds or keepPersonIds), text that looks personal, number ' +
          'plates (OCR patterns plus a CLIP check) and screens, from the stored face and OCR boxes. Pass ids, or ' +
          `albumId to look at an album's photos (up to ${MAX_ALBUM_PHOTOS}). Returns {photos: [{id, blur, faces, ` +
          'text}], nothingToBlur, notOwned}; with preview=true, images of the first photos with the regions ' +
          'blurred. Use it before redact_photos to tell the user what would be blurred.',
        input: z.object({
          ids: z.array(z.uuidv4()).max(MAX_SUGGEST).optional().describe('Asset IDs of the photos'),
          albumId: z.uuidv4().optional().describe('Look at the photos of this album'),
          ...PeopleSchema,
          preview: z.boolean().optional().describe(`Also return images of up to ${MAX_PREVIEWS} photos, blurred`),
        }),
        mutating: false,
        handler: async ({ auth }, input) => {
          try {
            const assets = await this.getPhotos(auth, input);
            const owned = await checkOwnedAssets(this.accessRepository, auth, new Set(assets.map(({ id }) => id)));
            const options = toOptions(input);
            const photos: Array<{ id: string } & ReturnType<typeof summarize>> = [];
            const previews: AgentToolContent[] = [];
            const nothingToBlur: string[] = [];
            const hidden = await BaseService.create(CollectionService, this).getPrivateSourceIds(
              assets.map(({ id }) => id),
            );

            for (const asset of assets) {
              const { regions } = await redactions().getSuggestions(asset, options);
              if (regions.every(({ selected }) => !selected)) {
                nothingToBlur.push(asset.id);
                continue;
              }
              if (photos.length >= MAX_SUGGEST) {
                continue;
              }
              photos.push({ id: asset.id, ...summarize(regions) });
              // a travel document (or another private source) is never shown
              if (input.preview && previews.length < MAX_PREVIEWS && !hidden.has(asset.id)) {
                const image = await this.renderPreview(asset, regions);
                if (image) {
                  previews.push({ type: 'image', data: image.toString('base64'), mimeType: 'image/jpeg' });
                }
              }
            }

            const notOwned = assets.filter(({ id }) => !owned.has(id)).map(({ id }) => id);
            const result = toolJson({
              photos,
              ...(nothingToBlur.length > 0 && { nothingToBlur }),
              ...(notOwned.length > 0 && {
                notOwned,
                note: 'Only the owner of a photo can make a redacted copy of it',
              }),
            });
            return { content: [...result.content, ...previews] };
          } catch (error) {
            return toolError(`Could not suggest redactions: ${errorMessage(error)}`);
          }
        },
      }),

      defineTool({
        name: 'redact_photos',
        title: 'Redact photos',
        description:
          `Make a copy of each of up to ${MAX_REDACT} photos with faces (all of them, only onlyPersonIds, or all but ` +
          'keepPersonIds; never pets) and optionally personal text, number plates and screens blurred (or ' +
          'pixelated), e.g. "blur the kids\' faces before sharing this album" (find_people for the children, then ' +
          'onlyPersonIds with the albumId). The originals are never changed: each copy is stacked with its original ' +
          'and tagged Edits/Redacted. Only the owner of a photo can redact it; photos with nothing to blur are ' +
          'skipped. With albumId and replaceInAlbum=true, the copies replace their originals in the album, so that ' +
          'sharing the album shares the copies. Every change is in the activity log and can be undone. Returns ' +
          '{redacted: [{sourceId, id, blurred}], skipped, copies: {originalId: copyId}}.',
        input: z.object({
          ids: z.array(z.uuidv4()).max(MAX_REDACT).optional().describe('Asset IDs of the photos'),
          albumId: z.uuidv4().optional().describe("Redact the album's photos that have something to blur"),
          ...PeopleSchema,
          style: z.enum(redactionStyles).optional().describe('blur (default) or pixelate'),
          replaceInAlbum: z
            .boolean()
            .optional()
            .describe('With albumId: put the copies in the album instead of their originals'),
        }),
        mutating: true,
        handler: async ({ auth, activity }, input) => {
          if (input.onlyPersonIds && input.keepPersonIds) {
            return toolError('Pass onlyPersonIds or keepPersonIds, not both');
          }
          if (input.replaceInAlbum && !input.albumId) {
            return toolError('replaceInAlbum needs an albumId');
          }
          try {
            const assets = await this.getPhotos(auth, input);
            const owned = await checkOwnedAssets(this.accessRepository, auth, new Set(assets.map(({ id }) => id)));
            const options = toOptions(input);
            const redacted: Array<{ sourceId: string; id: string; blurred: string; duplicate?: true }> = [];
            const skipped: Array<{ id: string; reason: string }> = [];
            let remaining = 0;

            // one at a time: every photo is decoded at full resolution
            for (const asset of assets) {
              if (!owned.has(asset.id)) {
                skipped.push({ id: asset.id, reason: 'not your photo: only its owner can redact it' });
                continue;
              }
              const { regions } = await redactions().getSuggestions(asset, options);
              const selected = regions.filter(({ selected }) => selected);
              if (selected.length === 0) {
                if (!input.albumId) {
                  skipped.push({ id: asset.id, reason: 'nothing to blur' });
                }
                continue;
              }
              if (redacted.length >= MAX_REDACT) {
                remaining++;
                continue;
              }
              try {
                const copy = await redactions().createRedactedCopy(auth, asset.id, {
                  regions: selected.map(({ x, y, width, height, kind }) => ({ x, y, width, height, kind })),
                  style: input.style,
                });
                redacted.push({
                  sourceId: asset.id,
                  id: copy.id,
                  blurred: copy.description,
                  ...(copy.duplicate && { duplicate: true }),
                });
              } catch (error) {
                skipped.push({ id: asset.id, reason: errorMessage(error) });
              }
            }

            const created = redacted.filter(({ duplicate }) => !duplicate);
            const activityLog = BaseService.create(ActivityLogService, this);
            if (created.length > 0) {
              await activityLog.record(auth, activity, {
                action: ActivityLogAction.AssetCopy,
                summary: `Made redacted copies of ${countPhotos(created.length)}`,
                assetIds: created.flatMap(({ id, sourceId }) => [id, sourceId]),
                undo: { copies: created.map(({ id, sourceId }) => ({ id, sourceId })) },
              });
            }

            const replaced =
              input.replaceInAlbum && input.albumId && redacted.length > 0
                ? await this.replaceInAlbum(auth, activity, input.albumId, redacted)
                : undefined;

            if (redacted.length === 0) {
              return skipped.length > 0
                ? toolError(`No photo was redacted: ${skipped.map(({ id, reason }) => `${id}: ${reason}`).join('; ')}`)
                : toolJson({ redacted: [], note: 'There is nothing to blur on these photos' });
            }
            return toolJson({
              redacted,
              ...(skipped.length > 0 && { skipped }),
              ...(remaining > 0 && { remaining, note: `Call again to redact the other ${remaining} photos` }),
              ...(replaced && { album: replaced }),
              copies: Object.fromEntries(redacted.map(({ sourceId, id }) => [sourceId, id])),
            });
          } catch (error) {
            return toolError(`Could not redact the photos: ${errorMessage(error)}`);
          }
        },
      }),
    ];
  }

  /** the photos of the input (ids, or an album's), with what redaction needs */
  private async getPhotos(auth: AuthDto, { ids, albumId }: { ids?: string[]; albumId?: string }) {
    let assetIds = [...new Set(ids)];
    if (albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [albumId] });
      const rows = await this.assetJobRepository.getForAgentEvents({
        albumId,
        viewingUserId: auth.user.id,
        limit: MAX_ALBUM_PHOTOS,
      });
      const inAlbum = rows.map(({ id }) => id);
      assetIds = assetIds.length > 0 ? assetIds.filter((id) => inAlbum.includes(id)) : inAlbum;
    }
    if (assetIds.length === 0) {
      throw new Error('Pass ids or an albumId with photos');
    }
    if (!albumId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: assetIds });
    }
    const assets = await BaseService.create(RedactionService, this).getAssets(assetIds);
    return assets.filter((asset) => asset.type === AssetType.Image && !asset.deletedAt);
  }

  private async renderPreview(asset: RedactionAsset, regions: RedactionRegion[]) {
    const preview =
      asset.files.find((file) => file.type === AssetFileType.Preview && file.isEdited === asset.isEdited) ??
      (asset.isEdited ? undefined : asset.files.find((file) => file.type === AssetFileType.Preview));
    if (!preview) {
      return null;
    }
    const rects = regions.filter(({ selected }) => selected);
    return this.withLocalFile(preview.path, (path) =>
      this.mediaRepository.redactImage(path, rects, { quality: 80, size: PREVIEW_PX }),
    );
  }

  /** puts the copies in the album instead of their originals, recorded so that undoing it puts the originals back */
  private async replaceInAlbum(
    auth: AuthDto,
    activity: Parameters<ActivityLogService['record']>[1],
    albumId: string,
    redacted: Array<{ sourceId: string; id: string }>,
  ) {
    const albums = BaseService.create(AlbumService, this);
    const activityLog = BaseService.create(ActivityLogService, this);
    const album = await this.activityLogRepository.getAlbumState(albumId);
    const name = quote(album?.albumName ?? 'the album');

    const results = await albums.addAssets(auth, albumId, { ids: redacted.map(({ id }) => id) });
    const added = results.filter(({ success }) => success).map(({ id }) => id);
    if (added.length > 0) {
      await activityLog.record(auth, activity, {
        action: ActivityLogAction.AlbumAddAssets,
        summary: `Added ${countPhotos(added.length)} redacted to ${name}`,
        targetId: albumId,
        assetIds: added,
        undo: { albumId, assetIds: added },
      });
    }

    // an original leaves the album only when its copy is in it
    const inAlbum = new Set(added);
    const originals = redacted.filter(({ id }) => inAlbum.has(id)).map(({ sourceId }) => sourceId);
    const removed = (originals.length > 0 ? await albums.removeAssets(auth, albumId, { ids: originals }) : [])
      .filter(({ success }) => success)
      .map(({ id }) => id);
    if (removed.length > 0) {
      await activityLog.record(auth, activity, {
        action: ActivityLogAction.AlbumRemoveAssets,
        summary: `Removed the ${countPhotos(removed.length)} redacted from ${name}`,
        targetId: albumId,
        assetIds: removed,
        undo: { albumId, assetIds: removed },
      });
    }
    return { albumId, added: added.length, removed: removed.length };
  }
}

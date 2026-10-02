import { BadRequestException, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { AssetEditActionItem } from 'src/dtos/editing.dto.js';
import { AuthSharedLink } from 'src/database.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  RedactionCreateDto,
  RedactionPreviewDto,
  RedactionResponseDto,
  RedactionSuggestDto,
  RedactionSuggestionResponseDto,
} from 'src/dtos/redaction.dto.js';
import { ActivityLogAction, AssetFileType, AssetType, CacheControl, Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { ActivityRecorder, recordActivity } from 'src/utils/activity-log.js';
import { getDimensions, isPanorama } from 'src/utils/asset.util.js';
import { ImmichStreamResponse } from 'src/utils/file.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { isSmartSearchEnabled } from 'src/utils/misc.js';
import {
  RedactionFace,
  RedactionOcrBox,
  RedactionPeople,
  RedactionRect,
  RedactionRegion,
  RedactionScene,
  RedactionStyle,
  describeRedaction,
  getFaceRegions,
  getLinkKeptPeople,
  getLinkRegions,
  getRedactionKey,
  getRedactionPromptList,
  getRedactionScene,
  getTextRegions,
  toEditedRect,
} from 'src/utils/redaction.js';
import { getOutputDimensions } from 'src/utils/transform.js';

/** the quality of a redacted copy */
const REDACTED_QUALITY = 93;
/** the long edge of the preview of a redaction */
const PREVIEW_PX = 1440;
/** how long the people "in" what a link shares are remembered: a page of thumbnails asks many times in a row */
const LINK_PEOPLE_TTL_MS = 60_000;
/** the redacted renditions served through links, kept in memory up to this many bytes */
const RENDER_CACHE_BYTES = 64 * 1024 * 1024;

export type RedactionAsset = NonNullable<Awaited<ReturnType<RedactionService['getAssets']>>[number]>;

/** what a shared link blurs (#14): the people it keeps (those "in" what it shares) and whether it blurs text */
export type LinkRedaction = {
  linkId: string;
  redactFaces: boolean;
  redactText: boolean;
  people: RedactionPeople;
};

const linkPeopleCache = new Map<string, { expiresAt: number; people: RedactionPeople }>();
const textEmbeddingCache = new Map<string, string>();

/** a small LRU of rendered images, by key */
class RenderCache {
  private items = new Map<string, Buffer>();
  private bytes = 0;

  constructor(private maxBytes: number) {}

  get(key: string) {
    const value = this.items.get(key);
    if (value) {
      this.items.delete(key);
      this.items.set(key, value);
    }
    return value;
  }

  set(key: string, value: Buffer) {
    if (value.length > this.maxBytes / 4) {
      return;
    }
    const existing = this.items.get(key);
    if (existing) {
      this.bytes -= existing.length;
      this.items.delete(key);
    }
    this.items.set(key, value);
    this.bytes += value.length;
    for (const [oldKey, oldValue] of this.items) {
      if (this.bytes <= this.maxBytes) {
        break;
      }
      this.items.delete(oldKey);
      this.bytes -= oldValue.length;
    }
  }

  clear() {
    this.items.clear();
    this.bytes = 0;
  }
}

const renderCache = new RenderCache(RENDER_CACHE_BYTES);

/** for tests: forget what links blurred and rendered */
export const clearRedactionCaches = () => {
  linkPeopleCache.clear();
  renderCache.clear();
};

export const isRedactingLink = (link?: Pick<AuthSharedLink, 'redactFaces' | 'redactText'> | null) =>
  !!link && (!!link.redactFaces || !!link.redactText);

const groupBy = <T extends { assetId: string }>(rows: T[]) => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    groups.set(row.assetId, [...(groups.get(row.assetId) ?? []), row]);
  }
  return groups;
};

/**
 * Redaction (#14): blurs faces (except chosen people), personal text, number plates and screens before a photo is
 * shared. A redacted copy is a new asset stacked with the original and tagged Edits/Redacted, and the original is
 * never changed. Shared links that blur faces or text serve redacted renditions instead of the files, rendered when
 * they are asked for (see `getLinkRedaction`).
 */
@Injectable()
export class RedactionService extends BaseService {
  /** The regions to blur on a photo, from its stored face and OCR boxes; the selected ones are blurred by default */
  async suggest(
    auth: AuthDto,
    assetId: string,
    dto: RedactionSuggestDto = {},
  ): Promise<RedactionSuggestionResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [assetId] });
    const asset = await this.getPhoto(assetId);
    const { regions, scene, hasFaces, hasText } = await this.getSuggestions(asset, dto);
    const { width, height } = this.getShownSize(asset);
    return { assetId, width, height, regions, scene, hasFaces, hasText };
  }

  /** The preview of a photo with the regions blurred, as a JPEG */
  async renderPreview(auth: AuthDto, assetId: string, dto: RedactionPreviewDto): Promise<Buffer> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });
    const asset = await this.getPhoto(assetId);
    // the regions are of the photo as it is shown: of the edited preview of an edited photo
    const preview = this.findFile(asset, AssetFileType.Preview);
    if (!preview || (asset.isEdited && !preview.isEdited)) {
      throw new BadRequestException('The preview of this photo has not been generated yet, try again later');
    }
    return this.withLocalFile(preview.path, (path) =>
      this.mediaRepository.redactImage(path, dto.regions, {
        style: dto.style ?? 'blur',
        quality: 85,
        size: PREVIEW_PX,
      }),
    );
  }

  /**
   * Blurs regions of a photo into a new photo, stacked with the original and tagged Edits/Redacted; the original is
   * never changed. Only the owner of a photo can make a copy of it. With a recorder it goes into the activity log,
   * where undoing it moves the copy to the trash.
   */
  async createRedactedCopy(
    auth: AuthDto,
    assetId: string,
    dto: RedactionCreateDto = {},
    activity?: ActivityRecorder,
  ): Promise<RedactionResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetCopy, ids: [assetId] });
    const asset = await this.getPhoto(assetId);

    let rects: Array<RedactionRect & { kind?: RedactionRegion['kind'] }> = dto.regions ?? [];
    if (!dto.regions) {
      const { regions } = await this.getSuggestions(asset, dto);
      rects = regions
        .filter(({ selected }) => selected)
        .map(({ x, y, width, height, kind }) => ({ x, y, width, height, kind }));
    }
    if (rects.length === 0) {
      throw new BadRequestException('There is nothing to blur on this photo');
    }

    const { image } = await this.getConfig({ withCache: true });
    const exifInfo = {
      colorspace: asset.colorspace,
      profileDescription: asset.profileDescription,
      bitsPerSample: asset.bitsPerSample,
      orientation: asset.orientation,
    };
    // the edits are defined on the original itself, not on the embedded preview of a RAW file
    const decoded = await this.decodeAssetOriginal(
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo },
      image,
      asset.isEdited ? { extracted: null } : undefined,
    );
    const shown = asset.isEdited ? await this.mediaRepository.applyBitmapEdits(decoded, asset.edits) : decoded;
    const { width, height } = shown.info;
    const redacted = await this.mediaRepository.redactBitmap(
      shown,
      rects.map((rect) => ({
        x: rect.x * width,
        y: rect.y * height,
        width: rect.width * width,
        height: rect.height * height,
      })),
      dto.style ?? 'blur',
    );
    const output = await this.mediaRepository.encodeJpeg(redacted, {
      colorspace: decoded.colorspace,
      quality: REDACTED_QUALITY,
    });

    const description = `Redacted: ${describeRedaction(rects)}`;
    const { id, duplicate } = await BaseService.create(DerivedAssetService, this).createDerivedAsset(
      auth,
      assetId,
      { buffer: output.data, extension: 'jpg' },
      { description, suffix: 'redacted', stack: true },
    );

    if (!duplicate) {
      await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, auth.user.id, activity, {
        action: ActivityLogAction.AssetCopy,
        summary: `Made a redacted copy of a photo (${describeRedaction(rects)})`,
        assetIds: [id, assetId],
        undo: { copies: [{ id, sourceId: assetId }] },
      });
    }

    return { id, sourceId: assetId, regionCount: rects.length, description: describeRedaction(rects), duplicate };
  }

  /** the suggested regions of a photo, on the photo as it is shown */
  async getSuggestions(
    asset: RedactionAsset,
    dto: RedactionSuggestDto = {},
  ): Promise<{ regions: RedactionRegion[]; scene: RedactionScene; hasFaces: boolean; hasText: boolean }> {
    const { faces: withFaces = true, text = true, plates = true, screens = true } = dto;
    const faces: RedactionFace[] = withFaces ? await this.assetJobRepository.getRedactionFaces([asset.id]) : [];
    const boxes: RedactionOcrBox[] =
      text || plates || screens ? await this.assetJobRepository.getRedactionOcr([asset.id]) : [];
    const scenes = boxes.length > 0 ? await this.getScenes([asset.id]) : undefined;
    const scene = scenes?.get(asset.id) ?? null;
    const people = await this.resolvePeople({ keep: dto.keepPersonIds, only: dto.onlyPersonIds });

    const size = this.getUneditedSize(asset);
    const unedited = [
      ...getFaceRegions(faces, people),
      ...getTextRegions(boxes, { text, plates, screens, scene, size }),
    ];
    return {
      regions: this.toShown(asset, unedited),
      scene,
      hasFaces: faces.some(({ isPet }) => !isPet),
      hasText: boxes.length > 0,
    };
  }

  /** people by id with their face identities, which match their faces in other libraries too */
  async resolvePeople({ keep, only }: { keep?: string[]; only?: string[] }): Promise<RedactionPeople> {
    const ids = [...(keep ?? []), ...(only ?? [])];
    const people = await this.assetJobRepository.getRedactionPeople(ids);
    const identities = (personIds?: string[]) =>
      new Set(
        people
          .filter(({ id, identityId }) => personIds?.includes(id) && identityId)
          .map(({ identityId }) => identityId!),
      );
    return {
      ...(keep && { keep, keepIdentities: identities(keep) }),
      ...(only && { only, onlyIdentities: identities(only) }),
    };
  }

  /** what CLIP sees in photos (vehicles, screens, documents); none without smart search or an embedding */
  async getScenes(assetIds: string[]): Promise<Map<string, RedactionScene>> {
    const scenes = new Map<string, RedactionScene>();
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (assetIds.length === 0 || !isSmartSearchEnabled(machineLearning)) {
      return scenes;
    }
    try {
      const modelName = machineLearning.clip.modelName;
      const embeddings: string[] = [];
      for (const { text } of getRedactionPromptList()) {
        const key = `${modelName}\n${text}`;
        let embedding = textEmbeddingCache.get(key);
        if (!embedding) {
          embedding = await this.machineLearningRepository.encodeText(text, { modelName });
          textEmbeddingCache.set(key, embedding);
        }
        embeddings.push(embedding);
      }
      for (const row of await this.searchRepository.getEmbeddingSimilarities(assetIds, embeddings)) {
        scenes.set(row.assetId, getRedactionScene(row.similarities));
      }
    } catch (error) {
      this.logger.warn(`Unable to tell what photos show for redaction: ${error}`);
    }
    return scenes;
  }

  // shared links

  /**
   * What a shared link blurs, or null when it blurs nothing: with `redactFaces`, the faces of everyone but the people
   * "in" what it shares (see `getLinkKeptPeople`); with `redactText`, all the text OCR found, which includes the
   * number plates
   */
  async getLinkRedaction(link?: AuthSharedLink | null): Promise<LinkRedaction | null> {
    if (!link || !isRedactingLink(link)) {
      return null;
    }
    return {
      linkId: link.id,
      redactFaces: link.redactFaces,
      redactText: link.redactText,
      people: link.redactFaces ? await this.getLinkPeople(link) : {},
    };
  }

  /** the regions a link blurs on photos, in fractions of the unedited upright photos; photos without any are left out */
  async getLinkRegions(redaction: LinkRedaction, assetIds: string[]): Promise<Map<string, RedactionRect[]>> {
    const ids = [...new Set(assetIds)];
    const faces = groupBy(redaction.redactFaces ? await this.assetJobRepository.getRedactionFaces(ids) : []);
    const boxes = groupBy(redaction.redactText ? await this.assetJobRepository.getRedactionOcr(ids) : []);
    const regions = new Map<string, RedactionRect[]>();
    for (const id of ids) {
      const rects = getLinkRegions(
        { faces: faces.get(id) ?? [], boxes: boxes.get(id) ?? [] },
        redaction,
        redaction.people,
      );
      if (rects.length > 0) {
        regions.set(id, rects);
      }
    }
    return regions;
  }

  /** the regions a link blurs on a photo, if any */
  async getLinkRegionsOf(redaction: LinkRedaction, assetId: string) {
    const regions = await this.getLinkRegions(redaction, [assetId]);
    return regions.get(assetId);
  }

  /** whether a link blurs anything on photos */
  async hasLinkRegions(redaction: LinkRedaction, assetIds: string[]) {
    const regions = await this.getLinkRegions(redaction, assetIds);
    return regions.size > 0;
  }

  /** a key of what a link blurs on photos, e.g. for the cache of a web book */
  async getLinkFingerprint(redaction: LinkRedaction, assetIds: string[]) {
    const regions = await this.getLinkRegions(redaction, assetIds);
    const parts = [...regions]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([id, rects]) => getRedactionKey(id, rects, 'blur'));
    return parts.length === 0 ? '' : getRedactionKey(parts.join(';'), [], 'blur');
  }

  /**
   * A file of a photo (a thumbnail, a preview, the full size image or the original) with regions (fractions of the
   * unedited upright photo) blurred, as a JPEG that fits in `size` when given. Cached by what it shows.
   */
  async renderAssetFile(
    assetId: string,
    path: string,
    regions: RedactionRect[],
    { style = 'blur', size, quality = 85 }: { style?: RedactionStyle; size?: number; quality?: number } = {},
  ): Promise<Buffer> {
    const [asset] = await this.getAssets([assetId]);
    // a file of the edited photo shows the regions where the edits moved them
    const isEditedFile = !!asset?.files.find((file) => file.path === path)?.isEdited;
    const rects = isEditedFile ? this.toEdited(asset!, regions) : regions;

    const key = getRedactionKey(`${path}\n${size ?? 'full'}\n${quality}`, rects, style);
    const cached = renderCache.get(key);
    if (cached) {
      return cached;
    }
    const data = await this.withLocalFile(path, (local) =>
      this.mediaRepository.redactImage(local, rects, { style, size, quality }),
    );
    renderCache.set(key, data);
    return data;
  }

  /**
   * What a link serves instead of a thumbnail, preview or full size file of a photo: the file with the regions the
   * link blurs; null when it blurs nothing on it
   */
  async getLinkThumbnail(
    redaction: LinkRedaction,
    assetId: string,
    path: string,
    fileName: string,
  ): Promise<ImmichStreamResponse | null> {
    const regions = await this.getLinkRegionsOf(redaction, assetId);
    if (!regions) {
      return null;
    }
    const data = await this.renderAssetFile(assetId, path, regions);
    return this.toResponse(data, fileName, 'inline');
  }

  /**
   * What a link serves instead of the original of a photo: a JPEG of its largest image the server can read (the
   * original, its full size image or its preview) with the regions the link blurs; null when it blurs nothing on it.
   * A video with something to blur (on its own preview, or on the still of a live photo) is withheld.
   */
  async getLinkOriginal(
    redaction: LinkRedaction,
    assetId: string,
    { download, edited }: { download?: boolean; edited: boolean },
  ): Promise<ImmichStreamResponse | null> {
    const [asset] = await this.getAssets([assetId]);
    if (!asset) {
      return null;
    }
    if (asset.type === AssetType.Video) {
      await this.requireVideoShown(redaction, assetId);
      return null;
    }
    const regions = await this.getLinkRegionsOf(redaction, assetId);
    if (!regions) {
      return null;
    }
    const path = this.getLargestImage(asset, edited);
    if (!path) {
      throw new BadRequestException('This photo can not be shared with its faces or text blurred yet');
    }
    const data = await this.renderAssetFile(assetId, path, regions, { quality: 90 });
    const name = asset.originalFileName.replace(/\.[^.]*$/, '');
    return this.toResponse(data, `${name}.jpg`, download ? 'attachment' : 'inline');
  }

  /**
   * Videos are shown as they are: a link that blurs faces or text withholds a video with something to blur (on its
   * preview, or on the still of its live photo), as its frames can't be blurred
   */
  async requireVideoShown(redaction: LinkRedaction, videoId: string) {
    const stills = await this.assetJobRepository.getLivePhotoStillIds([videoId]);
    const regions = await this.getLinkRegions(redaction, [videoId, ...stills.map(({ id }) => id)]);
    if (regions.size > 0) {
      throw new BadRequestException('This video is not shared, because the link blurs faces or text');
    }
  }

  /** the largest image of a photo that can be read: the original when the server reads it, else its full size file */
  getLargestImage(asset: RedactionAsset, edited: boolean) {
    const preferEdited = edited && asset.isEdited;
    if (!preferEdited && mimeTypes.isWebSupportedImage(asset.originalPath)) {
      return asset.originalPath;
    }
    return (
      this.findFile(asset, AssetFileType.FullSize, preferEdited)?.path ??
      this.findFile(asset, AssetFileType.Preview, preferEdited)?.path ??
      null
    );
  }

  async getAssets(ids: string[]) {
    const rows = await this.assetJobRepository.getForRedaction(ids);
    return rows.map((row) => ({ ...row, edits: (row.edits ?? []) as AssetEditActionItem[] }));
  }

  private toResponse(data: Buffer, fileName: string, disposition: 'inline' | 'attachment') {
    return new ImmichStreamResponse({
      stream: Readable.from(data),
      contentType: 'image/jpeg',
      length: data.length,
      // what a link blurs changes with its options and with the people of what it shares
      cacheControl: CacheControl.PrivateWithoutCache,
      fileName,
      disposition: disposition === 'inline' ? undefined : disposition,
    });
  }

  private async getLinkPeople(link: AuthSharedLink): Promise<RedactionPeople> {
    const cached = linkPeopleCache.get(link.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.people;
    }

    let counts;
    let photoCount: number;
    if (link.bookId) {
      const book = await this.bookRepository.get(link.bookId);
      const pages = book ? await this.bookRepository.getPages(link.bookId) : [];
      const ids = new Set<string>(book?.coverAssetId ? [book.coverAssetId] : []);
      for (const page of pages) {
        for (const { assetId } of page.assets) {
          ids.add(assetId);
        }
      }
      counts = await this.assetJobRepository.getRedactionPeopleCounts({ assetIds: [...ids] });
      photoCount = ids.size;
    } else if (link.albumId) {
      counts = await this.assetJobRepository.getRedactionPeopleCounts({ albumId: link.albumId });
      photoCount = await this.assetJobRepository.countRedactionAssets({ albumId: link.albumId });
    } else {
      counts = await this.assetJobRepository.getRedactionPeopleCounts({ sharedLinkId: link.id });
      photoCount = await this.assetJobRepository.countRedactionAssets({ sharedLinkId: link.id });
    }

    const people = getLinkKeptPeople(counts, photoCount);
    linkPeopleCache.set(link.id, { expiresAt: Date.now() + LINK_PEOPLE_TTL_MS, people });
    return people;
  }

  private async getPhoto(assetId: string) {
    const [asset] = await this.getAssets([assetId]);
    if (!asset || asset.deletedAt) {
      throw new BadRequestException('Asset not found');
    }
    if (asset.type !== AssetType.Image) {
      throw new BadRequestException('Only photos can be redacted');
    }
    const names = [asset.originalFileName, asset.originalPath].map((name) => name.toLowerCase());
    if (names.some((name) => name.endsWith('.gif') || name.endsWith('.svg'))) {
      throw new BadRequestException('Redacting GIF and SVG images is not supported');
    }
    if (isPanorama({ projectionType: asset.projectionType, originalFileName: asset.originalFileName })) {
      throw new BadRequestException('Redacting panorama images is not supported');
    }
    return asset;
  }

  private findFile(asset: RedactionAsset, type: AssetFileType, edited = asset.isEdited) {
    return (
      asset.files.find((file) => file.type === type && file.isEdited === edited) ??
      asset.files.find((file) => file.type === type && !file.isEdited)
    );
  }

  /** the size of the unedited upright photo, in which face boxes, OCR boxes and edits are defined */
  private getUneditedSize(asset: RedactionAsset) {
    return getDimensions({
      exifImageWidth: asset.exifImageWidth,
      exifImageHeight: asset.exifImageHeight,
      orientation: asset.orientation,
    });
  }

  /** the size of the photo as it is shown: with its edits */
  private getShownSize(asset: RedactionAsset) {
    const size = this.getUneditedSize(asset);
    return asset.isEdited && size.width ? getOutputDimensions(asset.edits, size) : size;
  }

  /** regions of the unedited upright photo on the photo as it is shown (with its edits) */
  private toShown<T extends RedactionRect>(asset: RedactionAsset, regions: T[]): T[] {
    return asset.isEdited ? this.toEdited(asset, regions) : regions;
  }

  private toEdited<T extends RedactionRect>(asset: RedactionAsset, regions: T[]): T[] {
    if (asset.edits.length === 0) {
      return regions;
    }
    const size = this.getUneditedSize(asset);
    return regions.flatMap((region) => {
      const rect = toEditedRect(region, asset.edits, size);
      return rect ? [{ ...region, ...rect }] : [];
    });
  }
}

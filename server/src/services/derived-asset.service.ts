import { BadRequestException, Injectable } from '@nestjs/common';
import { Tags } from 'exiftool-vendored';
import { DateTime } from 'luxon';
import { isAbsolute, parse } from 'node:path';
import { StorageCore } from 'src/cores/storage.core.js';
import { OnEvent } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  AssetType,
  AssetVisibility,
  ChecksumAlgorithm,
  ImmichWorker,
  JobName,
  Permission,
  StorageFolder,
} from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { TagService } from 'src/services/tag.service.js';
import { getArtStyle } from 'src/utils/agent/art-styles.js';
import { isAssetChecksumConstraint } from 'src/utils/database.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { upsertTags } from 'src/utils/tag.js';

export type DerivedAssetFile = ({ path: string } | { buffer: Buffer }) & {
  /** file extension of the new image, e.g. `jpg` or `png` */
  extension: string;
};

export type DerivedAssetOptions = {
  /** description of the new asset, e.g. "Cropped from IMG_0001.jpg" */
  description?: string;
  /** appended to the source file name, e.g. `crop` gives `IMG_0001-crop.jpg` */
  suffix?: string;
  /** stack the new asset with its source, keeping the source as the primary asset */
  stack?: boolean;
  /** hierarchical tags (`parent/child`) written into the file, so metadata extraction applies them; defaults by suffix */
  tags?: string[];
};

/** Tags that make generated copies easy to find (search filters, the Tags page) */
export const DERIVED_ASSET_TAGS: Record<string, string[]> = {
  crop: ['Edits/Cropped'],
  straight: ['Edits/Straightened'],
  enhanced: ['Edits/Enhanced'],
  improved: ['Edits/Improved'],
  redacted: ['Edits/Redacted'],
  map: ['Photo books/Maps'],
};

export const getArtworkTag = (styleName?: string | null) =>
  `AI Artwork/${(styleName || 'Custom style').replaceAll('/', '-')}`;

export const getBackfillTag = (asset: { artJobId: string | null; style: string | null; originalFileName: string }) => {
  if (asset.artJobId) {
    return getArtworkTag(asset.style ? getArtStyle(asset.style)?.name : null);
  }
  const suffix = /-(crop|straight|map)\.[a-z]+$/i.exec(asset.originalFileName)?.[1]?.toLowerCase();
  return suffix ? DERIVED_ASSET_TAGS[suffix]?.[0] : undefined;
};

export type GeneratedAssetOptions = {
  fileName: string;
  description?: string;
  tags?: string[];
  /** the asset whose date the new asset gets, e.g. the last photo of the trip */
  dateOf: {
    fileCreatedAt: Date;
    localDateTime: Date;
    exifInfo?: Pick<SourceExif, 'dateTimeOriginal' | 'timeZone'> | null;
  };
};

export type DerivedAssetResult = {
  id: string;
  /** an identical derived asset already existed and was returned instead */
  duplicate: boolean;
};

type SourceExif = {
  dateTimeOriginal: string | Date | null;
  timeZone: string | null;
  latitude: number | null;
  longitude: number | null;
  make: string | null;
  model: string | null;
  lensModel: string | null;
};

const toExifDate = (value: string | Date | null, timeZone: string | null, localDateTime: string | Date) => {
  if (value) {
    const date = DateTime.fromJSDate(new Date(value), { zone: 'UTC' });
    const zoned = timeZone ? date.setZone(timeZone) : date;
    if (timeZone && zoned.isValid) {
      return { dateTime: zoned.toFormat('yyyy:MM:dd HH:mm:ss'), offset: zoned.toFormat('ZZ') };
    }
  }

  // localDateTime holds the wall-clock time of the capture, without an offset
  const local = DateTime.fromJSDate(new Date(localDateTime), { zone: 'UTC' });
  return { dateTime: local.toFormat('yyyy:MM:dd HH:mm:ss'), offset: undefined };
};

export const getDerivedExifTags = (
  exif: SourceExif | null,
  localDateTime: string | Date,
  description?: string,
  tagList: string[] = [],
): Partial<Tags> => {
  const { dateTime, offset } = toExifDate(exif?.dateTimeOriginal ?? null, exif?.timeZone ?? null, localDateTime);
  const tags: Record<string, unknown> = {
    DateTimeOriginal: dateTime,
    CreateDate: dateTime,
    OffsetTimeOriginal: offset,
    OffsetTime: offset,
    // the pixels of a derived image are already upright
    Orientation: 'Horizontal (normal)',
    Make: exif?.make ?? undefined,
    Model: exif?.model ?? undefined,
    LensModel: exif?.lensModel ?? undefined,
    ImageDescription: description,
    Description: description,
    ...(tagList.length > 0 && {
      TagsList: tagList,
      HierarchicalSubject: tagList.map((tag) => tag.replaceAll('/', '|')),
    }),
  };

  if (exif?.latitude !== null && exif?.latitude !== undefined) {
    tags.GPSLatitude = Math.abs(exif.latitude);
    tags.GPSLatitudeRef = exif.latitude < 0 ? 'S' : 'N';
  }

  if (exif?.longitude !== null && exif?.longitude !== undefined) {
    tags.GPSLongitude = Math.abs(exif.longitude);
    tags.GPSLongitudeRef = exif.longitude < 0 ? 'W' : 'E';
  }

  return Object.fromEntries(Object.entries(tags).filter(([, value]) => value !== undefined)) as Partial<Tags>;
};

/** Creates new assets from server-generated images (crops, stylized copies) that derive from an existing asset. */
@Injectable()
export class DerivedAssetService extends BaseService {
  /** Tags the copies made before they were tagged automatically. Idempotent: tagged assets are skipped. */
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Api] })
  async onBootstrap() {
    const assets = await this.artJobRepository.getDerivedAssetsForTagging();
    const byOwner = new Map<string, Map<string, string[]>>();
    for (const asset of assets) {
      const tag = getBackfillTag(asset);
      if (!tag) {
        continue;
      }
      const tags = byOwner.get(asset.ownerId) ?? new Map<string, string[]>();
      tags.set(tag, [...(tags.get(tag) ?? []), asset.assetId]);
      byOwner.set(asset.ownerId, tags);
    }

    const tagService = BaseService.create(TagService, this);
    let count = 0;
    for (const [ownerId, tags] of byOwner) {
      const user = await this.agentRepository.getAuthUser(ownerId);
      if (!user) {
        continue;
      }
      const auth: AuthDto = { user };
      for (const [value, assetIds] of tags) {
        const [tag] = await upsertTags(this.tagRepository, { userId: ownerId, tags: [value] });
        const results = await tagService.addAssets(auth, tag.id, { ids: assetIds });
        count += results.filter(({ success }) => success).length;
      }
    }

    if (count > 0) {
      this.logger.log(`Tagged ${count} assistant-made copies`);
    }
  }

  async createDerivedAsset(
    auth: AuthDto,
    sourceAssetId: string,
    file: DerivedAssetFile,
    { description, suffix = 'edit', stack = true, tags = DERIVED_ASSET_TAGS[suffix] ?? [] }: DerivedAssetOptions = {},
  ): Promise<DerivedAssetResult> {
    // the copy is stacked with the source in its owner's library, so only the owner makes one: a photo that is only
    // shared with the user (a partner's, or another member's in a shared space) is read-only, like `AssetCopy`
    await this.requireAccess({ auth, permission: Permission.AssetCopy, ids: [sourceAssetId] });

    const source = await this.assetRepository.getById(sourceAssetId, { exifInfo: true });
    if (!source || source.deletedAt) {
      throw new BadRequestException('Asset not found');
    }

    const extension = file.extension.replace(/^\./, '').toLowerCase();
    const fileName = `${parse(source.originalFileName).name}-${suffix}.${extension}`;
    if (!mimeTypes.isImage(fileName)) {
      throw new BadRequestException(`Unsupported image type: ${extension}`);
    }

    const id = this.cryptoRepository.randomUUID();
    // made on disk, where its metadata is written, then stored in the write backend (see `storeLocalFile`)
    const path = StorageCore.getNestedPath(StorageFolder.Upload, source.ownerId, `${id}.${extension}`);
    const key = StorageCore.getRelativeNestedPath(StorageFolder.Upload, source.ownerId, `${id}.${extension}`);
    this.storageCore.ensureFolders(path);

    let created = false;
    let originalPath = path;
    try {
      await ('buffer' in file
        ? this.storageRepository.createFile(path, file.buffer)
        : this.storageRepository.copyFile(file.path, path));

      await this.metadataRepository.writeTags(
        path,
        getDerivedExifTags(source.exifInfo ?? null, source.localDateTime, description, tags),
      );

      const { size } = await this.storageRepository.stat(path);
      if (source.ownerId === auth.user.id) {
        this.requireQuota(auth, size);
      }

      const checksum = await this.cryptoRepository.hashFile(path);
      const now = new Date();
      originalPath = await this.storeLocalFile(path, key, mimeTypes.lookup(fileName));

      let asset;
      try {
        asset = await this.assetRepository.create({
          id,
          ownerId: source.ownerId,
          libraryId: null,
          type: AssetType.Image,
          checksum,
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          originalPath,
          originalFileName: fileName,
          fileCreatedAt: source.fileCreatedAt,
          fileModifiedAt: now,
          localDateTime: source.localDateTime,
          visibility: AssetVisibility.Timeline,
        });
        created = true;
      } catch (error) {
        if (!isAssetChecksumConstraint(error)) {
          throw error;
        }

        const duplicateId = await this.assetRepository.getUploadAssetIdByChecksum(source.ownerId, checksum);
        if (!duplicateId) {
          throw error;
        }

        await this.removeFile(originalPath);
        return { id: duplicateId, duplicate: true };
      }

      await this.assetRepository.upsertExif({
        exif: { assetId: asset.id, fileSizeInByte: size, ...(description && { description }) },
        lockedPropertiesBehavior: 'override',
      });

      if (stack) {
        await this.stackWithSource(source, asset.id);
      }

      await this.eventRepository.emit('AssetCreate', {
        asset,
        file: { uuid: id, checksum, originalPath, originalName: fileName, size },
      });
      await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: asset.id, source: 'upload' } });

      return { id: asset.id, duplicate: false };
    } catch (error) {
      if (created) {
        await this.assetRepository.remove({ id });
      }
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [...new Set([path, originalPath])] } });
      throw error;
    }
  }

  /**
   * Creates a video asset of the user from a video the server made (a highlight video), with no source asset: the file
   * is moved into the upload folder with its date, description and tags written into it, so that metadata extraction
   * applies them, and the rest of the pipeline (thumbnails, transcoding) runs as for an upload
   */
  async createGeneratedVideo(
    auth: AuthDto,
    source: string,
    options: GeneratedAssetOptions,
  ): Promise<DerivedAssetResult> {
    if (!mimeTypes.isVideo(options.fileName)) {
      throw new BadRequestException(`Unsupported video type: ${options.fileName}`);
    }
    return this.createGeneratedAsset(auth, { path: source }, AssetType.Video, options);
  }

  /**
   * Creates an image asset of the user from an image the server made of several photos (a collage), with no source
   * asset: like a generated video, it gets the date of `dateOf` and its description and tags, and is not stacked
   */
  async createGeneratedImage(auth: AuthDto, data: Buffer, options: GeneratedAssetOptions): Promise<DerivedAssetResult> {
    if (!mimeTypes.isImage(options.fileName)) {
      throw new BadRequestException(`Unsupported image type: ${options.fileName}`);
    }
    return this.createGeneratedAsset(auth, { buffer: data }, AssetType.Image, options);
  }

  private async createGeneratedAsset(
    auth: AuthDto,
    file: { path: string } | { buffer: Buffer },
    type: AssetType.Image | AssetType.Video,
    { fileName, description, tags = [], dateOf }: GeneratedAssetOptions,
  ): Promise<DerivedAssetResult> {
    const id = this.cryptoRepository.randomUUID();
    const extension = parse(fileName).ext.toLowerCase();
    // made on disk, where its metadata is written, then stored in the write backend (see `storeLocalFile`)
    const path = StorageCore.getNestedPath(StorageFolder.Upload, auth.user.id, `${id}${extension}`);
    const key = StorageCore.getRelativeNestedPath(StorageFolder.Upload, auth.user.id, `${id}${extension}`);
    this.storageCore.ensureFolders(path);

    let created = false;
    let originalPath = path;
    try {
      if ('buffer' in file) {
        await this.storageRepository.createFile(path, file.buffer);
      } else {
        try {
          await this.storageRepository.rename(file.path, path);
        } catch {
          // another file system: the source is removed with its folder
          await this.storageRepository.copyFile(file.path, path);
        }
      }
      // the date of the asset, and nothing of its camera or place
      const exif: SourceExif = {
        dateTimeOriginal: dateOf.exifInfo?.dateTimeOriginal ?? null,
        timeZone: dateOf.exifInfo?.timeZone ?? null,
        latitude: null,
        longitude: null,
        make: null,
        model: null,
        lensModel: null,
      };
      const { Orientation, ...otherTags } = getDerivedExifTags(exif, dateOf.localDateTime, description, tags);
      // a video has no orientation tag; the pixels of an image are upright
      await this.metadataRepository.writeTags(
        path,
        type === AssetType.Image ? { Orientation, ...otherTags } : otherTags,
      );

      const { size } = await this.storageRepository.stat(path);
      this.requireQuota(auth, size);
      const checksum = await this.cryptoRepository.hashFile(path);
      originalPath = await this.storeLocalFile(path, key, mimeTypes.lookup(fileName));

      let asset;
      try {
        asset = await this.assetRepository.create({
          id,
          ownerId: auth.user.id,
          libraryId: null,
          type,
          checksum,
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          originalPath,
          originalFileName: fileName,
          fileCreatedAt: dateOf.fileCreatedAt,
          fileModifiedAt: new Date(),
          localDateTime: dateOf.localDateTime,
          visibility: AssetVisibility.Timeline,
        });
        created = true;
      } catch (error) {
        if (!isAssetChecksumConstraint(error)) {
          throw error;
        }
        const duplicateId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, checksum);
        if (!duplicateId) {
          throw error;
        }
        await this.removeFile(originalPath);
        return { id: duplicateId, duplicate: true };
      }

      await this.assetRepository.upsertExif({
        exif: { assetId: asset.id, fileSizeInByte: size, ...(description && { description }) },
        lockedPropertiesBehavior: 'override',
      });
      await this.eventRepository.emit('AssetCreate', {
        asset,
        file: { uuid: id, checksum, originalPath, originalName: fileName, size },
      });
      await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: asset.id, source: 'upload' } });
      return { id: asset.id, duplicate: false };
    } catch (error) {
      if (created) {
        await this.assetRepository.remove({ id });
      }
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [...new Set([path, originalPath])] } });
      throw error;
    }
  }

  /** removes a file this service stored: on disk at once, in a storage backend by a job */
  private async removeFile(path: string) {
    if (isAbsolute(path)) {
      await this.storageRepository.unlink(path);
    } else {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [path] } });
    }
  }

  private async stackWithSource(source: { id: string; ownerId: string; stackId: string | null }, assetId: string) {
    if (source.stackId) {
      await this.assetRepository.update({ id: assetId, stackId: source.stackId });
      await this.eventRepository.emit('StackUpdate', { stackId: source.stackId, userId: source.ownerId });
      return;
    }

    // the first asset becomes the primary asset of the stack
    const stack = await this.stackRepository.create({ ownerId: source.ownerId }, [source.id, assetId]);
    await this.eventRepository.emit('StackCreate', { stackId: stack.id, userId: source.ownerId });
  }

  private requireQuota(auth: AuthDto, size: number) {
    if (auth.user.quotaSizeInBytes !== null && auth.user.quotaSizeInBytes < auth.user.quotaUsageInBytes + size) {
      throw new BadRequestException('Quota has been exceeded!');
    }
  }
}

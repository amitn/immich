import { BadRequestException, Injectable } from '@nestjs/common';
import { Tags } from 'exiftool-vendored';
import { DateTime } from 'luxon';
import { parse } from 'node:path';
import { StorageCore } from 'src/cores/storage.core.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetType, AssetVisibility, ChecksumAlgorithm, JobName, Permission, StorageFolder } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { isAssetChecksumConstraint } from 'src/utils/database.js';
import { mimeTypes } from 'src/utils/mime-types.js';

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
  async createDerivedAsset(
    auth: AuthDto,
    sourceAssetId: string,
    file: DerivedAssetFile,
    { description, suffix = 'edit', stack = true }: DerivedAssetOptions = {},
  ): Promise<DerivedAssetResult> {
    // the copy belongs to the owner of the source and is stacked with it
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [sourceAssetId] });

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
    const path = StorageCore.getNestedPath(StorageFolder.Upload, source.ownerId, `${id}.${extension}`);
    this.storageCore.ensureFolders(path);

    let created = false;
    try {
      await ('buffer' in file
        ? this.storageRepository.createFile(path, file.buffer)
        : this.storageRepository.copyFile(file.path, path));

      await this.metadataRepository.writeTags(
        path,
        getDerivedExifTags(source.exifInfo ?? null, source.localDateTime, description),
      );

      const { size } = await this.storageRepository.stat(path);
      if (source.ownerId === auth.user.id) {
        this.requireQuota(auth, size);
      }

      const checksum = await this.cryptoRepository.hashFile(path);
      const now = new Date();

      let asset;
      try {
        asset = await this.assetRepository.create({
          id,
          ownerId: source.ownerId,
          libraryId: null,
          type: AssetType.Image,
          checksum,
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          originalPath: path,
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

        await this.storageRepository.unlink(path);
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
        file: { uuid: id, checksum, originalPath: path, originalName: fileName, size },
      });
      await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: asset.id, source: 'upload' } });

      return { id: asset.id, duplicate: false };
    } catch (error) {
      if (created) {
        await this.assetRepository.remove({ id });
      }
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [path] } });
      throw error;
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

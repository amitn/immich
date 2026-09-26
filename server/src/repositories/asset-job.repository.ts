import { Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetStatus, AssetType, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import {
  anyUuid,
  asUuid,
  hasPeople,
  withAudioStream,
  withDefaultVisibility,
  withEdits,
  withExif,
  withExifInner,
  withFaces,
  withFilePath,
  withFiles,
  withVideoFormat,
  withVideoStream,
} from 'src/utils/database.js';
import { mimeTypes } from 'src/utils/mime-types.js';

@Injectable()
export class AssetJobRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getForSearchDuplicatesJob(id: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', asUuid(id))
      .leftJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .select(['id', 'type', 'ownerId', 'duplicateId', 'stackId', 'visibility', 'smart_search.embedding'])
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForSidecarWriteJob(id: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', asUuid(id))
      .select(['id', 'originalPath'])
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .$call(withExifInner)
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForSidecarCheckJob(id: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', asUuid(id))
      .select(['id', 'originalPath'])
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ force: false, fullsizeEnabled: true }], stream: true })
  streamForThumbnailJob(options: { force: boolean | undefined; fullsizeEnabled: boolean }) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.isEdited'])
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden))
      .$if(!options.force, (qb) =>
        qb
          // If there aren't any entries, metadata extraction hasn't run yet which is required for thumbnails
          .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .where(({ and, eb, exists, not, or, selectFrom }) => {
            const file = (type: AssetFileType) =>
              selectFrom('asset_file').whereRef('assetId', '=', 'asset.id').where('type', '=', sql.lit(type));

            const conditions = [
              not(exists(file(AssetFileType.Thumbnail))),
              not(exists(file(AssetFileType.Preview))),
              and([
                eb('asset.isEdited', '=', sql.lit(true)),
                not(exists(file(AssetFileType.FullSize).where('asset_file.isEdited', '=', sql.lit(true)))),
              ]),
              eb('asset.thumbhash', 'is', null),
            ];

            if (options.fullsizeEnabled) {
              const isWebUnsupported = sql.join(
                Object.keys(mimeTypes.webUnsupportedImage).map((ext) => sql.lit(`%${ext}`)),
              );
              conditions.push(
                and([
                  not(exists(file(AssetFileType.FullSize))),
                  eb(sql`f_unaccent(asset."originalFileName")`, 'like', sql`any(array[${isWebUnsupported}]::text[])`),
                ]),
              );
            }

            return or(conditions);
          }),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForMigrationJob(id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.ownerId'])
      .select(withFiles)
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForGenerateThumbnailJob(id: string) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.visibility',
        'asset.originalFileName',
        'asset.originalPath',
        'asset.ownerId',
        'asset.thumbhash',
        'asset.type',
      ])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset_file')
            .select(columns.assetFilesForThumbnail)
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', 'in', [AssetFileType.Thumbnail, AssetFileType.Preview, AssetFileType.FullSize]),
        ).as('files'),
      )
      .select(withEdits)
      .$call(withExifInner)
      .leftJoin('asset_video', 'asset_video.assetId', 'asset.id')
      .select((eb) => withVideoStream(eb).as('videoStream'))
      .select((eb) => withVideoFormat(eb).as('format'))
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForMetadataExtraction(id: string) {
    return this.db
      .selectFrom('asset')
      .select(columns.asset)
      .select(withFaces)
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .innerJoin('user', 'user.id', 'asset.ownerId')
      .select(['user.clusterGroupId'])
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getLockedPropertiesForMetadataExtraction(assetId: string) {
    return this.db
      .selectFrom('asset_exif')
      .select('asset_exif.lockedProperties')
      .where('asset_exif.assetId', '=', assetId)
      .executeTakeFirst()
      .then((row) => row?.lockedProperties ?? []);
  }

  @GenerateSql({ params: [DummyValue.UUID, AssetFileType.Thumbnail] })
  getAlbumThumbnailFiles(id: string, fileType?: AssetFileType) {
    return this.db
      .selectFrom('asset_file')
      .select(columns.assetFiles)
      .where('asset_file.assetId', '=', id)
      .$if(!!fileType, (qb) => qb.where('asset_file.type', '=', fileType!))
      .execute();
  }

  private assetsWithPreviews() {
    return this.db
      .selectFrom('asset')
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .where('asset.deletedAt', 'is', null)
      .innerJoin('asset_job_status as job_status', 'assetId', 'asset.id')
      .where((eb) =>
        eb.exists((qb) =>
          qb
            .selectFrom('asset_file')
            .whereRef('assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      );
  }

  @GenerateSql({ params: [], stream: true })
  streamForSearchDuplicates(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .where('asset.deletedAt', 'is', null)
      .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .$call(withDefaultVisibility)
      .$if(!force, (qb) =>
        qb
          .innerJoin('asset_job_status as job_status', 'job_status.assetId', 'asset.id')
          .where('job_status.duplicatesDetectedAt', 'is', null),
      )
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForEncodeClip(force?: boolean) {
    return this.assetsWithPreviews()
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb.where((eb) => eb.not((eb) => eb.exists(eb.selectFrom('smart_search').whereRef('assetId', '=', 'asset.id')))),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForClipEncoding(id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.visibility'])
      .select((eb) => withFiles(eb, AssetFileType.Preview))
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForDetectFacesJob(id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.visibility'])
      .$call(withExifInner)
      .select((eb) => withFaces(eb, true, true))
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('asset_file')
            .select(columns.assetFiles)
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', sql.lit(AssetFileType.Preview))
            .orderBy('asset_file.isEdited', 'desc')
            .limit(sql.lit(1)),
        ).as('previewFile'),
      )
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForOcr(id: string) {
    return this.db
      .selectFrom('asset')
      .select((eb) => ['asset.visibility', withFilePath(eb, AssetFileType.Preview).as('previewFile')])
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  getForSyncAssets(ids: string[]) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.isOffline',
        'asset.libraryId',
        'asset.originalPath',
        'asset.status',
        'asset.fileModifiedAt',
      ])
      .where('asset.id', '=', anyUuid(ids))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForAssetDeletion(id: string) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.visibility',
        'asset.libraryId',
        'asset.ownerId',
        'asset.livePhotoVideoId',
        'asset.originalPath',
        'asset.isOffline',
      ])
      .$call(withExif)
      .select(withFiles)
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('stack')
            .whereRef('stack.id', '=', 'asset.stackId')
            .select((eb) => [
              'stack.id',
              'stack.primaryAssetId',
              jsonArrayFrom(
                eb
                  .selectFrom('asset as stack_asset')
                  .select(['stack_asset.id'])
                  .whereRef('stack_asset.stackId', '=', 'stack.id')
                  .whereRef('stack_asset.id', '!=', 'stack.primaryAssetId')
                  .where('stack_asset.visibility', '=', sql.val(AssetVisibility.Timeline))
                  .where('stack_asset.status', '!=', sql.val(AssetStatus.Deleted)),
              ).as('assets'),
            ])
            .as('stack_result'),
        (join) => join.onTrue(),
      )
      .select((eb) =>
        eb.fn
          .toJson(eb.table('stack_result'))
          .$castTo<{ id: string; primaryAssetId: string; assets: { id: string }[] } | null>()
          .as('stack'),
      )
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForVideoConversion(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_file')
                .select('asset_file.id')
                .whereRef('asset_file.assetId', '=', 'asset.id')
                .where('asset_file.type', '=', sql.lit(AssetFileType.EncodedVideo)),
            ),
          ),
        ),
      )
      .where('asset.deletedAt', 'is', null)
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForVideoConversion(id: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .innerJoin('asset_video', 'asset_video.assetId', 'asset.id')
      .leftJoin('asset_audio', 'asset_audio.assetId', 'asset.id')
      .select(['asset.id', 'asset.ownerId', 'asset.originalPath'])
      .select(withFiles)
      .select((eb) => withAudioStream(eb).as('audioStream'))
      .select((eb) => withVideoStream(eb).$notNull().as('videoStream'))
      .select((eb) => withVideoFormat(eb).$notNull().as('format'))
      .where('asset.id', '=', id)
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForMetadataExtraction(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb
          .leftJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .where((eb) =>
            eb.or([eb('asset_job_status.metadataExtractedAt', 'is', null), eb('asset_job_status.assetId', 'is', null)]),
          ),
      )
      .where('asset.deletedAt', 'is', null)
      .stream();
  }

  private storageTemplateAssetQuery() {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.checksum',
        'asset.originalPath',
        'asset.isExternal',
        'asset.visibility',
        'asset.originalFileName',
        'asset.livePhotoVideoId',
        'asset.fileCreatedAt',
        'asset_exif.timeZone',
        'asset_exif.fileSizeInByte',
        'asset_exif.make',
        'asset_exif.model',
        'asset_exif.lensModel',
      ])
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .where('asset.deletedAt', 'is', null);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForStorageTemplateJob(id: string, options?: { includeHidden?: boolean }) {
    return this.storageTemplateAssetQuery()
      .where('asset.id', '=', id)
      .$if(!options?.includeHidden, (qb) => qb.where('asset.visibility', '!=', AssetVisibility.Hidden))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForStorageTemplateJob() {
    return this.storageTemplateAssetQuery().where('asset.visibility', '!=', AssetVisibility.Hidden).stream();
  }

  @GenerateSql({ params: [DummyValue.DATE], stream: true })
  streamForDeletedJob(trashedBefore: Date) {
    return this.db
      .selectFrom('asset')
      .select(['id', 'isOffline'])
      .where('asset.deletedAt', '<=', trashedBefore)
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForSidecar(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_file')
                .select('asset_file.id')
                .whereRef('asset_file.assetId', '=', 'asset.id')
                .where('asset_file.type', '=', AssetFileType.Sidecar),
            ),
          ),
        ),
      )
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForDetectFacesJob(force?: boolean) {
    return this.assetsWithPreviews()
      .$if(force === false, (qb) => qb.where('job_status.facesRecognizedAt', 'is', null))
      .select(['asset.id'])
      .orderBy('asset.fileCreatedAt', 'desc')
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForOcrJob(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb
          .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .where('asset_job_status.ocrAt', 'is', null),
      )
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .stream();
  }

  @GenerateSql({ params: [DummyValue.DATE], stream: true })
  streamForMigrationJob() {
    return this.db.selectFrom('asset').select(['id']).where('asset.deletedAt', 'is', null).stream();
  }

  /** compact metadata, faces and preview path for the assistant tools; callers must check access */
  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.UUID] })
  getForAgent(ids: string[], viewingUserId: string) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.type',
        'asset.localDateTime',
        'asset.fileCreatedAt',
        'asset.isFavorite',
        'asset.width',
        'asset.height',
        'asset.checksum',
        'asset.updatedAt',
        'asset_exif.exifImageWidth',
        'asset_exif.exifImageHeight',
        'asset_exif.make',
        'asset_exif.model',
        'asset_exif.lensModel',
        'asset_exif.fNumber',
        'asset_exif.exposureTime',
        'asset_exif.iso',
        'asset_exif.focalLength',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.city',
        'asset_exif.state',
        'asset_exif.country',
        'asset_exif.description',
        'asset_exif.rating',
        'asset_exif.timeZone',
      ])
      .select((eb) =>
        eb
          .selectFrom('asset_file')
          .select('asset_file.path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('asset_file.type', '=', sql.lit(AssetFileType.Preview))
          .orderBy('asset_file.isEdited', 'desc')
          .limit(1)
          .as('previewPath'),
      )
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset_face')
            .leftJoin('person', (join) =>
              join
                .onRef('person.personGroupId', '=', 'asset_face.personGroupId')
                .on('person.ownerId', '=', asUuid(viewingUserId))
                .on('person.isHidden', '=', false),
            )
            .select([
              'asset_face.personGroupId as personId',
              'person.name',
              'asset_face.imageWidth',
              'asset_face.imageHeight',
              'asset_face.boundingBoxX1',
              'asset_face.boundingBoxY1',
              'asset_face.boundingBoxX2',
              'asset_face.boundingBoxY2',
            ])
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ).as('faces'),
      )
      .where('asset.id', '=', anyUuid(ids))
      .where('asset.deletedAt', 'is', null)
      .execute();
  }

  /** albums of the given assets that the user owns or is a member of */
  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.UUID] })
  getAlbumsForAgent(ids: string[], userId: string) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('album_asset')
      .innerJoin('album', (join) =>
        join.onRef('album.id', '=', 'album_asset.albumId').on('album.deletedAt', 'is', null),
      )
      .innerJoin('album_user', (join) =>
        join.onRef('album_user.albumId', '=', 'album.id').on('album_user.userId', '=', asUuid(userId)),
      )
      .select(['album_asset.assetId', 'album.id', 'album.albumName'])
      .where('album_asset.assetId', '=', anyUuid(ids))
      .orderBy('album.albumName')
      .execute();
  }

  /** time, place and named people of candidate assets for event splitting, ordered by local time */
  @GenerateSql({
    params: [
      {
        userIds: [DummyValue.UUID],
        viewingUserId: DummyValue.UUID,
        personIds: [DummyValue.UUID],
        takenAfter: DummyValue.DATE,
        limit: 5000,
      },
    ],
  })
  getForAgentEvents(options: {
    /** owners to search; omit only when `albumId` is set and access to it was checked */
    userIds?: string[];
    viewingUserId: string;
    albumId?: string;
    personIds?: string[];
    takenAfter?: Date;
    takenBefore?: Date;
    limit: number;
  }) {
    const { userIds, viewingUserId, albumId, personIds, takenAfter, takenBefore, limit } = options;
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.city',
        'asset_exif.country',
      ])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset_face')
            .innerJoin('person', (join) =>
              join
                .onRef('person.personGroupId', '=', 'asset_face.personGroupId')
                .on('person.ownerId', '=', asUuid(viewingUserId))
                .on('person.isHidden', '=', false)
                .on('person.name', '!=', ''),
            )
            .select('person.name')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ).as('people'),
      )
      .$if(!!userIds, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds!)))
      .$if(!!albumId, (qb) =>
        qb.where((eb) =>
          eb.exists(
            eb
              .selectFrom('album_asset')
              .whereRef('album_asset.assetId', '=', 'asset.id')
              .where('album_asset.albumId', '=', asUuid(albumId!)),
          ),
        ),
      )
      .$if(!!personIds && personIds.length > 0, (qb) => hasPeople(qb, personIds!))
      .$if(!!takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', takenAfter!))
      .$if(!!takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<=', takenBefore!))
      .$if(!!albumId, withDefaultVisibility)
      .$if(!albumId, (qb) => qb.where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline)))
      .where('asset.deletedAt', 'is', null)
      .orderBy('asset.localDateTime', 'asc')
      .orderBy('asset.id', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * when the given people were photographed: the local time of every photo of the user (timeline and archive) that
   * shows one of them, newest first, e.g. to tell which visits of a collection they were at
   */
  @GenerateSql({
    params: [
      {
        userId: DummyValue.UUID,
        personIds: [DummyValue.UUID],
        takenAfter: DummyValue.DATE,
        takenBefore: DummyValue.DATE,
        limit: 20_000,
      },
    ],
  })
  getPersonTimesForAgent(options: {
    userId: string;
    personIds: string[];
    /** local time, inclusive */
    takenAfter?: Date;
    /** local time, exclusive */
    takenBefore?: Date;
    limit: number;
  }) {
    const { userId, personIds, takenAfter, takenBefore, limit } = options;
    if (personIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .innerJoin('asset_face', (join) =>
        join
          .onRef('asset_face.assetId', '=', 'asset.id')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', 'is', true),
      )
      .select(['asset_face.personGroupId as personId', 'asset.localDateTime'])
      .where('asset_face.personGroupId', '=', anyUuid(personIds))
      .where('asset.ownerId', '=', asUuid(userId))
      .where('asset.deletedAt', 'is', null)
      .$call(withDefaultVisibility)
      .$if(!!takenAfter, (qb) => qb.where('asset.localDateTime', '>=', takenAfter!))
      .$if(!!takenBefore, (qb) => qb.where('asset.localDateTime', '<', takenBefore!))
      .orderBy('asset.localDateTime', 'desc')
      .limit(limit)
      .execute();
  }

  /** people of the viewing user with the number of assets they appear in, most photographed first */
  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.UUID, { limit: 20 }] })
  async getPeopleForAgent(
    userIds: string[],
    viewingUserId: string,
    { personIds, limit }: { personIds?: string[]; limit: number },
  ) {
    const people = await this.db
      .selectFrom('person')
      .innerJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personGroupId', '=', 'person.personGroupId')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', 'is', true),
      )
      .innerJoin('asset', (join) =>
        join
          .onRef('asset.id', '=', 'asset_face.assetId')
          .on('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
          .on('asset.deletedAt', 'is', null)
          .on('asset.ownerId', '=', anyUuid(userIds)),
      )
      .select(['person.personGroupId as id', 'person.name'])
      .select((eb) => eb.fn.count<number>('asset.id').distinct().as('count'))
      .where('person.ownerId', '=', asUuid(viewingUserId))
      .where('person.isHidden', '=', false)
      .$if(!!personIds, (qb) => qb.where('person.personGroupId', '=', anyUuid(personIds!)))
      .$if(!personIds, (qb) => qb.where('person.name', '!=', ''))
      .groupBy(['person.ownerId', 'person.personGroupId'])
      .orderBy('count', 'desc')
      .orderBy('person.name', 'asc')
      .limit(limit)
      .execute();

    return people.map((person) => ({ ...person, count: Number(person.count) }));
  }
}

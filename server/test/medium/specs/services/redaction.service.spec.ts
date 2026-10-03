import { Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import sharp from 'sharp';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { AssetMediaSize } from 'src/dtos/asset-media.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { ActivityLogAction, AssetFileType, AssetType, SharedLinkType, SharedSpaceRole } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetMediaService } from 'src/services/asset-media.service.js';
import { RedactionService, clearRedactionCaches } from 'src/services/redaction.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { ImmichFileResponse, ImmichStreamResponse } from 'src/utils/file.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// #14: redaction regions come from the stored face and OCR boxes, copies never touch the original, and links blur

let defaultDatabase: Kysely<DB>;
let mediaLocation: string;

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(RedactionService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      ActivityLogRepository,
      AlbumRepository,
      AssetJobRepository,
      AssetRepository,
      BookRepository,
      ConfigRepository,
      CryptoRepository,
      MediaRepository,
      MetadataRepository,
      PersonRepository,
      SearchRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      StackRepository,
      StorageRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, MachineLearningRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  return { sut, ctx };
};

type Context = ReturnType<typeof setup>['ctx'];

const WIDTH = 400;
const HEIGHT = 300;
/** two checkerboard "faces" on a grey photo: one on the left, one on the right */
const LEFT = { x1: 40, y1: 60, x2: 120, y2: 140 };
const RIGHT = { x1: 240, y1: 60, x2: 320, y2: 140 };

const checkerboard = ({ x1, y1, x2, y2 }: typeof LEFT) => {
  const cells: string[] = [`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="#fff"/>`];
  for (let y = y1; y < y2; y += 10) {
    for (let x = x1; x < x2; x += 10) {
      if (((x - x1) / 10 + (y - y1) / 10) % 2 === 0) {
        cells.push(`<rect x="${x}" y="${y}" width="10" height="10" fill="#000"/>`);
      }
    }
  }
  return cells.join('');
};

const createImage = (path: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><rect width="100%" height="100%" fill="#808080"/>` +
        `${checkerboard(LEFT)}${checkerboard(RIGHT)}</svg>`,
    ),
  )
    .jpeg({ quality: 95 })
    .toFile(path);

/** the standard deviation of the luma of a box of an image: high for a checkerboard, low once blurred */
const contrastOf = async (image: Buffer | string, { x1, y1, x2, y2 }: typeof LEFT) => {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true });
  const values: number[] = [];
  for (let y = y1 + 5; y < y2 - 5; y++) {
    for (let x = x1 + 5; x < x2 - 5; x++) {
      values.push(data[y * info.width + x]);
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

const sha1 = async (path: string) =>
  createHash('sha1')
    .update(await readFile(path))
    .digest('hex');

const newPhoto = async (ctx: Context, ownerId: string, name = 'IMG_0001.jpg') => {
  const originalPath = join(mediaLocation, `${factory.uuid()}.jpg`);
  const previewPath = join(mediaLocation, `${factory.uuid()}-preview.jpg`);
  await createImage(originalPath);
  await createImage(previewPath);
  const { asset } = await ctx.newAsset({ ownerId, type: AssetType.Image, originalPath, originalFileName: name });
  await ctx.newExif({ assetId: asset.id, exifImageWidth: WIDTH, exifImageHeight: HEIGHT, orientation: '1' });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: previewPath });
  return asset;
};

const newFace = async (ctx: Context, assetId: string, box: typeof LEFT, personGroupId: string | null = null) => {
  const { assetFace } = await ctx.newAssetFace({
    assetId,
    personGroupId,
    imageWidth: WIDTH,
    imageHeight: HEIGHT,
    boundingBoxX1: box.x1,
    boundingBoxY1: box.y1,
    boundingBoxX2: box.x2,
    boundingBoxY2: box.y2,
  });
  return assetFace;
};

const newText = async (
  ctx: Context,
  assetId: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  await ctx.database
    .insertInto('asset_ocr')
    .values({
      assetId,
      text,
      x1: x,
      y1: y,
      x2: x + width,
      y2: y,
      x3: x + width,
      y3: y + height,
      x4: x,
      y4: y + height,
      boxScore: 0.9,
      textScore: 0.9,
    })
    .execute();
};

const newOwner = async (ctx: Context) => {
  const { user } = await ctx.newUser();
  return { user, auth: factory.auth({ user }) };
};

/** an album of four photos with Alice in two of them, Bob in one, and a stranger, shared with a link */
const setupAlbum = async (ctx: Context, options: { redactFaces: boolean; redactText: boolean }) => {
  const { user } = await newOwner(ctx);
  const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
  const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
  const photos = [];
  for (let index = 0; index < 4; index++) {
    photos.push(await newPhoto(ctx, user.id, `IMG_000${index}.jpg`));
  }
  const [photo, other] = photos;
  await newFace(ctx, photo.id, LEFT, alice.personGroupId);
  await newFace(ctx, photo.id, RIGHT, bob.personGroupId);
  await newFace(ctx, other.id, LEFT, alice.personGroupId);
  await newFace(ctx, other.id, RIGHT);
  const { album } = await ctx.newAlbum(
    { ownerId: user.id, albumName: 'Summer' },
    photos.map(({ id }) => id),
  );
  const { sharedLink } = await ctx.newSharedLink({
    userId: user.id,
    type: SharedLinkType.Album,
    albumId: album.id,
  });
  await ctx.database.updateTable('shared_link').set(options).where('id', '=', sharedLink.id).execute();
  const link = await ctx.get(SharedLinkRepository).getByKey(sharedLink.key);
  const auth: AuthDto = { user: link!.user!, sharedLink: link };
  return { user, auth, photo, other, album };
};

const read = async (response: unknown) => {
  expect(response).toBeInstanceOf(ImmichStreamResponse);
  return buffer((response as ImmichStreamResponse).stream as Readable);
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  mediaLocation = await mkdtemp(join(tmpdir(), 'gallery-redact-'));
  StorageCore.setMediaLocation(mediaLocation);
  // the files a link serves as they are come from the disk backend
  (StorageService as any).diskBackend = new DiskStorageBackend(mediaLocation);
});

afterAll(async () => {
  await rm(mediaLocation, { recursive: true, force: true });
});

beforeEach(() => {
  clearRedactionCaches();
});

describe('redaction', () => {
  it('should suggest the faces except the chosen people, never a pet, and the plates and personal text', async () => {
    const { sut, ctx } = setup();
    const { user, auth } = await newOwner(ctx);
    const photo = await newPhoto(ctx, user.id);
    const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { person: dog } = await ctx.newPerson({ ownerId: user.id, name: 'Rex', type: 'pet' });
    await newFace(ctx, photo.id, LEFT, alice.personGroupId);
    const stranger = await newFace(ctx, photo.id, RIGHT);
    await newFace(ctx, photo.id, { x1: 150, y1: 200, x2: 200, y2: 250 }, dog.personGroupId);
    await newText(ctx, photo.id, 'AB12 CDE', 0.4, 0.85, 0.15, 0.05);
    await newText(ctx, photo.id, 'Trattoria da Enzo', 0.05, 0.02, 0.4, 0.05);
    await newText(ctx, photo.id, 'jane@example.com', 0.55, 0.02, 0.4, 0.05);

    const result = await sut.suggest(auth, photo.id, { keepPersonIds: [alice.personGroupId] });

    expect(result).toMatchObject({ assetId: photo.id, width: WIDTH, height: HEIGHT, hasFaces: true, hasText: true });
    const summary = result.regions.map(({ kind, reason, selected, personName }) => ({
      kind,
      reason,
      selected,
      ...(personName && { personName }),
    }));
    expect(summary).toEqual([
      { kind: 'face', reason: 'kept', selected: false, personName: 'Alice' },
      { kind: 'face', reason: 'unknown', selected: true },
      { kind: 'text', reason: 'other', selected: false },
      { kind: 'text', reason: 'personal', selected: true },
      { kind: 'plate', reason: 'plate', selected: true },
    ]);
    const face = result.regions.find(({ id }) => id === `face:${stranger.id}`)!;
    // the right face, 240..320 of 400, padded by 15% of its size
    expect(face.x).toBeCloseTo((240 - 12) / WIDTH);
    expect(face.width).toBeCloseTo(104 / WIDTH);

    // blur only Alice
    const only = await sut.suggest(auth, photo.id, {
      onlyPersonIds: [alice.personGroupId],
      text: false,
      plates: false,
    });
    expect(only.regions.map(({ reason, selected }) => ({ reason, selected }))).toEqual([
      { reason: 'person', selected: true },
      { reason: 'notChosen', selected: false },
    ]);
  });

  it('should make a blurred copy stacked with the original and tagged, and never change the original', async () => {
    const { sut, ctx } = setup();
    const { user, auth } = await newOwner(ctx);
    const photo = await newPhoto(ctx, user.id);
    await newFace(ctx, photo.id, RIGHT);
    const before = await ctx.database
      .selectFrom('asset')
      .selectAll()
      .where('id', '=', photo.id)
      .executeTakeFirstOrThrow();
    const hash = await sha1(photo.originalPath);
    expect(await contrastOf(photo.originalPath, RIGHT)).toBeGreaterThan(100);

    const result = await sut.createRedactedCopy(auth, photo.id, {}, ActivityRecorder.web());
    expect(result).toEqual({
      id: expect.any(String),
      sourceId: photo.id,
      regionCount: 1,
      description: '1 face',
      duplicate: false,
    });

    // the original: the same file, and the same row but for the stack it is now the primary asset of
    expect(await sha1(photo.originalPath)).toBe(hash);
    const after = await ctx.database
      .selectFrom('asset')
      .selectAll()
      .where('id', '=', photo.id)
      .executeTakeFirstOrThrow();
    const { stackId, updatedAt: _updatedAt, updateId: _updateId, ...unchanged } = after;
    const { stackId: _stackId, updatedAt: _before, updateId: _beforeId, ...original } = before;
    expect(unchanged).toEqual(original);
    expect(stackId).not.toBeNull();
    const stack = await ctx.get(StackRepository).getById(stackId!);
    expect(stack?.primaryAssetId).toBe(photo.id);

    // the copy: in the stack, blurred where the face is and nothing else, tagged
    const copy = await ctx.get(AssetRepository).getById(result.id, { exifInfo: true });
    expect(copy).toMatchObject({ ownerId: user.id, originalFileName: 'IMG_0001-redacted.jpg', stackId });
    expect(copy!.exifInfo).toMatchObject({ description: 'Redacted: 1 face' });
    expect(await contrastOf(copy!.originalPath, RIGHT)).toBeLessThan(25);
    expect(await contrastOf(copy!.originalPath, LEFT)).toBeGreaterThan(100);
    const tags = await ctx.get(MetadataRepository).readTags(copy!.originalPath);
    expect(tags).toMatchObject({ TagsList: ['Edits/Redacted'], HierarchicalSubject: ['Edits|Redacted'] });

    // recorded, so that undoing it moves the copy to the trash
    const [entry] = await ctx.get(ActivityLogRepository).search(user.id, { limit: 10 });
    expect(entry).toMatchObject({
      action: ActivityLogAction.AssetCopy,
      assetIds: expect.arrayContaining([result.id, photo.id]),
      undo: { copies: [{ id: result.id, sourceId: photo.id }] },
    });
  });

  it('should blur the regions a user draws', async () => {
    const { sut, ctx } = setup();
    const { user, auth } = await newOwner(ctx);
    const photo = await newPhoto(ctx, user.id);

    const result = await sut.createRedactedCopy(auth, photo.id, {
      regions: [{ x: LEFT.x1 / WIDTH, y: LEFT.y1 / HEIGHT, width: 80 / WIDTH, height: 80 / HEIGHT }],
      style: 'pixelate',
    });
    expect(result).toMatchObject({ regionCount: 1, description: '1 area' });
    const copy = await ctx.get(AssetRepository).getById(result.id);
    expect(await contrastOf(copy!.originalPath, LEFT)).toBeLessThan(60);
    expect(await contrastOf(copy!.originalPath, RIGHT)).toBeGreaterThan(100);
  });

  it("should not copy someone else's photo, even one the user can see", async () => {
    const { sut, ctx } = setup();
    const { user: owner } = await newOwner(ctx);
    const { user: stranger, auth: strangerAuth } = await newOwner(ctx);
    const { user: editor, auth: editorAuth } = await newOwner(ctx);
    const photo = await newPhoto(ctx, owner.id);
    await newFace(ctx, photo.id, RIGHT);
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: photo.id, addedById: owner.id });

    await expect(sut.suggest(strangerAuth, photo.id)).rejects.toThrow('asset.read');
    // a space editor sees what would be blurred...
    await expect(sut.suggest(editorAuth, photo.id)).resolves.toMatchObject({ assetId: photo.id });
    // ...but the copy is the owner's to make
    await expect(sut.createRedactedCopy(editorAuth, photo.id, {})).rejects.toThrow('asset.copy');
    const assets = await ctx.database
      .selectFrom('asset')
      .select('id')
      .where('ownerId', 'in', [editor.id, stranger.id])
      .execute();
    expect(assets).toEqual([]);
  });

  describe('shared links', () => {
    it('should blur the faces of people not in the album when serving through the link', async () => {
      const { ctx } = setup();
      const { auth, photo, other } = await setupAlbum(ctx, { redactFaces: true, redactText: false });
      const media = ctx.getService(AssetMediaService);

      // Alice is in two of the album's photos: kept; Bob is in one: blurred
      const preview = await read(await media.viewThumbnail(auth, photo.id, { size: AssetMediaSize.PREVIEW }));
      expect(await contrastOf(preview, LEFT)).toBeGreaterThan(100);
      expect(await contrastOf(preview, RIGHT)).toBeLessThan(25);

      // a stranger is blurred too, and so is the original
      const original = await read(await media.downloadOriginal(auth, other.id, {}));
      expect(await contrastOf(original, LEFT)).toBeGreaterThan(100);
      expect(await contrastOf(original, RIGHT)).toBeLessThan(25);

      // the files themselves are never changed
      expect(await contrastOf(photo.originalPath, RIGHT)).toBeGreaterThan(100);
    });

    it('should blur the text through a link that blurs text, and nothing through a link that does not', async () => {
      const { ctx } = setup();
      const blurring = await setupAlbum(ctx, { redactFaces: false, redactText: true });
      await newText(ctx, blurring.photo.id, 'AB12 CDE', LEFT.x1 / WIDTH, LEFT.y1 / HEIGHT, 80 / WIDTH, 80 / HEIGHT);
      const media = ctx.getService(AssetMediaService);

      const preview = await read(
        await media.viewThumbnail(blurring.auth, blurring.photo.id, { size: AssetMediaSize.PREVIEW }),
      );
      expect(await contrastOf(preview, LEFT)).toBeLessThan(25);
      // faces are not blurred by this link
      expect(await contrastOf(preview, RIGHT)).toBeGreaterThan(100);

      const plain = await setupAlbum(ctx, { redactFaces: false, redactText: false });
      const response = await media.viewThumbnail(plain.auth, plain.photo.id, { size: AssetMediaSize.PREVIEW });
      expect(response).toBeInstanceOf(ImmichFileResponse);
    });
  });
});

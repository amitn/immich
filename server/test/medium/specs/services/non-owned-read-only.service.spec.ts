import { Kysely } from 'kysely';
import { AssetFileType, AssetType, BookExportStatus, SharedLinkType, SharedSpaceRole } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ActivityLogRepository } from 'src/repositories/activity-log.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { HighlightJobRepository } from 'src/repositories/highlight-job.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { BookService } from 'src/services/book.service.js';
import { CollageService } from 'src/services/collage.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { SharedLinkService } from 'src/services/shared-link.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// #21: the photos of others (e.g. other members' photos in a shared space) are read-only for the assistant's features:
// books, collages and highlight videos may use them, but naming them, and a book link over them, are guarded

let defaultDatabase: Kysely<DB>;

const FULL_CROP = { x: 0, y: 0, width: 1, height: 1 };

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(BookService, {
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
      DatabaseRepository,
      HighlightJobRepository,
      MediaRepository,
      OcrRepository,
      PartnerRepository,
      SearchRepository,
      SharedLinkAssetRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      StackRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  // the pages are not drawn: the spec of a page says which photos it shows
  const composeBookPage = vi
    .spyOn(ctx.get(MediaRepository), 'composeBookPage')
    .mockResolvedValue({ data: Buffer.from('page'), slots: [] } as never);
  /** the photos the last page drawn shows, by their previews */
  const lastDrawn = () => JSON.stringify(composeBookPage.mock.lastCall);
  return { sut, ctx, lastDrawn };
};

type Context = ReturnType<typeof setup>['ctx'];

/** a photo with a preview to draw, owned by `ownerId` */
const newPhoto = async (ctx: Context, ownerId: string) => {
  const { asset } = await ctx.newAsset({ ownerId, type: AssetType.Image, originalFileName: 'IMG_0001.jpg' });
  await ctx.newExif({ assetId: asset.id, exifImageWidth: 400, exifImageHeight: 300 });
  const previewPath = `/data/thumbs/${asset.id}-preview.jpeg`;
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: previewPath });
  return { ...asset, previewPath };
};

/**
 * A shared space of Alice with Bob as an editor and Carol as a viewer, which holds a photo of Alice; Bob has a photo
 * of his own too
 */
const setupSpace = async (ctx: Context) => {
  const { user: alice } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: alice.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: alice.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: bob.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: carol.id, role: SharedSpaceRole.Viewer });
  const theirs = await newPhoto(ctx, alice.id);
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: theirs.id, addedById: alice.id });
  const mine = await newPhoto(ctx, bob.id);
  return {
    space,
    alice,
    bob,
    carol,
    theirs,
    mine,
    auth: {
      alice: factory.auth({ user: alice }),
      bob: factory.auth({ user: bob }),
      carol: factory.auth({ user: carol }),
    },
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('photos of others are read-only', () => {
  describe('naming', () => {
    it("should not let a space editor or viewer name another member's photo, and let its owner", async () => {
      const { ctx } = setup();
      const { theirs, auth } = await setupSpace(ctx);
      const collections = ctx.getService(CollectionService);
      const dto = { place: 'Trattoria da Nino', photos: [{ id: theirs.id, entry: 'Carbonara' }] };

      for (const user of [auth.bob, auth.carol]) {
        const { results } = await collections.saveEntries(user, 'food', dto);
        expect(results).toEqual([{ id: theirs.id, success: false, error: 'no_permission' }]);
      }
      await expect(ctx.get(TagRepository).getAssetTagsByPrefix([theirs.id], 'Food/')).resolves.toEqual([]);
      const [unchanged] = await ctx.get(AssetJobRepository).getForAgent([theirs.id], theirs.ownerId);
      expect(unchanged.description ?? '').toBe('');

      const { results } = await collections.saveEntries(auth.alice, 'food', dto);
      expect(results).toEqual([expect.objectContaining({ id: theirs.id, success: true })]);
      await expect(ctx.get(TagRepository).getAssetTagsByPrefix([theirs.id], 'Food/')).resolves.toEqual([
        expect.objectContaining({ assetId: theirs.id, value: 'Food/Trattoria da Nino/Carbonara' }),
      ]);
    });
  });

  describe('read-only use', () => {
    it("should let a space editor and a viewer put another member's photo in a book", async () => {
      const { sut, ctx } = setup();
      const { theirs, auth } = await setupSpace(ctx);

      for (const user of [auth.bob, auth.carol]) {
        const book = await sut.create(user, { title: 'Our trip' });
        const page = await sut.addPage(user, book.id, { layout: 'single' });
        await expect(sut.setSlot(user, book.id, page.id, 0, { assetId: theirs.id, crop: FULL_CROP })).resolves.toEqual(
          expect.objectContaining({ slots: [expect.objectContaining({ assetId: theirs.id })] }),
        );
      }
    });

    it("should let a space viewer make a collage and a highlight video of another member's photos", async () => {
      const { ctx, lastDrawn } = setup();
      const { alice, space, theirs, auth } = await setupSpace(ctx);
      const other = await newPhoto(ctx, alice.id);
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: other.id, addedById: alice.id });

      await expect(
        ctx.getService(CollageService).render(auth.carol, { assetIds: [theirs.id, other.id] }),
      ).resolves.toEqual(Buffer.from('page'));
      const spec = lastDrawn();
      expect(spec).toContain(theirs.previewPath);
      expect(spec).toContain(other.previewPath);

      const highlight = await ctx.getService(HighlightService).create(auth.carol, { assetIds: [theirs.id, other.id] });
      await expect(ctx.get(HighlightJobRepository).get(highlight.id)).resolves.toMatchObject({
        ownerId: auth.carol.user.id,
        options: expect.objectContaining({ assetIds: [theirs.id, other.id] }),
      });
    });
  });

  describe('book links', () => {
    /** a book of Bob with Alice's photo of the space and his own, and the photos a page of it shows */
    const setupBook = async () => {
      const { sut, ctx, lastDrawn } = setup();
      const space = await setupSpace(ctx);
      const { auth, theirs, mine } = space;
      const book = await sut.create(auth.bob, { title: 'Our trip' });
      const page = await sut.addPage(auth.bob, book.id, { layout: 'two-vertical' });
      await sut.setSlot(auth.bob, book.id, page.id, 0, { assetId: theirs.id, crop: FULL_CROP });
      await sut.setSlot(auth.bob, book.id, page.id, 1, { assetId: mine.id, crop: FULL_CROP });

      const drawn = async (user = auth.bob) => {
        await sut.renderPage(user, book.id, page.id, { size: 800 });
        const spec = lastDrawn();
        return [theirs, mine].filter(({ previewPath }) => spec.includes(previewPath)).map(({ id }) => id);
      };
      const linkAuth = (link: { id: string }) =>
        factory.auth({
          user: { id: space.bob.id },
          sharedLink: { id: link.id, bookId: book.id, allowDownload: true, showExif: true, password: null },
        });

      return { sut, ctx, ...space, book, page, drawn, linkAuth };
    };

    it("should tether a link to a book with another member's photo to the space, for an editor only", async () => {
      const { ctx, space, auth, book } = await setupBook();
      const links = ctx.getService(SharedLinkService);

      const link = await links.create(auth.bob, { type: SharedLinkType.Book, bookId: book.id });
      const saved = await ctx.get(SharedLinkRepository).getByKey(Buffer.from(link.key, 'base64url'));
      expect(saved).toMatchObject({ bookId: book.id, spaceId: space.id });

      // Bob as a viewer may put the photo in a book, but not publish it
      await ctx.database
        .updateTable('shared_space_member')
        .set({ role: SharedSpaceRole.Viewer })
        .where('spaceId', '=', space.id)
        .where('userId', '=', auth.bob.user.id)
        .execute();
      await expect(links.create(auth.bob, { type: SharedLinkType.Book, bookId: book.id })).rejects.toThrow(
        'no shared space you can edit holds them all',
      );
      await expect(
        links.create(auth.bob, { type: SharedLinkType.Book, bookId: book.id, spaceId: space.id }),
      ).rejects.toThrow('no shared space editor access');
    });

    it('should stop showing a photo once it is taken out of the space', async () => {
      const { ctx, sut, space, auth, book, theirs, mine, drawn, linkAuth } = await setupBook();
      const link = await ctx
        .getService(SharedLinkService)
        .create(auth.bob, { type: SharedLinkType.Book, bookId: book.id });
      await ctx.get(BookRepository).setExportStatus(book.id, BookExportStatus.Completed, '/data/books/our-trip.pdf');

      await expect(drawn(linkAuth(link))).resolves.toEqual([theirs.id, mine.id]);
      await expect(sut.downloadPdf(linkAuth(link), book.id)).resolves.toMatchObject({
        path: '/data/books/our-trip.pdf',
      });

      await ctx.get(SharedSpaceRepository).removeAssets(space.id, [theirs.id]);

      await expect(drawn(linkAuth(link))).resolves.toEqual([mine.id]);
      await expect(sut.downloadPdf(linkAuth(link), book.id)).rejects.toThrow('no longer shared');
    });

    it('should stop showing the photos of others once the creator of the link is no longer an editor', async () => {
      const { ctx, sut, space, auth, book, theirs, mine, drawn, linkAuth } = await setupBook();
      const link = await ctx
        .getService(SharedLinkService)
        .create(auth.bob, { type: SharedLinkType.Book, bookId: book.id });
      await expect(drawn(linkAuth(link))).resolves.toEqual([theirs.id, mine.id]);

      await ctx.database
        .updateTable('shared_space_member')
        .set({ role: SharedSpaceRole.Viewer })
        .where('spaceId', '=', space.id)
        .where('userId', '=', auth.bob.user.id)
        .execute();

      await expect(drawn(linkAuth(link))).resolves.toEqual([mine.id]);
      // Bob still sees the photo in his book: he can read it as a viewer
      await expect(drawn()).resolves.toEqual([theirs.id, mine.id]);
      await expect(sut.previewHtml(linkAuth(link), book.id)).resolves.toMatch(/^<!doctype html>/i);
    });

    it('should not show the photos of others through a link without a space', async () => {
      const { ctx, auth, book, mine, drawn, linkAuth } = await setupBook();
      // e.g. a link made before links to books were tethered
      const link = await ctx.get(SharedLinkRepository).create({
        key: Buffer.from('untethered'),
        userId: auth.bob.user.id,
        type: SharedLinkType.Book,
        bookId: book.id,
        allowUpload: false,
      });

      await expect(drawn(linkAuth(link))).resolves.toEqual([mine.id]);
    });
  });
});

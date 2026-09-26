import { UnauthorizedException } from '@nestjs/common';
import { Permission } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { checkAccess, requireAccess, requireUploadAccess } from 'src/utils/access.js';
import { IAccessRepositoryMock, newAccessRepositoryMock } from 'test/repositories/access.repository.mock.js';
import { factory, newUuid } from 'test/small.factory.js';

describe('access', () => {
  let access: IAccessRepositoryMock;
  const repository = () => access as unknown as AccessRepository;

  beforeEach(() => {
    access = newAccessRepositoryMock();
  });

  describe('a shared link to a book', () => {
    const bookId = newUuid();
    const linkAuth = (sharedLink: { allowDownload?: boolean; allowUpload?: boolean } = {}) =>
      factory.auth({ sharedLink: { bookId, allowDownload: true, ...sharedLink } });

    it('should read its own book', async () => {
      const auth = linkAuth();
      access.book.checkSharedLinkAccess.mockResolvedValue(new Set([bookId]));

      await expect(
        checkAccess(repository(), { auth, permission: Permission.BookRead, ids: [bookId] }),
      ).resolves.toEqual(new Set([bookId]));
      expect(access.book.checkSharedLinkAccess).toHaveBeenCalledWith(auth.sharedLink!.id, new Set([bookId]));
      expect(access.book.checkOwnerAccess).not.toHaveBeenCalled();
    });

    it('should not read another book', async () => {
      const other = newUuid();
      access.book.checkSharedLinkAccess.mockResolvedValue(new Set());

      await expect(
        requireAccess(repository(), { auth: linkAuth(), permission: Permission.BookRead, ids: [other] }),
      ).rejects.toThrow('Not found or no book.read access');
    });

    it('should download the book only when the link allows downloads', async () => {
      access.book.checkSharedLinkAccess.mockResolvedValue(new Set([bookId]));

      await expect(
        checkAccess(repository(), { auth: linkAuth(), permission: Permission.BookDownload, ids: [bookId] }),
      ).resolves.toEqual(new Set([bookId]));
      await expect(
        checkAccess(repository(), {
          auth: linkAuth({ allowDownload: false }),
          permission: Permission.BookDownload,
          ids: [bookId],
        }),
      ).resolves.toEqual(new Set());
    });

    it.each([Permission.BookUpdate, Permission.BookDelete, Permission.BookShare, Permission.BookCreate])(
      'should not be granted %s',
      async (permission) => {
        access.book.checkSharedLinkAccess.mockResolvedValue(new Set([bookId]));

        await expect(checkAccess(repository(), { auth: linkAuth(), permission, ids: [bookId] })).resolves.toEqual(
          new Set(),
        );
        expect(access.book.checkOwnerAccess).not.toHaveBeenCalled();
      },
    );

    it('should not read the photos of the book, nor any album', async () => {
      const assetId = newUuid();
      const auth = linkAuth();

      for (const permission of [Permission.AssetRead, Permission.AssetView, Permission.AssetDownload]) {
        await expect(checkAccess(repository(), { auth, permission, ids: [assetId] })).resolves.toEqual(new Set());
      }
      await expect(
        checkAccess(repository(), { auth, permission: Permission.AlbumRead, ids: [newUuid()] }),
      ).resolves.toEqual(new Set());
      expect(access.asset.checkOwnerAccess).not.toHaveBeenCalled();
      expect(access.book.checkSharedLinkAccess).not.toHaveBeenCalled();
    });

    it('should never upload, even if the link was saved with uploads allowed', async () => {
      const auth = linkAuth({ allowUpload: true });

      expect(() => requireUploadAccess(auth)).toThrow(UnauthorizedException);
      await expect(
        checkAccess(repository(), { auth, permission: Permission.AssetUpload, ids: [newUuid()] }),
      ).resolves.toEqual(new Set());
    });
  });

  describe('a shared link to an album', () => {
    it('should not read a book', async () => {
      const auth = factory.auth({ sharedLink: { albumId: newUuid() } });

      await expect(
        checkAccess(repository(), { auth, permission: Permission.BookRead, ids: [newUuid()] }),
      ).resolves.toEqual(new Set());
      expect(access.book.checkSharedLinkAccess).not.toHaveBeenCalled();
    });
  });

  describe('a user', () => {
    it('should share only the books they own', async () => {
      const auth = factory.auth();
      const bookId = newUuid();
      access.book.checkOwnerAccess.mockResolvedValue(new Set([bookId]));

      await expect(
        checkAccess(repository(), { auth, permission: Permission.BookShare, ids: [bookId] }),
      ).resolves.toEqual(new Set([bookId]));
      expect(access.book.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([bookId]));
    });
  });
});

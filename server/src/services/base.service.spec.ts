import { Readable } from 'node:stream';
import { BaseService } from 'src/services/base.service.js';
import { useS3Backend } from 'test/storage-backend.mock.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(BaseService.name, () => {
  let sut: BaseService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BaseService));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('ensureLocalFile', () => {
    it('returns the path as-is with a no-op cleanup for absolute paths', async () => {
      const result = await (sut as any).ensureLocalFile('/var/lib/immich/upload/abc.jpg');
      expect(result.localPath).toBe('/var/lib/immich/upload/abc.jpg');
      await expect(result.cleanup()).resolves.not.toThrow();
    });

    it('downloads relative keys via the backend and returns its cleanup', async () => {
      const backendCleanup = vi.fn().mockResolvedValue(void 0);
      const backend = {
        downloadToTemp: vi.fn().mockResolvedValue({ tempPath: '/tmp/abc.jpg', cleanup: backendCleanup }),
      };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(backend as any);

      const result = await (sut as any).ensureLocalFile('upload/user/abc.jpg');

      expect(StorageService.resolveBackendForKey).toHaveBeenCalledWith('upload/user/abc.jpg');
      expect(backend.downloadToTemp).toHaveBeenCalledWith('upload/user/abc.jpg');
      expect(result.localPath).toBe('/tmp/abc.jpg');
      await result.cleanup();
      expect(backendCleanup).toHaveBeenCalledOnce();
    });

    it('propagates errors from resolveBackendForKey without leaking cleanup', async () => {
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'resolveBackendForKey').mockImplementation(() => {
        throw new Error('unknown backend');
      });

      await expect((sut as any).ensureLocalFile('unknown://foo')).rejects.toThrow('unknown backend');
    });

    it('propagates errors from downloadToTemp without leaking cleanup', async () => {
      const backend = { downloadToTemp: vi.fn().mockRejectedValue(new Error('S3 unavailable')) };
      const { StorageService } = await import('src/services/storage.service.js');
      vi.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(backend as any);

      await expect((sut as any).ensureLocalFile('upload/user/abc.jpg')).rejects.toThrow('S3 unavailable');
    });
  });

  describe('withLocalFile', () => {
    it('removes the temporary copy after the work, also when it fails', async () => {
      const s3 = useS3Backend();

      const path = await (sut as any).withLocalFile('upload/a.jpg', (path: string) => Promise.resolve(path));
      expect(path).toBe(s3.temps[0].tempPath);
      await expect(
        (sut as any).withLocalFile('upload/b.jpg', () => Promise.reject(new Error('corrupt image'))),
      ).rejects.toThrow('corrupt image');
      expect(s3.temps.map(({ removed }) => removed)).toEqual([true, true]);
    });

    it('reads a file on disk where it is', async () => {
      const s3 = useS3Backend();
      await expect((sut as any).withLocalFile('/data/a.jpg', (path: string) => Promise.resolve(path))).resolves.toBe(
        '/data/a.jpg',
      );
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
    });
  });

  describe('withLocalFiles', () => {
    it('fetches each file once, and removes them all after the work', async () => {
      const s3 = useS3Backend();

      await (sut as any).withLocalFiles(async (files: any) => {
        await files.get('upload/a.jpg');
        await files.get('upload/a.jpg');
        await files.input('upload/b.jpg');
        await files.input('/data/c.jpg');
      });

      expect(s3.downloadToTemp).toHaveBeenCalledTimes(2);
      expect(s3.temps.every(({ removed }) => removed)).toBe(true);
    });
  });

  describe('readStoredFile', () => {
    it('reads a file on disk with the storage repository', async () => {
      mocks.storage.readFile.mockResolvedValue(Buffer.from('disk'));
      await expect((sut as any).readStoredFile('/data/a.jpg')).resolves.toEqual(Buffer.from('disk'));
    });

    it('reads an object of S3 into memory, without a temporary file', async () => {
      const s3 = useS3Backend();
      s3.stored.set('upload/a.jpg', { data: Buffer.from('s3') });

      await expect((sut as any).readStoredFile('upload/a.jpg')).resolves.toEqual(Buffer.from('s3'));
      expect(s3.downloadToTemp).not.toHaveBeenCalled();
    });
  });

  describe('storedFileExists', () => {
    it('checks a file on disk and an object of S3', async () => {
      const s3 = useS3Backend();
      s3.stored.set('upload/a.jpg', { data: Buffer.from('s3') });
      mocks.storage.checkFileExists.mockResolvedValue(true);

      await expect((sut as any).storedFileExists('/data/a.jpg')).resolves.toBe(true);
      await expect((sut as any).storedFileExists('upload/a.jpg')).resolves.toBe(true);
      await expect((sut as any).storedFileExists('upload/b.jpg')).resolves.toBe(false);
    });
  });

  describe('storeLocalFile', () => {
    it('leaves the file where it is with the disk backend', async () => {
      await expect((sut as any).storeLocalFile('/data/upload/a.jpg', 'upload/a.jpg')).resolves.toBe(
        '/data/upload/a.jpg',
      );
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
    });

    it('uploads the file to S3 and removes the local one', async () => {
      const s3 = useS3Backend();
      mocks.storage.createPlainReadStream.mockReturnValue(Readable.from([Buffer.from('jpeg')]));
      mocks.storage.unlink.mockResolvedValue();

      await expect((sut as any).storeLocalFile('/data/upload/a.jpg', 'upload/a.jpg', 'image/jpeg')).resolves.toBe(
        'upload/a.jpg',
      );
      expect(mocks.storage.createPlainReadStream).toHaveBeenCalledWith('/data/upload/a.jpg');
      expect(s3.stored.get('upload/a.jpg')).toEqual({ data: Buffer.from('jpeg'), contentType: 'image/jpeg' });
      expect(mocks.storage.unlink).toHaveBeenCalledWith('/data/upload/a.jpg');
    });

    it('keeps the local file when the upload fails', async () => {
      const s3 = useS3Backend();
      s3.put.mockRejectedValue(new Error('S3 unavailable'));
      mocks.storage.createPlainReadStream.mockReturnValue(Readable.from([Buffer.from('jpeg')]));

      await expect((sut as any).storeLocalFile('/data/upload/a.jpg', 'upload/a.jpg')).rejects.toThrow('S3 unavailable');
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
    });
  });

  describe('storeBuffer', () => {
    it('replaces the file on disk at once with the disk backend', async () => {
      await expect((sut as any).storeBuffer('/data/thumbs/b.pdf', 'thumbs/b.pdf', Buffer.from('%PDF'))).resolves.toBe(
        '/data/thumbs/b.pdf',
      );
      expect(mocks.storage.mkdirSync).toHaveBeenCalledWith('/data/thumbs');
      expect(mocks.storage.createOrOverwriteFile).toHaveBeenCalledWith('/data/thumbs/b.pdf.tmp', Buffer.from('%PDF'));
      expect(mocks.storage.rename).toHaveBeenCalledWith('/data/thumbs/b.pdf.tmp', '/data/thumbs/b.pdf');
    });

    it('puts the file in S3', async () => {
      const s3 = useS3Backend();

      await expect(
        (sut as any).storeBuffer('/data/thumbs/b.pdf', 'thumbs/b.pdf', Buffer.from('%PDF'), 'application/pdf'),
      ).resolves.toBe('thumbs/b.pdf');
      expect(s3.stored.get('thumbs/b.pdf')).toEqual({ data: Buffer.from('%PDF'), contentType: 'application/pdf' });
      expect(mocks.storage.createOrOverwriteFile).not.toHaveBeenCalled();
    });
  });
});

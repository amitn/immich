import { basename, isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { Mocked, vitest } from 'vitest';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { StorageService } from 'src/services/storage.service.js';

export type S3BackendMock = Mocked<StorageBackend> & {
  /** the temporary copies `downloadToTemp` made, and whether each was removed */
  temps: Array<{ key: string; tempPath: string; removed: boolean }>;
  /** what `put` stored, by key */
  stored: Map<string, { data: Buffer; contentType?: string }>;
};

/** a mocked S3 backend: `downloadToTemp` records its temporary copies, `put` keeps what it stored */
export const newS3BackendMock = (): S3BackendMock => {
  const temps: S3BackendMock['temps'] = [];
  const stored: S3BackendMock['stored'] = new Map();
  return {
    temps,
    stored,
    put: vitest.fn(async (key: string, source: Readable | Buffer, metadata?: { contentType?: string }) => {
      const data = Buffer.isBuffer(source) ? source : Buffer.concat(await source.toArray());
      stored.set(key, { data, contentType: metadata?.contentType });
    }),
    get: vitest.fn((key: string) => {
      const file = stored.get(key);
      return file
        ? Promise.resolve({ stream: Readable.from([file.data]), length: file.data.length })
        : Promise.reject(new Error(`NoSuchKey: ${key}`));
    }),
    exists: vitest.fn((key: string) => Promise.resolve(stored.has(key))),
    delete: vitest.fn().mockResolvedValue(undefined),
    deletePrefix: vitest.fn().mockResolvedValue(undefined),
    getPrefixUsage: vitest.fn().mockResolvedValue(0),
    getServeStrategy: vitest.fn((key: string) =>
      Promise.resolve({ type: 'redirect' as const, url: `https://s3.test/bucket/${key}?signature` }),
    ),
    getReadableUrl: vitest.fn((key: string) => Promise.resolve(`https://s3.test/bucket/${key}?signature`)),
    downloadToTemp: vitest.fn((key: string) => {
      const temp = { key, tempPath: `/tmp/immich-${temps.length}-${basename(key)}.tmp`, removed: false };
      temps.push(temp);
      return Promise.resolve({
        tempPath: temp.tempPath,
        cleanup: () => {
          temp.removed = true;
          return Promise.resolve();
        },
      });
    }),
  };
};

/**
 * Makes a mocked S3 backend the write backend of the test, and the backend of every key (a relative path), the way
 * `IMMICH_STORAGE_BACKEND=s3` does; absolute paths stay on disk. Restore with `vitest.restoreAllMocks()`.
 */
export const useS3Backend = (backend = newS3BackendMock()) => {
  const disk = new DiskStorageBackend('/data');
  vitest.spyOn(StorageService, 'getWriteBackend').mockReturnValue(backend);
  vitest
    .spyOn(StorageService, 'resolveBackendForKey')
    .mockImplementation((key: string) => (isAbsolute(key) ? disk : backend));
  return backend;
};

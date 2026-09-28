import { LocalFiles } from 'src/utils/local-files.js';

describe(LocalFiles.name, () => {
  const setup = () => {
    const removed: string[] = [];
    const open = vi.fn((path: string) => {
      if (path.startsWith('missing/')) {
        return Promise.reject(new Error(`NoSuchKey: ${path}`));
      }
      const localPath = `/tmp/${path.replaceAll('/', '_')}`;
      return Promise.resolve({
        localPath,
        cleanup: () => {
          removed.push(localPath);
          return Promise.resolve();
        },
      });
    });
    return { files: new LocalFiles(open), open, removed };
  };

  it('should fetch each file once, and remove every copy on cleanup', async () => {
    const { files, open, removed } = setup();

    await expect(files.get('upload/a.jpg')).resolves.toBe('/tmp/upload_a.jpg');
    await expect(files.get('upload/a.jpg')).resolves.toBe('/tmp/upload_a.jpg');
    await expect(files.get('upload/b.jpg')).resolves.toBe('/tmp/upload_b.jpg');
    expect(open).toHaveBeenCalledTimes(2);

    await files.cleanup();
    expect(removed.toSorted()).toEqual(['/tmp/upload_a.jpg', '/tmp/upload_b.jpg']);

    // a later cleanup has nothing left to remove
    await files.cleanup();
    expect(removed).toHaveLength(2);
  });

  it('should reject a file that cannot be fetched, and still clean up the others', async () => {
    const { files, removed } = setup();

    await files.get('upload/a.jpg');
    await expect(files.get('missing/b.jpg')).rejects.toThrow('NoSuchKey');
    await files.cleanup();
    expect(removed).toEqual(['/tmp/upload_a.jpg']);
  });

  it('should fetch the files of image inputs, and leave buffers and missing files as they are', async () => {
    const { files } = setup();
    const buffer = Buffer.from('jpeg');

    await expect(files.input('upload/a.jpg')).resolves.toBe('/tmp/upload_a.jpg');
    await expect(files.input(buffer)).resolves.toBe(buffer);
    await expect(files.input(null)).resolves.toBeNull();
    // the reader reports it like a missing file on disk
    await expect(files.input('missing/b.jpg')).resolves.toBe('missing/b.jpg');
  });

  it('should fetch the files of slots', async () => {
    const { files } = setup();
    const buffer = Buffer.from('map');

    await expect(
      files.inputs([{ input: 'upload/a.jpg', left: 1 }, null, { input: buffer, left: 2 }, { input: null, left: 3 }]),
    ).resolves.toEqual([
      { input: '/tmp/upload_a.jpg', left: 1 },
      null,
      { input: buffer, left: 2 },
      { input: null, left: 3 },
    ]);
  });
});

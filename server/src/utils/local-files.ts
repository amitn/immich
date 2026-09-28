/**
 * Local copies of files of the storage backends, for the tools that need a path on disk (sharp, exiftool). A file on
 * disk is its own local copy; a file on S3 is downloaded to a temporary file, which `cleanup` removes.
 */

export type LocalFile = { localPath: string; cleanup: () => Promise<void> };

export type LocalFileOpener = (path: string) => Promise<LocalFile>;

/**
 * The local copies of the files one piece of work reads, e.g. the photos of a book page: each file is fetched once,
 * when it is first needed, and `cleanup` removes every temporary copy
 */
export class LocalFiles {
  private files = new Map<string, Promise<LocalFile>>();

  constructor(private open: LocalFileOpener) {}

  /** the local path of a file; rejects when it can't be fetched */
  async get(path: string): Promise<string> {
    let file = this.files.get(path);
    if (!file) {
      file = this.open(path);
      this.files.set(path, file);
    }
    const { localPath } = await file;
    return localPath;
  }

  /**
   * An image input with its file fetched: a buffer (or nothing) stays as it is, and a file that can't be fetched keeps
   * its path, so that the reader reports it as it reports a missing file on disk
   */
  async input<T extends string | Buffer | null | undefined>(input: T): Promise<T | string> {
    if (typeof input !== 'string') {
      return input;
    }
    try {
      return await this.get(input);
    } catch {
      return input;
    }
  }

  /** the slots of a page (see `MediaRepository.composeBookPage`) or the tiles of a contact sheet, with their files fetched */
  inputs<T extends { input: string | Buffer | null } | null>(items: T[]): Promise<T[]> {
    return Promise.all(
      items.map(async (item) => (item ? ({ ...item, input: await this.input(item.input) } as T) : item)),
    );
  }

  /** removes the temporary copies */
  async cleanup(): Promise<void> {
    const files = this.files.values().toArray();
    this.files.clear();
    await Promise.all(
      files.map(async (file) => {
        try {
          const { cleanup } = await file;
          await cleanup();
        } catch {
          // a file that could not be fetched has no copy
        }
      }),
    );
  }
}

import { HighlightFormat } from '@immich/sdk';
import * as utils from '$lib/utils';
import {
  clearHighlightShareCache,
  downloadHighlightVideo,
  getHighlightFileName,
  shareHighlightVideo,
} from '$lib/utils/highlight';

describe('getHighlightFileName', () => {
  it('should name the file after the title, and mark a vertical video', () => {
    expect(getHighlightFileName({ title: 'Sicily 2009', format: HighlightFormat.Landscape })).toBe('Sicily 2009.mp4');
    expect(getHighlightFileName({ title: 'Sicily 2009', format: HighlightFormat.Vertical })).toBe(
      'Sicily 2009-vertical.mp4',
    );
    expect(getHighlightFileName({ title: 'Rome/Florence: 3 days', format: HighlightFormat.Vertical })).toBe(
      'Rome_Florence_ 3 days-vertical.mp4',
    );
    expect(getHighlightFileName({ title: ' ', format: HighlightFormat.Landscape })).toBe('Highlights.mp4');
  });
});

describe('shareHighlightVideo', () => {
  const video = new Blob(['mp4'], { type: 'video/mp4' });
  let downloadUrl: ReturnType<typeof vi.spyOn>;
  let downloadBlob: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearHighlightShareCache();
    downloadUrl = vi.spyOn(utils, 'downloadUrl').mockImplementation(() => {});
    downloadBlob = vi.spyOn(utils, 'downloadBlob').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(video)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  const stubShare = (share: () => Promise<void>, canShare = true) => {
    const mock = vi.fn(share);
    Object.defineProperties(navigator, {
      share: { value: mock, configurable: true },
      canShare: { value: vi.fn(() => canShare), configurable: true },
    });
    return mock;
  };

  it('should share the file where the browser can share files', async () => {
    const share = stubShare(() => Promise.resolve());

    await expect(shareHighlightVideo('video', 'Sicily-vertical.mp4', 'Sicily')).resolves.toBe('shared');

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/assets/video/original'));
    const [[{ files, title }]] = share.mock.calls as unknown as [[{ files: File[]; title: string }]];
    expect(title).toBe('Sicily');
    expect(files[0].name).toBe('Sicily-vertical.mp4');
    expect(files[0].type).toBe('video/mp4');
    expect(downloadUrl).not.toHaveBeenCalled();
  });

  it('should download the file where the browser can not share', async () => {
    await expect(shareHighlightVideo('video', 'Sicily-vertical.mp4', 'Sicily')).resolves.toBe('downloaded');
    expect(downloadUrl).toHaveBeenCalledWith(expect.stringContaining('/assets/video/original'), 'Sicily-vertical.mp4');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should download the file where the browser can not share files', async () => {
    stubShare(() => Promise.resolve(), false);
    await expect(shareHighlightVideo('video', 'Sicily-vertical.mp4', 'Sicily')).resolves.toBe('downloaded');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(File), 'Sicily-vertical.mp4');
  });

  it('should ask for another tap when loading the file took too long to share it, and not load it again', async () => {
    const share = stubShare(() => Promise.reject(new DOMException('no activation', 'NotAllowedError')));
    await expect(shareHighlightVideo('video', 'a.mp4', 'A')).resolves.toBe('again');

    share.mockResolvedValue();
    await expect(shareHighlightVideo('video', 'a.mp4', 'A')).resolves.toBe('shared');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should say when the user closed the share sheet', async () => {
    stubShare(() => Promise.reject(new DOMException('closed', 'AbortError')));
    await expect(shareHighlightVideo('video', 'a.mp4', 'A')).resolves.toBe('cancelled');
  });

  it('should fail when the video can not be loaded', async () => {
    stubShare(() => Promise.resolve());
    vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(shareHighlightVideo('video', 'a.mp4', 'A')).rejects.toThrow('404');
  });
});

describe('downloadHighlightVideo', () => {
  it('should download the original file under its name', () => {
    const downloadUrl = vi.spyOn(utils, 'downloadUrl').mockImplementation(() => {});
    downloadHighlightVideo('video', 'Sicily-vertical.mp4');
    expect(downloadUrl).toHaveBeenCalledWith(expect.stringContaining('/assets/video/original'), 'Sicily-vertical.mp4');
  });
});

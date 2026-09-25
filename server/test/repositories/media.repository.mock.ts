import { Mocked, vitest } from 'vitest';
import type { RepositoryInterface } from 'src/types.js';
import { MediaRepository } from 'src/repositories/media.repository.js';

export const newMediaRepositoryMock = (): Mocked<RepositoryInterface<MediaRepository>> => {
  return {
    generateThumbnail: vitest.fn().mockImplementation(() => Promise.resolve()),
    writeExif: vitest.fn().mockImplementation(() => Promise.resolve()),
    copyTagGroup: vitest.fn().mockImplementation(() => Promise.resolve()),
    generateThumbhash: vitest.fn().mockResolvedValue(Buffer.from('')),
    composeBookPage: vitest.fn().mockResolvedValue({ data: Buffer.from(''), slots: [] }),
    getEnhanceStats: vitest.fn(),
    enhanceImage: vitest.fn().mockResolvedValue({ data: Buffer.from(''), width: 0, height: 0 }),
    enhanceBitmap: vitest.fn().mockResolvedValue({ data: Buffer.from(''), info: { width: 0, height: 0, channels: 3 } }),
    renderEnhanceComparison: vitest.fn().mockResolvedValue(Buffer.from('')),
    decodeImage: vitest.fn().mockResolvedValue({ data: Buffer.from(''), info: {} }),
    cropImage: vitest.fn().mockResolvedValue({ data: Buffer.from(''), width: 0, height: 0 }),
    getAttentionPoint: vitest.fn().mockResolvedValue({ x: 0.5, y: 0.5 }),
    getGrayscale: vitest.fn().mockResolvedValue({ data: new Uint8Array(0), width: 0, height: 0 }),
    straightenImage: vitest.fn().mockResolvedValue({ data: Buffer.from(''), width: 0, height: 0 }),
    straightenBitmap: vitest
      .fn()
      .mockResolvedValue({ data: Buffer.from(''), info: { width: 0, height: 0, channels: 3 } }),
    cropBitmap: vitest.fn().mockResolvedValue({ data: Buffer.from(''), info: { width: 0, height: 0, channels: 3 } }),
    getSmallRgb: vitest.fn().mockResolvedValue({ data: Buffer.from(''), info: { width: 0, height: 0, channels: 3 } }),
    encodeJpeg: vitest.fn().mockResolvedValue({ data: Buffer.from(''), width: 0, height: 0 }),
    extract: vitest.fn().mockResolvedValue(null),
    probe: vitest.fn(),
    probePackets: vitest.fn().mockResolvedValue({
      totalDuration: 0,
      packetCount: 0,
      outputFrames: 0,
      keyframePts: [],
      keyframeAccDuration: [],
      keyframeOwnDuration: [],
    }),
    transcode: vitest.fn(),
    getImageMetadata: vitest.fn(),
    resizeToJpeg: vitest.fn(),
    createContactSheet: vitest.fn(),
    analyzeImage: vitest.fn(),
    upscaleImage: vitest.fn(),
  };
};

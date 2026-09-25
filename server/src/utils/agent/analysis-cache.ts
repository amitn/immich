import { LRUMap } from 'mnemonist';
import { ImageAnalysis } from 'src/utils/agent/scoring.js';

/** bumped whenever `ImageAnalysis` gains metrics, so that older entries are analyzed again */
export const ANALYSIS_VERSION = 2;

/** image analysis results keyed by asset, checksum and preview path, shared by every session and the book layout */
export const analysisCache = new LRUMap<string, ImageAnalysis>(20_000);

export const getAnalysisKey = (asset: { id: string; checksum: Buffer; previewPath: string }) =>
  `v${ANALYSIS_VERSION}:${asset.id}:${asset.checksum.toString('hex')}:${asset.previewPath}`;

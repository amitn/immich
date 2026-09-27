import { LRUMap } from 'mnemonist';
import { ImageAnalysis } from 'src/utils/agent/scoring.js';
import { TiltEstimate } from 'src/utils/agent/straighten.js';

/** bumped whenever `ImageAnalysis` gains metrics, so that older entries are analyzed again */
export const ANALYSIS_VERSION = 2;

/**
 * image analysis results keyed by asset, checksum and preview path, shared by every session and the book layout; the
 * analyses of simulated improvements (see `getSimulatedAnalysisKey`) are kept here too
 */
export const analysisCache = new LRUMap<string, ImageAnalysis>(20_000);

/** measured tilts of previews, by the same keys as `analysisCache` */
export const tiltCache = new LRUMap<string, TiltEstimate>(20_000);

export const getAnalysisKey = (asset: { id: string; checksum: Buffer; previewPath: string }) =>
  `v${ANALYSIS_VERSION}:${asset.id}:${asset.checksum.toString('hex')}:${asset.previewPath}`;

/** the analysis of the preview after the fixes of a recipe (see `getRecipeKey`) */
export const getSimulatedAnalysisKey = (
  asset: { id: string; checksum: Buffer; previewPath: string },
  recipeKey: string,
) => `${getAnalysisKey(asset)}:${recipeKey}`;

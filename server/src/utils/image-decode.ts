import { SystemConfig } from 'src/dtos/config.dto.js';
import { Colorspace } from 'src/enum.js';
import { ExtractResult, MediaRepository } from 'src/repositories/media.repository.js';
import { Bitmap, DecodeToBufferOptions } from 'src/types.js';
import { mimeTypes } from 'src/utils/mime-types.js';

type ColorInfo = {
  colorspace: string | null;
  profileDescription: string | null;
  bitsPerSample: number | null;
};

export type DecodableExif = ColorInfo & { orientation: string | null };

export type DecodableAsset = {
  originalPath: string;
  originalFileName: string;
  exifInfo: DecodableExif;
};

export type DecodedImage = Bitmap & {
  colorspace: string;
  /** the embedded preview that was decoded instead of the original, if any */
  extracted: ExtractResult | null;
};

export const isSRGB = ({ colorspace, profileDescription, bitsPerSample }: ColorInfo): boolean => {
  if (colorspace || profileDescription) {
    return [colorspace, profileDescription].some((s) => s?.toLowerCase().includes('srgb'));
  }
  if (bitsPerSample) {
    // assume sRGB for 8-bit images with no color profile or colorspace metadata
    return bitsPerSample === 8;
  }
  // assume sRGB for images with no relevant metadata
  return true;
};

/** Extracts the embedded preview of a RAW file, as long as it is at least `minSize` on its short side. */
export const extractEmbeddedImage = async (
  mediaRepository: MediaRepository,
  originalPath: string,
  minSize: number,
): Promise<ExtractResult | null> => {
  const extracted = await mediaRepository.extract(originalPath);
  if (!extracted) {
    return null;
  }

  const { width, height } = await mediaRepository.getImageMetadata(extracted.buffer);
  return Math.min(width, height) >= minSize ? extracted : null;
};

export const extractOriginalEmbeddedImage = (
  mediaRepository: MediaRepository,
  asset: Pick<DecodableAsset, 'originalPath' | 'originalFileName'>,
  image: SystemConfig['image'],
) =>
  image.extractEmbedded && mimeTypes.isRaw(asset.originalFileName)
    ? extractEmbeddedImage(mediaRepository, asset.originalPath, image.preview.size)
    : Promise.resolve(null);

export const decodeImageWithExif = async (
  mediaRepository: MediaRepository,
  source: string | Buffer,
  exifInfo: DecodableExif,
  image: SystemConfig['image'],
  size?: number,
) => {
  const colorspace = isSRGB(exifInfo) ? Colorspace.Srgb : image.colorspace;
  const decodeOptions: DecodeToBufferOptions = {
    colorspace,
    processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
    size,
    orientation: exifInfo.orientation ? Number(exifInfo.orientation) : undefined,
  };

  const { info, data } = await mediaRepository.decodeImage(source, decodeOptions);
  return { info, data, colorspace };
};

/**
 * Decodes the original of an image asset into upright pixels, preferring a large enough embedded preview for RAW files.
 * Without a `size` the image is decoded at full resolution.
 */
export const decodeOriginal = async (
  mediaRepository: MediaRepository,
  asset: DecodableAsset,
  image: SystemConfig['image'],
  options: { size?: number; extracted?: ExtractResult | null } = {},
): Promise<DecodedImage> => {
  const extracted =
    options.extracted === undefined
      ? await extractOriginalEmbeddedImage(mediaRepository, asset, image)
      : options.extracted;

  const { data, info, colorspace } = await decodeImageWithExif(
    mediaRepository,
    extracted ? extracted.buffer : asset.originalPath,
    // only specify orientation to extracted images which don't have EXIF orientation data
    // or it can double rotate the image
    extracted ? asset.exifInfo : { ...asset.exifInfo, orientation: null },
    image,
    options.size,
  );

  return { data, info, colorspace, extracted };
};

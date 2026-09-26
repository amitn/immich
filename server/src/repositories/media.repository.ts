import { Injectable } from '@nestjs/common';
import { ExifDateTime, WriteTags, exiftool } from 'exiftool-vendored';
import ffmpeg, { FfprobeData, FfprobeStream } from 'fluent-ffmpeg';
import { camelCase, upperFirst } from 'lodash-es';
import { Duration } from 'luxon';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { Writable } from 'node:stream';
import sharp, { OverlayOptions, Sharp } from 'sharp';
import type {
  Bitmap,
  DecodeToBufferOptions,
  GenerateThumbhashOptions,
  GenerateThumbnailOptions,
  ImageDimensions,
  ProbeOptions,
  RawImageInfo,
  TranscodeCommand,
  TransformOptions,
  VideoInfo,
  VideoPacketInfo,
} from 'src/types.js';
import type { ImageAnalysis } from 'src/utils/agent/scoring.js';
import { ORIENTATION_TO_SHARP_ROTATION } from 'src/constants.js';
import { Exif } from 'src/database.js';
import { AssetEditAction, AssetEditActionItem, CropParameters } from 'src/dtos/editing.dto.js';
import {
  AacProfile,
  Av1Profile,
  ColorMatrix,
  ColorPrimaries,
  ColorTransfer,
  Colorspace,
  DvProfile,
  DvSignalCompatibility,
  H264Profile,
  HevcProfile,
  LogLevel,
  RawExtractedFormat,
} from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { toCanvasRect } from 'src/utils/agent/straighten.js';
import { BookPageComposeResult, BookPageComposeSpec, getCropRegion } from 'src/utils/book/render.js';
import {
  EnhancePlan,
  ImageStats,
  applyLocalContrast,
  computeClaheLuts,
  computeImageStats,
  getLinearCoefficients,
  toLuma,
} from 'src/utils/enhance.js';
import { handlePromiseError } from 'src/utils/misc.js';
import { createAffineMatrix } from 'src/utils/transform.js';

const probe = (input: string, options: string[]): Promise<FfprobeData> =>
  new Promise((resolve, reject) =>
    // eslint-disable-next-line import-x/no-named-as-default-member
    ffmpeg.ffprobe(input, options, (error, data) => (error ? reject(error) : resolve(data))),
  );

const pascalCase = (str: string) => upperFirst(camelCase(str.toLowerCase()));

const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

type ProgressEvent = {
  frames: number;
  currentFps: number;
  currentKbps: number;
  targetSize: number;
  timemark: string;
  percent?: number;
};

export type ExtractResult = {
  buffer: Buffer;
  format: RawExtractedFormat;
};

@Injectable()
export class MediaRepository {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(MediaRepository.name);
    // eslint-disable-next-line import-x/no-named-as-default-member
    sharp.concurrency(0);
    // eslint-disable-next-line import-x/no-named-as-default-member
    sharp.cache({ files: 0 });
  }

  /**
   *
   * @param input file path to the input image
   * @returns ExtractResult if succeeded, or null if failed
   */
  async extract(input: string): Promise<ExtractResult | null> {
    for (const { tag, format } of [
      { tag: 'JpgFromRaw2', format: RawExtractedFormat.Jpeg },
      { tag: 'JpgFromRaw', format: RawExtractedFormat.Jpeg },
      { tag: 'PreviewJXL', format: RawExtractedFormat.Jxl },
      { tag: 'PreviewImage', format: RawExtractedFormat.Jpeg },
    ]) {
      try {
        const buffer = await exiftool.extractBinaryTagToBuffer(tag, input);
        this.logger.debug(`Successfully extracted ${tag} buffer from image`);
        return { buffer, format };
      } catch (error: any) {
        this.logger.debug(`Could not extract ${tag} buffer from image: ${error}`);
      }
    }
    return null;
  }

  async writeExif(tags: Partial<Exif>, output: string): Promise<boolean> {
    try {
      const tagsToWrite: WriteTags = {
        ExifImageWidth: tags.exifImageWidth,
        ExifImageHeight: tags.exifImageHeight,
        DateTimeOriginal: tags.dateTimeOriginal && ExifDateTime.fromMillis(tags.dateTimeOriginal.getTime()),
        ModifyDate: tags.modifyDate && ExifDateTime.fromMillis(tags.modifyDate.getTime()),
        TimeZone: tags.timeZone,
        GPSLatitude: tags.latitude,
        GPSLongitude: tags.longitude,
        ProjectionType: tags.projectionType,
        City: tags.city,
        Country: tags.country,
        Make: tags.make,
        Model: tags.model,
        LensModel: tags.lensModel,
        Fnumber: tags.fNumber?.toFixed(1),
        FocalLength: tags.focalLength?.toFixed(1),
        ISO: tags.iso,
        ExposureTime: tags.exposureTime,
        ProfileDescription: tags.profileDescription,
        ColorSpace: tags.colorspace,
        Rating: tags.rating === null ? 0 : tags.rating,
        // specially convert Orientation to numeric Orientation# for exiftool
        'Orientation#': tags.orientation ? Number(tags.orientation) : undefined,
      };

      await exiftool.write(output, tagsToWrite, {
        ignoreMinorErrors: true,
        writeArgs: ['-overwrite_original'],
      });
      return true;
    } catch (error: any) {
      this.logger.warn(`Could not write exif data to image: ${error.message}`);
      return false;
    }
  }

  async copyTagGroup(tagGroup: string, source: string, target: string): Promise<boolean> {
    try {
      await exiftool.write(
        target,
        {},
        {
          ignoreMinorErrors: true,
          writeArgs: ['-TagsFromFile', source, `-${tagGroup}:all>${tagGroup}:all`, '-overwrite_original'],
        },
      );
      return true;
    } catch (error: any) {
      this.logger.warn(`Could not copy tag data to image: ${error.message}`);
      return false;
    }
  }

  async decodeImage(input: string | Buffer, options: DecodeToBufferOptions): Promise<Bitmap> {
    const decoded = await this.getImageDecodingPipeline(input, options).raw().toBuffer({ resolveWithObject: true });
    return await this.transform(decoded, options);
  }

  /** Crops a decoded image and encodes it as JPEG; with `size` the result is scaled down to fit inside that box. */
  async cropImage(
    image: Bitmap,
    crop: CropParameters,
    { colorspace, quality = 95, size }: { colorspace: string; quality?: number; size?: number },
  ): Promise<{ data: Buffer; width: number; height: number }> {
    const transformed = await this.transform(image, {
      size,
      fit: 'inside',
      edits: [{ action: AssetEditAction.Crop, parameters: crop }],
    });
    const { data, info } = await this.tag(transformed, colorspace)
      .jpeg({ quality, chromaSubsampling: quality >= 80 ? '4:4:4' : '4:2:0' })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }

  /** Finds the focal point of an image with sharp's attention strategy, as fractions (0..1) of the upright image. */
  async getAttentionPoint(input: string | Buffer): Promise<{ x: number; y: number }> {
    const { data, info } = await this.encoded(input, 'none')
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    // a crop narrower than the image keeps the scale at 1, so the focal point is in the same coordinates
    const { info: result } = await this.raw({ data, info })
      // eslint-disable-next-line import-x/no-named-as-default-member
      .resize(Math.max(1, Math.ceil(width / 2)), height, { fit: 'cover', position: sharp.strategy.attention })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const x = result.attentionX ?? width / 2;
    const y = result.attentionY ?? height / 2;
    return { x: Math.min(Math.max(x / width, 0), 1), y: Math.min(Math.max(y / height, 0), 1) };
  }

  /** A small upright grayscale copy, e.g. to find the tilt of a photo. */
  async getGrayscale(
    input: string | Buffer | Bitmap,
    size = 512,
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    const source =
      typeof input === 'string' || Buffer.isBuffer(input) ? this.encoded(input, 'none').rotate() : this.raw(input);
    const { data, info } = await source
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data.buffer, data.byteOffset, info.width * info.height),
      width: info.width,
      height: info.height,
    };
  }

  /**
   * Rotates an image by a small angle (clockwise when positive), keeps the largest part without blank corners, applies
   * `crop` (in pixels of that straightened image, or null for all of it) and encodes a JPEG.
   */
  async straightenImage(
    image: Bitmap,
    angle: number,
    crop: CropParameters | null,
    { colorspace, quality = 95, size }: { colorspace: string; quality?: number; size?: number },
  ): Promise<{ data: Buffer; width: number; height: number }> {
    const straightened = await this.straightenBitmap(image, angle, crop, size);
    return this.encodeJpeg(straightened, { colorspace, quality });
  }

  /** `straightenImage` without the encoding: the raw pixels, optionally scaled down to fit inside `size` */
  async straightenBitmap(image: Bitmap, angle: number, crop: CropParameters | null, size?: number): Promise<Bitmap> {
    const rotated = await this.raw(image)
      .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rect = toCanvasRect(crop, rotated.info, image.info, angle);
    const left = Math.min(Math.max(Math.ceil(rect.x), 0), rotated.info.width - 1);
    const top = Math.min(Math.max(Math.ceil(rect.y), 0), rotated.info.height - 1);
    // round inwards so no blank corner pixel survives
    const width = Math.max(1, Math.min(Math.floor(rect.x + rect.width) - left, rotated.info.width - left));
    const height = Math.max(1, Math.min(Math.floor(rect.y + rect.height) - top, rotated.info.height - top));

    let pipeline = this.raw({ data: rotated.data, info: rotated.info as RawImageInfo }).extract({
      left,
      top,
      width,
      height,
    });
    if (size) {
      pipeline = pipeline.resize(size, size, { fit: 'inside', withoutEnlargement: true });
    }
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    return { data, info: info as RawImageInfo };
  }

  /** The raw pixels of a crop (in pixels) of a decoded image */
  async cropBitmap(image: Bitmap, crop: CropParameters): Promise<Bitmap> {
    const left = Math.min(Math.max(Math.round(crop.x), 0), image.info.width - 1);
    const top = Math.min(Math.max(Math.round(crop.y), 0), image.info.height - 1);
    const { data, info } = await this.raw(image)
      .extract({
        left,
        top,
        width: Math.max(1, Math.min(Math.round(crop.width), image.info.width - left)),
        height: Math.max(1, Math.min(Math.round(crop.height), image.info.height - top)),
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, info: info as RawImageInfo };
  }

  /**
   * JPEGs of crops (in pixels) of a decoded image, e.g. tiles of a menu for OCR at full resolution; each fits in
   * `maxSize` x `maxSize` when given
   */
  async getJpegCrops(
    image: Bitmap,
    crops: CropParameters[],
    { quality = 92, maxSize }: { quality?: number; maxSize?: number } = {},
  ) {
    const results: Buffer[] = [];
    for (const crop of crops) {
      const left = Math.min(Math.max(Math.round(crop.x), 0), image.info.width - 1);
      const top = Math.min(Math.max(Math.round(crop.y), 0), image.info.height - 1);
      let pipeline = this.raw(image).extract({
        left,
        top,
        width: Math.max(1, Math.min(Math.round(crop.width), image.info.width - left)),
        height: Math.max(1, Math.min(Math.round(crop.height), image.info.height - top)),
      });
      if (maxSize) {
        pipeline = pipeline.resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true });
      }
      results.push(await pipeline.jpeg({ quality }).toBuffer());
    }
    return results;
  }

  /** An 8-bit sRGB copy of an image that fits in `size` x `size`, e.g. to try out corrections on a preview */
  async getSmallRgb(input: string | Buffer, size = 512): Promise<Bitmap> {
    const { data, info } = await this.encoded(input, 'none')
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, info: info as RawImageInfo };
  }

  /** Encodes a decoded image as JPEG, tagged with its colourspace */
  async encodeJpeg(
    image: Bitmap,
    { colorspace, quality = 95 }: { colorspace: string; quality?: number },
  ): Promise<{ data: Buffer; width: number; height: number }> {
    const { data, info } = await this.tag(image, colorspace)
      .jpeg({ quality, chromaSubsampling: quality >= 80 ? '4:4:4' : '4:2:0' })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }

  private edit(pipeline: Sharp, edits: AssetEditActionItem[]): Sharp {
    const crop = edits.find((edit) => edit.action === 'crop');
    if (crop) {
      pipeline = pipeline.extract({
        left: Math.round(crop.parameters.x),
        top: Math.round(crop.parameters.y),
        width: Math.round(crop.parameters.width),
        height: Math.round(crop.parameters.height),
      });
    }

    const affineEditOperations = edits.filter((edit) => edit.action !== 'crop');
    if (affineEditOperations.length > 0) {
      const { a, b, c, d } = createAffineMatrix(affineEditOperations);
      pipeline = pipeline.affine([
        [a, b],
        [c, d],
      ]);
    }

    return pipeline;
  }

  async generateThumbnail(image: Bitmap, options: GenerateThumbnailOptions, output: string): Promise<void> {
    const transformed = await this.transform(image, options);
    await this.tag(transformed, options.colorspace)
      .toFormat(options.format, {
        quality: options.quality,
        // this is default in libvips (except the threshold is 90), but we need to set it manually in sharp
        chromaSubsampling: options.quality >= 80 ? '4:4:4' : '4:2:0',
        progressive: options.progressive,
      })
      .toFile(output);
  }

  private getImageDecodingPipeline(input: string | Buffer, options: DecodeToBufferOptions) {
    // some invalid images can still be processed by sharp, but we want to fail on them by default to avoid crashes
    let pipeline = this.encoded(input, options.processInvalidImages ? 'none' : 'error')
      .pipelineColorspace(this.getPipelineColorspace(options.colorspace))
      .withIccProfile(options.colorspace);

    const { angle, flip, flop } = options.orientation ? ORIENTATION_TO_SHARP_ROTATION[options.orientation] : {};
    pipeline = pipeline.rotate(angle);
    if (flip) {
      pipeline = pipeline.flip();
    }

    if (flop) {
      pipeline = pipeline.flop();
    }

    return pipeline;
  }

  private getPipelineColorspace(colorspace: string) {
    return colorspace === Colorspace.Srgb ? 'srgb' : 'rgb16';
  }

  /* Resamples in linear light; averaging gamma-encoded values darkens the result and loses detail. `colorspace`
   * always has a sRGB transfer function and scRGB applies no primaries matrix, so linearising as sRGB is exact. */
  private transform(image: Bitmap, { size, fit = 'outside', edits = [] }: TransformOptions): Promise<Bitmap> {
    if (!size && edits.length === 0) {
      return Promise.resolve(image);
    }

    return this.edit(this.raw(image).pipelineColorspace('scrgb'), edits)
      .resize(size, size, { fit, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
  }

  private raw({ data, info: raw }: Bitmap) {
    return sharp(data, { raw, limitInputChannels: false, limitInputPixels: false, unlimited: true });
  }

  private encoded(image: string | Buffer, failOn: 'none' | 'error') {
    return sharp(image, { failOn, limitInputChannels: false, limitInputPixels: false, unlimited: true });
  }

  /** Re-attaches the profile, converting nothing: the pixels are already in that colourspace. */
  private tag(image: Bitmap, colorspace: string): Sharp {
    return this.raw(image).pipelineColorspace(this.getPipelineColorspace(colorspace)).withIccProfile(colorspace);
  }

  async generateThumbhash(image: Bitmap, options: GenerateThumbhashOptions): Promise<Buffer> {
    const { rgbaToThumbHash } = await import('thumbhash');

    const transformed = await this.transform(image, { edits: options.edits, fit: 'inside', size: 100 });

    const { data, info } = await sharp(transformed.data, { raw: transformed.info })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return Buffer.from(rgbaToThumbHash(info.width, info.height, data));
  }

  /** Draws book page slots one at a time (to bound memory), then the text overlay, and encodes the page as JPEG */
  async composeBookPage(spec: BookPageComposeSpec): Promise<BookPageComposeResult> {
    const layers: OverlayOptions[] = [];
    const slots: BookPageComposeResult['slots'] = [];
    const options = { autoOrient: true, failOn: 'none', limitInputPixels: false, unlimited: true } as const;

    for (const slot of spec.slots) {
      if (!slot) {
        slots.push(null);
        continue;
      }

      try {
        const { autoOrient } = await sharp(slot.input, options).metadata();
        const region = getCropRegion(slot.crop, autoOrient.width, autoOrient.height);
        const { data, info } = await sharp(slot.input, options)
          .extract(region)
          .resize(slot.width, slot.height, { fit: 'cover', position: 'centre' })
          .flatten({ background: spec.background })
          .toColourspace('srgb')
          .raw()
          .toBuffer({ resolveWithObject: true });

        layers.push({
          input: data,
          raw: { width: info.width, height: info.height, channels: info.channels },
          left: slot.left,
          top: slot.top,
        });
        slots.push({ width: region.width, height: region.height });
      } catch (error: any) {
        this.logger.warn(`Could not draw book slot: ${error?.message ?? error}`);
        slots.push({ error: String(error?.message ?? error) });
      }
    }

    if (spec.overlay) {
      layers.push({ input: Buffer.from(spec.overlay), left: 0, top: 0 });
    }

    const data = await sharp({
      create: { width: spec.width, height: spec.height, channels: 3, background: spec.background },
    })
      .composite(layers)
      .jpeg({ quality: spec.quality, chromaSubsampling: spec.quality >= 90 ? '4:4:4' : '4:2:0' })
      .toBuffer();

    return { data, slots };
  }

  /** Auto-enhance statistics of a decoded image, downscaled to fit in `size` x `size` */
  async getEnhanceStats(image: Bitmap, size = 512): Promise<ImageStats> {
    const { data, info } = await this.raw(image)
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    return computeImageStats(data, info.width, info.height, info.channels);
  }

  /** Applies an auto-enhance plan to a decoded image and encodes the result as JPEG */
  async enhanceImage(
    image: Bitmap,
    plan: EnhancePlan,
    { colorspace, quality = 93 }: { colorspace: string; quality?: number },
  ): Promise<{ data: Buffer; width: number; height: number }> {
    const enhanced = await this.applyEnhanceTones(image, plan);
    const { data, info } = await this.applyEnhanceFinish(this.tag(enhanced, colorspace), plan)
      .jpeg({ quality, chromaSubsampling: quality >= 80 ? '4:4:4' : '4:2:0' })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }

  /** `enhanceImage` without the encoding: the raw 8-bit pixels (three channels) */
  async enhanceBitmap(image: Bitmap, plan: EnhancePlan): Promise<Bitmap> {
    const enhanced = await this.applyEnhanceTones(image, plan);
    const { data, info } = await this.applyEnhanceFinish(this.raw(enhanced), plan)
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, info: info as RawImageInfo };
  }

  /** The image before and after an auto-enhance plan, side by side in a JPEG at most `width` wide */
  async renderEnhanceComparison(
    image: Bitmap,
    plan: EnhancePlan,
    { width = 1024, quality = 82 }: { width?: number; quality?: number } = {},
  ): Promise<Buffer> {
    const gap = 8;
    const half = Math.floor((width - gap) / 2);
    const before = await this.raw(image)
      .resize(half, Math.round(half * 1.5), { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const after = await this.applyEnhanceFinish(this.raw(await this.applyEnhanceTones(before, plan)), plan)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width: w, height: h } = before.info;
    const label = (text: string) => {
      const fontSize = Math.max(12, Math.round(w * 0.035));
      const labelWidth = Math.round(fontSize * (0.62 * text.length + 1));
      const labelHeight = Math.round(fontSize * 1.5);
      return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}" height="${labelHeight}">` +
          `<rect width="100%" height="100%" rx="${Math.round(fontSize * 0.3)}" fill="#000" fill-opacity="0.6"/>` +
          `<text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" ` +
          `font-weight="bold" font-size="${fontSize}" fill="#fff">${text}</text></svg>`,
      );
    };

    return sharp({ create: { width: w * 2 + gap, height: h, channels: 3, background: '#1c1c1c' } })
      .composite([
        { input: before.data, raw: before.info, left: 0, top: 0 },
        { input: after.data, raw: after.info, left: w + gap, top: 0 },
        { input: label('Before'), left: 6, top: 6 },
        { input: label('After'), left: w + gap + 6, top: 6 },
      ])
      .jpeg({ quality })
      .toBuffer();
  }

  /* The tonal corrections of an auto-enhance plan, as separate stages because sharp applies the operations of one
   * pipeline in a fixed order: noise reduction, then white balance and levels, then gamma, then local contrast. */
  private async applyEnhanceTones(image: Bitmap, plan: EnhancePlan): Promise<Bitmap> {
    let current = image;
    if (current.info.channels !== 3) {
      current = await this.toBitmap(this.raw(current).flatten({ background: '#ffffff' }).toColourspace('srgb'));
    }

    if (plan.denoise || plan.levels || plan.whiteBalance) {
      let pipeline = this.raw(current);
      if (plan.denoise) {
        pipeline = pipeline.median(plan.denoise.size);
      }
      if (plan.levels || plan.whiteBalance) {
        const { a, b } = getLinearCoefficients(plan);
        pipeline = pipeline.linear(a, b);
      }
      current = await this.toBitmap(pipeline);
    }

    if (plan.exposure) {
      const gamma = Math.min(Math.max(plan.exposure.gamma, 1 / 3), 3);
      // sharp brightens with `gammaOut` and darkens with `gamma`: without a resize only one of them has an effect
      current = await this.toBitmap(
        gamma >= 1 ? this.raw(current).gamma(1, gamma) : this.raw(current).gamma(1 / gamma, 1),
      );
    }

    if (plan.localContrast) {
      // libvips' CLAHE is very slow on large images, so the tile histograms come from a downscaled copy
      const sample = await this.toBitmap(
        this.raw(current).resize(512, 512, { fit: 'inside', withoutEnlargement: true }),
      );
      const pixels = sample.info.width * sample.info.height;
      const luma = new Uint8Array(pixels);
      for (let i = 0; i < pixels; i++) {
        luma[i] = Math.round(toLuma(sample.data[i * 3], sample.data[i * 3 + 1], sample.data[i * 3 + 2]));
      }
      const luts = computeClaheLuts(luma, sample.info.width, sample.info.height, plan.localContrast);
      const data = current === image ? Buffer.from(image.data) : current.data;
      applyLocalContrast(data, current.info.width, current.info.height, 3, luts, plan.localContrast.amount);
      current = { data, info: current.info };
    }

    return current;
  }

  private toBitmap(pipeline: Sharp): Promise<Bitmap> {
    return pipeline.raw().toBuffer({ resolveWithObject: true });
  }

  private applyEnhanceFinish(pipeline: Sharp, { saturation, sharpen }: EnhancePlan): Sharp {
    if (saturation) {
      pipeline = pipeline.modulate({ saturation: saturation.factor });
    }
    if (sharpen) {
      pipeline = pipeline.sharpen(sharpen);
    }
    return pipeline;
  }

  async probe(input: string, options?: ProbeOptions): Promise<VideoInfo> {
    const results = await probe(input, options?.countFrames ? ['-count_packets'] : []); // gets frame count quickly: https://stackoverflow.com/a/28376817
    return {
      format: {
        formatName: results.format.format_name,
        formatLongName: results.format.format_long_name,
        duration: this.parseFloat(results.format.duration),
        bitrate: this.parseInt(results.format.bit_rate),
      },
      videoStreams: results.streams
        .filter((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
        .sort((a, b) => this.compareStreams(a, b))
        .map((stream) => {
          const height = this.parseInt(stream.height);
          const dar = this.getDar(stream.display_aspect_ratio);
          return {
            index: stream.index,
            height,
            width: dar ? Math.round(height * dar) : this.parseInt(stream.width),
            codecName: stream.codec_name === 'h265' ? 'hevc' : (stream.codec_name ?? null),
            profile: this.parseVideoProfile(stream.codec_name, stream.profile as string | undefined) ?? null,
            level: this.parseOptionalInt(stream.level),
            frameCount: this.parseInt(options?.countFrames ? stream.nb_read_packets : stream.nb_frames),
            frameRate: this.parseFrameRate(stream.avg_frame_rate ?? stream.r_frame_rate),
            timeBase: this.parseRational(stream.time_base)?.den ?? null,
            rotation: this.parseInt(stream.rotation),
            bitrate: this.parseInt(stream.bit_rate),
            pixelFormat: stream.pix_fmt || 'yuv420p',
            colorPrimaries: this.parseEnum(ColorPrimaries, stream.color_primaries) ?? ColorPrimaries.Unknown,
            colorMatrix: this.parseEnum(ColorMatrix, stream.color_space) ?? ColorMatrix.Unknown,
            colorTransfer: this.parseEnum(ColorTransfer, stream.color_transfer) ?? ColorTransfer.Unknown,
            dvProfile: this.parseOptionalInt(stream.dv_profile) as DvProfile | null,
            dvLevel: this.parseOptionalInt(stream.dv_level),
            dvBlSignalCompatibilityId: this.parseOptionalInt(
              stream.dv_bl_signal_compatibility_id,
            ) as DvSignalCompatibility | null,
          };
        }),
      audioStreams: results.streams
        .filter((stream) => stream.codec_type === 'audio')
        .sort((a, b) => this.compareStreams(a, b))
        .map((stream) => ({
          index: stream.index,
          codecName: stream.codec_name ?? null,
          profile:
            stream.codec_name === 'aac' ? this.parseEnum(AacProfile, stream.profile as string | undefined) : null,
          bitrate: this.parseInt(stream.bit_rate),
        })),
    };
  }

  /**
   * Needed for accurate segments, especially when remuxing, seeking and/or VFR is involved.
   * Scanning packets for keyframes in JS is much faster than -skip_frame nokey since it avoids decoding the video.
   */
  probePackets(input: string, streamIndex: number): Promise<VideoPacketInfo | null> {
    const ffprobe = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        String(streamIndex),
        '-show_entries',
        'packet=pts,duration,flags',
        '-of',
        'csv=p=0',
        input,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let totalDuration = 0;
    const keyframePts: number[] = [];
    const keyframeAccDuration: number[] = [];
    const keyframeOwnDuration: number[] = [];
    const postDiscard: { pts: number; duration: number }[] = [];
    const parseLine = (line: string) => {
      if (!line) {
        return;
      }
      const [ptsStr, durationStr, flags] = line.split(',', 3);
      const pts = Number.parseInt(ptsStr);
      const duration = Number.parseInt(durationStr);
      if (Number.isNaN(pts) || Number.isNaN(duration) || !flags) {
        return;
      }
      // Discarded packets don't contribute to packet count, but still contribute to video duration
      totalDuration += duration;
      if (flags[1] !== 'D') {
        postDiscard.push({ pts, duration });
      }

      if (flags[0] !== 'K') {
        return;
      }

      keyframePts.push(pts);
      keyframeAccDuration.push(totalDuration);
      // VFR content can have variable duration keyframes,
      // so we need to track their duration separately for accurate segment boundaries.
      // Non-keyframes are accounted for in totalDuration.
      keyframeOwnDuration.push(duration);
    };

    let stderr = '';
    let remainder = '';
    ffprobe.stderr.setEncoding('utf8');
    ffprobe.stderr.on('data', (chunk: string) => (stderr += chunk));
    ffprobe.stdout.setEncoding('utf8');
    ffprobe.stdout.on('data', (chunk: string) => {
      const lines = chunk.split('\n');
      lines[0] = remainder + lines[0];
      remainder = lines.pop() as string;
      for (const line of lines) {
        parseLine(line);
      }
    });

    return new Promise<VideoPacketInfo | null>((resolve, reject) => {
      ffprobe.on('error', reject);
      ffprobe.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe exited with code ${code}: ${stderr.trim()}`));
        }
        parseLine(remainder);
        if (postDiscard.length === 0) {
          return resolve(null);
        }

        resolve({
          totalDuration,
          packetCount: postDiscard.length,
          outputFrames: this.cfrOutputFrames(postDiscard, postDiscard.length / totalDuration),
          keyframePts,
          keyframeAccDuration,
          keyframeOwnDuration,
        });
      });
    });
  }

  transcode(input: string, output: string | Writable, options: TranscodeCommand): Promise<void> {
    if (!options.twoPass) {
      return new Promise((resolve, reject) => {
        this.configureFfmpegCall(input, output, options)
          .on('error', reject)
          .on('end', () => resolve())
          .run();
      });
    }

    if (typeof output !== 'string') {
      throw new TypeError('Two-pass transcoding does not support writing to a stream');
    }

    // two-pass allows for precise control of bitrate at the cost of running twice
    // recommended for vp9 for better quality and compression
    return new Promise((resolve, reject) => {
      // first pass output is not saved as only the .log file is needed
      this.configureFfmpegCall(input, '/dev/null', options)
        .addOptions('-pass', '1')
        .addOptions('-passlogfile', output)
        .addOptions('-f null')
        .on('error', reject)
        .on('end', () => {
          // second pass
          this.configureFfmpegCall(input, output, options)
            .addOptions('-pass', '2')
            .addOptions('-passlogfile', output)
            .on('error', reject)
            .on('end', () => handlePromiseError(fs.unlink(`${output}-0.log`), this.logger))
            .on('end', () => handlePromiseError(fs.rm(`${output}-0.log.mbtree`, { force: true }), this.logger))
            .on('end', () => resolve())
            .run();
        })
        .run();
    });
  }

  async getImageMetadata(input: string | Buffer): Promise<ImageDimensions & { isTransparent: boolean }> {
    const { width = 0, height = 0, hasAlpha = false } = await sharp(input, { unlimited: true }).metadata();
    return { width, height, isTransparent: hasAlpha };
  }

  /** a JPEG that fits in `maxSize` x `maxSize`, never enlarged */
  resizeToJpeg(input: string | Buffer, maxSize: number, quality = 85): Promise<Buffer> {
    return sharp(input, { failOn: 'none' })
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
  }

  /** up to three lines of text on a dark band at the bottom of a contact sheet tile, each cut to fit */
  private getCaptionOverlay(caption: string, tileSize: number, left: number, top: number) {
    const fontSize = Math.max(11, Math.round(tileSize * 0.055));
    const maxChars = Math.max(4, Math.floor(tileSize / (fontSize * 0.56)));
    const lines = caption
      .split('\n')
      .filter((line) => line.trim())
      .slice(0, 3)
      .map((line) => (line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line));
    const lineHeight = Math.round(fontSize * 1.3);
    const height = lines.length * lineHeight + Math.round(fontSize * 0.5);
    const texts = lines
      .map(
        (line, index) =>
          `<text x="${Math.round(fontSize * 0.4)}" y="${Math.round(fontSize * 0.25) + (index + 1) * lineHeight - Math.round(fontSize * 0.3)}" ` +
          `font-family="sans-serif" font-size="${fontSize}" fill="#fff">${escapeXml(line)}</text>`,
      )
      .join('');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${height}">` +
      `<rect width="100%" height="100%" fill="#000" fill-opacity="0.72"/>${texts}</svg>`;
    return { input: Buffer.from(svg), left, top: top + tileSize - height };
  }

  /**
   * a grid of letterboxed tiles, each labelled in its top-left corner and optionally captioned at the bottom;
   * unreadable inputs become blank tiles
   */
  async createContactSheet(
    tiles: Array<{ input: string | Buffer | null; label: string; caption?: string }>,
    options: { tileSize?: number; columns?: number; gap?: number; background?: string; quality?: number } = {},
  ): Promise<Buffer> {
    const { tileSize = 256, gap = 4, background = '#1c1c1c', quality = 80 } = options;
    const columns = Math.max(1, Math.min(tiles.length, options.columns ?? Math.ceil(Math.sqrt(tiles.length))));
    const rows = Math.max(1, Math.ceil(tiles.length / columns));
    const fontSize = Math.max(12, Math.round(tileSize * 0.09));

    const composites = await Promise.all(
      tiles.map(async ({ input, label, caption }, i) => {
        const left = gap + (i % columns) * (tileSize + gap);
        const top = gap + Math.floor(i / columns) * (tileSize + gap);

        let tile: Buffer | undefined;
        if (input) {
          try {
            tile = await sharp(input, { failOn: 'none' })
              .resize(tileSize, tileSize, { fit: 'contain', background })
              .flatten({ background })
              .png({ compressionLevel: 0 })
              .toBuffer();
          } catch (error) {
            this.logger.warn(`Unable to read contact sheet tile ${label}: ${error}`);
          }
        }
        tile ??= await sharp({
          create: { width: tileSize, height: tileSize, channels: 3, background: '#3a3a3a' },
        })
          .png()
          .toBuffer();

        const text = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const labelWidth = Math.round(fontSize * (0.65 * label.length + 0.9));
        const labelHeight = Math.round(fontSize * 1.45);
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}" height="${labelHeight}">` +
          `<rect width="100%" height="100%" rx="${Math.round(fontSize * 0.3)}" fill="#000" fill-opacity="0.72"/>` +
          `<text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" ` +
          `font-weight="bold" font-size="${fontSize}" fill="#fff">${text}</text></svg>`;

        return [
          { input: tile, left, top },
          { input: Buffer.from(svg), left: left + 2, top: top + 2 },
          ...(caption ? [this.getCaptionOverlay(caption, tileSize, left, top)] : []),
        ];
      }),
    );

    return sharp({
      create: {
        width: columns * tileSize + (columns + 1) * gap,
        height: rows * tileSize + (rows + 1) * gap,
        channels: 3,
        background,
      },
    })
      .composite(composites.flat())
      .jpeg({ quality })
      .toBuffer();
  }

  /** raw sharpness, exposure, colour and composition metrics of the image downscaled to fit in `size` x `size` */
  async analyzeImage(input: string | Buffer | Bitmap, size = 512): Promise<ImageAnalysis> {
    const source =
      typeof input === 'string' || Buffer.isBuffer(input) ? sharp(input, { failOn: 'none' }) : this.raw(input);
    const { data: rgb, info: rgbInfo } = await source
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = await sharp(rgb, {
      raw: { width: rgbInfo.width, height: rgbInfo.height, channels: rgbInfo.channels },
    })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const raw = { width: info.width, height: info.height, channels: info.channels };

    // signed Laplacian response centered on 128
    const laplacian = await sharp(data, { raw })
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
      .raw()
      .toBuffer();
    const { channels } = await sharp(laplacian, { raw }).stats();

    let sum = 0;
    let sumSquares = 0;
    let shadows = 0;
    let highlights = 0;
    let energy = 0;
    let energyX = 0;
    let energyY = 0;
    const pixels = info.width * info.height;
    // the convolution may come back with three channels
    const laplacianChannels = Math.max(1, Math.round(laplacian.length / pixels));
    for (let i = 0, pixel = 0; i < data.length; i += info.channels, pixel++) {
      const value = data[i];
      sum += value;
      sumSquares += value * value;
      if (value <= 5) {
        shadows++;
      } else if (value >= 250) {
        highlights++;
      }
      const response = (laplacian[pixel * laplacianChannels] - 128) ** 2;
      energy += response;
      energyX += response * ((pixel % info.width) + 0.5);
      energyY += response * (Math.floor(pixel / info.width) + 0.5);
    }

    // Hasler–Süsstrunk colourfulness and mean HSV saturation
    let rgSum = 0;
    let rgSquares = 0;
    let ybSum = 0;
    let ybSquares = 0;
    let saturation = 0;
    const step = rgbInfo.channels;
    for (let i = 0; i + 2 < rgb.length; i += step) {
      const [r, g, b] = [rgb[i], rgb[i + 1], rgb[i + 2]];
      const rg = r - g;
      const yb = 0.5 * (r + g) - b;
      rgSum += rg;
      rgSquares += rg * rg;
      ybSum += yb;
      ybSquares += yb * yb;
      const max = Math.max(r, g, b);
      saturation += max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    }
    const rgbPixels = rgbInfo.width * rgbInfo.height;
    const rgMean = rgSum / rgbPixels;
    const ybMean = ybSum / rgbPixels;
    const rgVariance = Math.max(0, rgSquares / rgbPixels - rgMean ** 2);
    const ybVariance = Math.max(0, ybSquares / rgbPixels - ybMean ** 2);
    const meanLuma = sum / pixels / 255;

    return {
      width: info.width,
      height: info.height,
      laplacianVariance: channels[0].stdev ** 2,
      meanLuma,
      shadowClip: shadows / pixels,
      highlightClip: highlights / pixels,
      colorfulness: Math.sqrt(rgVariance + ybVariance) + 0.3 * Math.hypot(rgMean, ybMean),
      contrast: Math.sqrt(Math.max(0, sumSquares / pixels / 255 ** 2 - meanLuma ** 2)),
      saturation: saturation / rgbPixels,
      focusX: energy > 0 ? energyX / energy / info.width : 0.5,
      focusY: energy > 0 ? energyY / energy / info.height : 0.5,
    };
  }

  /** enlarges an image with Lanczos resampling and a very light sharpen, keeping its format (by file extension) */
  upscaleImage(input: Buffer, size: { width: number; height: number }, extension: string): Promise<Buffer> {
    const pipeline = sharp(input, { failOn: 'none' })
      .resize(size.width, size.height, { kernel: 'lanczos3', fit: 'fill' })
      .sharpen({ sigma: 0.5, m1: 0.5, m2: 1 });
    switch (extension.replace(/^\./, '').toLowerCase()) {
      case 'jpg':
      case 'jpeg': {
        return pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
      }
      case 'webp': {
        return pipeline.webp({ quality: 92 }).toBuffer();
      }
      default: {
        return pipeline.png().toBuffer();
      }
    }
  }

  /**
   * Stacks a photo above an artwork of the same width into one JPEG (e.g. the editorial watercolor split). The photo
   * is never enlarged, and the result is at most `maxLongEdge` pixels on its long edge.
   */
  async stackPhotoAboveArtwork(
    photo: Bitmap,
    artwork: Buffer,
    { maxLongEdge = 3000, quality = 92 }: { maxLongEdge?: number; quality?: number } = {},
  ): Promise<Buffer> {
    const art = await sharp(artwork, { failOn: 'none' }).metadata();
    if (!art.width || !art.height) {
      throw new Error('The artwork is not a valid image');
    }

    const photoRatio = photo.info.height / photo.info.width;
    const artRatio = art.height / art.width;
    const width = Math.max(
      1,
      Math.floor(Math.min(photo.info.width, maxLongEdge, maxLongEdge / (photoRatio + artRatio))),
    );
    const top = Math.round(width * photoRatio);
    const bottom = Math.round(width * artRatio);
    const paper = '#f7f3ea';

    const [above, below] = await Promise.all([
      this.raw(photo).resize(width, top, { kernel: 'lanczos3', fit: 'fill' }).removeAlpha().png().toBuffer(),
      sharp(artwork, { failOn: 'none' })
        .resize(width, bottom, { kernel: 'lanczos3', fit: 'fill' })
        .flatten({ background: paper })
        .png()
        .toBuffer(),
    ]);

    return sharp({ create: { width, height: top + bottom, channels: 3, background: paper } })
      .composite([
        { input: above, left: 0, top: 0 },
        { input: below, left: 0, top },
      ])
      .jpeg({ quality, chromaSubsampling: '4:4:4' })
      .toBuffer();
  }

  private configureFfmpegCall(input: string, output: string | Writable, options: TranscodeCommand) {
    const ffmpegCall = ffmpeg(input, { niceness: 10 })
      .inputOptions(options.inputOptions)
      .outputOptions(options.outputOptions)
      .output(output)
      .on('start', (command: string) => this.logger.debug(command))
      .on('error', (error, _, stderr) => this.logger.error(stderr || error));

    const { frameCount, percentInterval } = options.progress;
    const frameInterval = Math.ceil(frameCount / (100 / percentInterval));
    if (this.logger.isLevelEnabled(LogLevel.Debug) && frameCount && frameInterval) {
      let lastProgressFrame: number = 0;
      ffmpegCall.on('progress', (progress: ProgressEvent) => {
        if (progress.frames - lastProgressFrame < frameInterval) {
          return;
        }

        lastProgressFrame = progress.frames;
        const percent = ((progress.frames / frameCount) * 100).toFixed(2);
        const ms = progress.currentFps ? Math.floor((frameCount - progress.frames) / progress.currentFps) * 1000 : 0;
        const duration = ms ? Duration.fromMillis(ms).rescale().toHuman({ unitDisplay: 'narrow' }) : '';
        const outputText = output instanceof Writable ? 'stream' : output.split('/').pop();
        this.logger.debug(
          `Transcoding ${percent}% done${duration ? `, estimated ${duration} remaining` : ''} for output ${outputText}`,
        );
      });
    }

    return ffmpegCall;
  }

  private parseInt(value: string | number | undefined): number {
    return Number.parseInt(value as string) || 0;
  }

  private parseFloat(value: string | number | undefined): number {
    // eslint-disable-next-line unicorn/prefer-number-coercion
    return Number.parseFloat(value as string) || 0;
  }

  private parseOptionalInt(value: string | number | undefined): number | null {
    const parsed = Number.parseInt(value as string);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private parseEnum<E extends Record<string, number | string>>(enumObj: E, value?: string) {
    return value ? ((enumObj[pascalCase(value)] as Extract<E[keyof E], number> | undefined) ?? null) : null;
  }

  /** Parse a rational like "60000/1001" or "1/600" into `{ num, den }`. */
  private parseRational(value: string | undefined): { num: number; den: number } | null {
    if (value) {
      const [num, den = 1] = value.split('/').map(Number);
      if (num && den) {
        return { num, den };
      }
    }
    return null;
  }

  private parseFrameRate(value: string | undefined): number | null {
    const r = this.parseRational(value);
    return r ? r.num / r.den : null;
  }

  private getDar(dar: string | undefined): number {
    if (dar) {
      const [darW, darH] = dar.split(':').map(Number);
      if (darW && darH) {
        return darW / darH;
      }
    }

    return 0;
  }

  private parseVideoProfile(codec?: string, profile?: string) {
    switch (codec) {
      case 'h264': {
        return this.parseEnum(H264Profile, profile);
      }
      case 'h265':
      case 'hevc': {
        return this.parseEnum(HevcProfile, profile);
      }
      case 'av1': {
        return this.parseEnum(Av1Profile, profile);
      }
      default: {
        return null;
      }
    }
  }

  private compareStreams(a: FfprobeStream, b: FfprobeStream): number {
    const d = (b.disposition?.default ?? 0) - (a.disposition?.default ?? 0);
    if (d !== 0) {
      return d;
    }
    return this.parseInt(b.bit_rate) - this.parseInt(a.bit_rate);
  }

  /* Ported from https://code.ffmpeg.org/FFmpeg/FFmpeg/src/commit/5c44245878e235ae64fe87fb9877644856d33d1d/fftools/ffmpeg_filter.c
   * SPDX-License-Identifier: LGPL-2.1-or-later
   * Copyright (c) FFmpeg authors and contributors — https://ffmpeg.org/
   * Modifications: TS port operating on probe-derived packet metadata rather than decoded AVFrames. */
  private cfrOutputFrames(packets: { pts: number; duration: number }[], slotsPerTick: number) {
    packets.sort((a, b) => a.pts - b.pts);
    const firstPts = packets[0].pts;
    let outputFrames = 0;
    let nextPts = 0;
    const history = [0, 0, 0];
    for (const pkt of packets) {
      const syncIpts = (pkt.pts - firstPts) * slotsPerTick;
      const duration = pkt.duration * slotsPerTick;
      let delta0 = syncIpts - nextPts;
      const delta = delta0 + duration;

      if (delta0 < 0 && delta > 0) {
        delta0 = 0;
      }

      let nb = 1;
      let nbPrev = 0;
      if (delta < -1.1) {
        nb = 0;
      } else if (delta > 1.1) {
        nb = Math.round(delta);
        if (delta0 > 1.1) {
          nbPrev = Math.round(delta0 - 0.6);
        }
      }
      outputFrames += nb;
      nextPts += nb;
      history[2] = history[1];
      history[1] = history[0];
      history[0] = nbPrev;
    }
    const median = history.sort((a, b) => a - b)[1];
    return outputFrames + median;
  }
}

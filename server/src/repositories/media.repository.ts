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
import { BookPageComposeResult, BookPageComposeSpec, getCropRegion } from 'src/utils/book/render.js';
import { handlePromiseError } from 'src/utils/misc.js';
import { createAffineMatrix } from 'src/utils/transform.js';

const probe = (input: string, options: string[]): Promise<FfprobeData> =>
  new Promise((resolve, reject) =>
    // eslint-disable-next-line import-x/no-named-as-default-member
    ffmpeg.ffprobe(input, options, (error, data) => (error ? reject(error) : resolve(data))),
  );

const pascalCase = (str: string) => upperFirst(camelCase(str.toLowerCase()));

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

  /** a grid of letterboxed tiles, each labelled in its top-left corner; unreadable inputs become blank tiles */
  async createContactSheet(
    tiles: Array<{ input: string | Buffer | null; label: string }>,
    options: { tileSize?: number; columns?: number; gap?: number; background?: string; quality?: number } = {},
  ): Promise<Buffer> {
    const { tileSize = 256, gap = 4, background = '#1c1c1c', quality = 80 } = options;
    const columns = Math.max(1, Math.min(tiles.length, options.columns ?? Math.ceil(Math.sqrt(tiles.length))));
    const rows = Math.max(1, Math.ceil(tiles.length / columns));
    const fontSize = Math.max(12, Math.round(tileSize * 0.09));

    const composites = await Promise.all(
      tiles.map(async ({ input, label }, i) => {
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
  async analyzeImage(input: string | Buffer, size = 512): Promise<ImageAnalysis> {
    const { data: rgb, info: rgbInfo } = await sharp(input, { failOn: 'none' })
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

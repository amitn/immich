import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { ExtraModel } from 'src/decorators.js';
import { bookStylePresetIds } from 'src/dtos/book.dto.js';
import { HighlightJobStatusSchema } from 'src/enum.js';
import { HighlightJobTable } from 'src/schema/tables/highlight-job.table.js';
import {
  DEFAULT_HIGHLIGHT_DURATION,
  HIGHLIGHT_FORMATS,
  MAX_HIGHLIGHT_DURATION,
  MIN_HIGHLIGHT_DURATION,
} from 'src/utils/highlight/plan.js';
import { isoDatetimeToDate } from 'src/validation.js';

/** a selection of photos and videos is at most this long */
export const MAX_HIGHLIGHT_ASSETS = 3000;

export const highlightStyles: readonly [string, ...string[]] = ['auto', ...bookStylePresetIds];

const HighlightStyleSchema = z
  .enum(highlightStyles)
  .describe(
    'The look of the title cards and captions: auto (the style of the book, or the style of the collection of the ' +
      'photos, e.g. food, otherwise classic), or a book style preset',
  )
  .meta({ id: 'HighlightStyle' });

const HighlightFormatSchema = z
  .enum(HIGHLIGHT_FORMATS)
  .describe(
    'The shape of the video: landscape (16:9, 1920×1080) or vertical (9:16, 1080×1920, for phones and social apps, ' +
      'with the text clear of the apps’ buttons)',
  )
  .meta({ id: 'HighlightFormat' });

const HighlightCreateSchema = z
  .object({
    albumId: z.uuidv4().optional().describe('Album to make the video from'),
    bookId: z.uuidv4().optional().describe('Book to make the video from: its photos, and the videos of its album'),
    assetIds: z
      .array(z.uuidv4())
      .min(1)
      .max(MAX_HIGHLIGHT_ASSETS)
      .optional()
      .describe('Photos and videos to make the video from'),
    title: z.string().trim().min(1).max(200).optional().describe('Title; default: the name of the album or book'),
    durationSeconds: z
      .int()
      .min(MIN_HIGHLIGHT_DURATION)
      .max(MAX_HIGHLIGHT_DURATION)
      .optional()
      .describe(`Length of the video in seconds (default ${DEFAULT_HIGHLIGHT_DURATION})`),
    style: HighlightStyleSchema.optional(),
    format: HighlightFormatSchema.optional().describe('Landscape (default) or vertical'),
    music: z.uuidv4().optional().describe('An audio file of the user (see the music endpoints) played under the video'),
    includeMaps: z.boolean().optional().describe('Open the chapters with GPS locations with a map (default true)'),
    captions: z
      .boolean()
      .optional()
      .describe('Name the dishes, artworks, wines and recipe steps, and the places, in lower thirds (default true)'),
    addToAlbum: z.boolean().optional().describe('Add the video to the album it is made from (default true)'),
  })
  .refine((dto) => [dto.albumId, dto.bookId, dto.assetIds].filter((value) => value !== undefined).length === 1, {
    error: 'Pass exactly one of albumId, bookId or assetIds',
  })
  .meta({ id: 'HighlightCreateDto' });

const HighlightJobResponseSchema = z
  .object({
    id: z.uuidv4().describe('Highlight video ID'),
    title: z.string().describe('Title'),
    status: HighlightJobStatusSchema,
    progress: z.number().min(0).max(1).describe('Share of the rendering done, 0 to 1').meta({ format: 'double' }),
    albumId: z.uuidv4().nullable().describe('Album the video is made from'),
    bookId: z.uuidv4().nullable().describe('Book the video is made from'),
    durationSeconds: z.int().describe('Length of the video in seconds, as asked for'),
    format: HighlightFormatSchema,
    resultAssetId: z.uuidv4().nullable().describe('The video, once it is ready'),
    error: z.string().nullable().describe('Why the video could not be made'),
    warnings: z.array(z.string()).describe('What was left out, e.g. photos too small for 1080p'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    updatedAt: isoDatetimeToDate.describe('Last update date'),
  })
  .meta({ id: 'HighlightJobResponseDto' });

const HighlightMusicResponseSchema = z
  .object({
    id: z.uuidv4().describe('Asset ID of the audio file'),
    name: z.string().describe('File name'),
    durationSeconds: z.number().nullable().describe('Length in seconds, when known').meta({ format: 'double' }),
  })
  .meta({ id: 'HighlightMusicResponseDto' });

const HighlightMusicUploadSchema = z
  .object({
    file: z.file().optional().describe('An audio file: MP3, M4A, AAC, WAV, FLAC, OGG or Opus'),
  })
  .meta({ id: 'HighlightMusicUploadDto' });

export class HighlightCreateDto extends createZodDto(HighlightCreateSchema) {}
@ExtraModel()
export class HighlightJobResponseDto extends createZodDto(HighlightJobResponseSchema) {}
export class HighlightMusicResponseDto extends createZodDto(HighlightMusicResponseSchema) {}
export class HighlightMusicUploadDto extends createZodDto(HighlightMusicUploadSchema) {}

export const mapHighlightJob = (job: Selectable<HighlightJobTable>): HighlightJobResponseDto => ({
  id: job.id,
  title: job.title,
  status: job.status,
  progress: Math.round(job.progress * 1000) / 1000,
  albumId: job.albumId,
  bookId: job.bookId,
  durationSeconds: job.options.durationSeconds,
  format: job.options.format ?? 'landscape',
  resultAssetId: job.resultAssetId,
  error: job.error,
  warnings: job.warnings ?? [],
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

export const mapHighlightMusic = (asset: {
  id: string;
  originalFileName: string;
  duration: number | null;
}): HighlightMusicResponseDto => ({
  id: asset.id,
  name: asset.originalFileName,
  durationSeconds: asset.duration === null ? null : Math.round(asset.duration / 100) / 10,
});

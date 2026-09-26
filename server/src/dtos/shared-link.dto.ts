import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { SharedLink, SharedLinkBook } from 'src/database.js';
import { HistoryBuilder } from 'src/decorators.js';
import { AlbumResponseSchema, mapAlbum } from 'src/dtos/album.dto.js';
import { AssetResponseSchema, mapAsset } from 'src/dtos/asset-response.dto.js';
import { SharedLinkType, SharedLinkTypeSchema } from 'src/enum.js';
import { isoDatetimeToDate } from 'src/validation.js';

const SharedLinkSearchSchema = z
  .object({
    albumId: z.uuidv4().optional().describe('Filter by album ID'),
    id: z
      .uuidv4()
      .optional()
      .describe('Filter by shared link ID')
      .meta(new HistoryBuilder().added('v2.5.0').getExtensions()),
    bookId: z
      .uuidv4()
      .optional()
      .describe('Filter by book ID')
      .meta(new HistoryBuilder().added('v3.0.0').alpha('v3.0.0').getExtensions()),
  })
  .meta({ id: 'SharedLinkSearchDto' });

const SharedLinkCreateSchema = z
  .object({
    type: SharedLinkTypeSchema,
    assetIds: z.array(z.uuidv4()).optional().describe('Asset IDs (for individual assets)'),
    albumId: z.uuidv4().optional().describe('Album ID (for album sharing)'),
    bookId: z
      .uuidv4()
      .optional()
      .describe('Book ID (for sharing a photo book)')
      .meta(new HistoryBuilder().added('v3.0.0').alpha('v3.0.0').getExtensions()),
    description: z.string().nullable().optional().describe('Link description'),
    password: z.string().nullable().optional().describe('Link password'),
    slug: z.string().nullable().optional().describe('Custom URL slug'),
    expiresAt: isoDatetimeToDate.nullable().describe('Expiration date').default(null).optional(),
    allowUpload: z.boolean().optional().describe('Allow uploads'),
    allowDownload: z.boolean().default(true).optional().describe('Allow downloads'),
    showMetadata: z.boolean().default(true).optional().describe('Show metadata'),
  })
  .superRefine(({ type, albumId, assetIds, bookId }, ctx) => {
    if (bookId && type !== SharedLinkType.Book) {
      ctx.addIssue(`bookId can only be used with type ${SharedLinkType.Book}`);
    }

    switch (type) {
      case SharedLinkType.Album: {
        if (!albumId) {
          ctx.addIssue(`albumId is required for type ${SharedLinkType.Album}`);
        }
        if (assetIds && assetIds.length > 0) {
          ctx.addIssue(`assetIds can only be used with type ${SharedLinkType.Individual}`);
        }
        return;
      }
      case SharedLinkType.Individual: {
        if (!assetIds || assetIds.length === 0) {
          ctx.addIssue(`assetIds are required for type ${SharedLinkType.Individual}`);
        }

        if (albumId) {
          ctx.addIssue(`albumId can only be used with type ${SharedLinkType.Album}`);
        }
        return;
      }
      case SharedLinkType.Book: {
        if (!bookId) {
          ctx.addIssue(`bookId is required for type ${SharedLinkType.Book}`);
        }
        if (albumId) {
          ctx.addIssue(`albumId can only be used with type ${SharedLinkType.Album}`);
        }
        if (assetIds && assetIds.length > 0) {
          ctx.addIssue(`assetIds can only be used with type ${SharedLinkType.Individual}`);
        }
        return;
      }
    }
  })
  .meta({ id: 'SharedLinkCreateDto' });

const SharedLinkEditSchema = z
  .object({
    description: z.string().nullable().optional().describe('Link description'),
    password: z.string().nullable().optional().describe('Link password'),
    slug: z.string().nullable().optional().describe('Custom URL slug'),
    expiresAt: isoDatetimeToDate.nullish().describe('Expiration date'),
    allowUpload: z.boolean().optional().describe('Allow uploads'),
    allowDownload: z.boolean().optional().describe('Allow downloads'),
    showMetadata: z.boolean().optional().describe('Show metadata'),
  })
  .meta({ id: 'SharedLinkEditDto' });

const SharedLinkLoginSchema = z
  .object({
    password: z.string().describe('Shared link password').meta({ example: 'password' }),
  })
  .meta({ id: 'SharedLinkLoginDto' });

const SharedLinkBookResponseSchema = z
  .object({
    id: z.uuidv4().describe('Book ID'),
    title: z.string().describe('Book title'),
    subtitle: z.string().nullable().describe('Book subtitle'),
    pageCount: z.int().min(0).describe('Number of pages'),
    hasPdf: z.boolean().describe('Whether the PDF has been exported'),
  })
  .describe('The shared photo book')
  .meta({ id: 'SharedLinkBookResponseDto' });

const SharedLinkResponseSchema = z
  .object({
    id: z.uuidv4().describe('Shared link ID'),
    description: z.string().nullable().describe('Link description'),
    password: z.string().nullable().describe('Has password'),
    userId: z.uuidv4().describe('Owner user ID'),
    key: z.string().describe('Encryption key (base64url)'),
    type: SharedLinkTypeSchema,
    createdAt: isoDatetimeToDate.describe('Creation date'),
    expiresAt: isoDatetimeToDate.nullable().describe('Expiration date'),
    assets: z.array(AssetResponseSchema),
    album: AlbumResponseSchema.optional(),
    book: SharedLinkBookResponseSchema.optional().meta(
      new HistoryBuilder().added('v3.0.0').alpha('v3.0.0').getExtensions(),
    ),
    allowUpload: z.boolean().describe('Allow uploads'),
    allowDownload: z.boolean().describe('Allow downloads'),
    showMetadata: z.boolean().describe('Show metadata'),
    slug: z.string().nullable().describe('Custom URL slug'),
  })
  .describe('Shared link response')
  .meta({ id: 'SharedLinkResponseDto' });

export class SharedLinkSearchDto extends createZodDto(SharedLinkSearchSchema) {}
export class SharedLinkCreateDto extends createZodDto(SharedLinkCreateSchema) {}
export class SharedLinkEditDto extends createZodDto(SharedLinkEditSchema) {}
export class SharedLinkLoginDto extends createZodDto(SharedLinkLoginSchema) {}
export class SharedLinkResponseDto extends createZodDto(SharedLinkResponseSchema) {}

const mapSharedLinkBook = (book: SharedLinkBook) => ({
  id: book.id,
  title: book.title,
  subtitle: book.subtitle,
  pageCount: Number(book.pageCount ?? 0),
  hasPdf: !!book.hasPdf,
});

export function mapSharedLink(sharedLink: SharedLink, options: { stripAssetMetadata: boolean }): SharedLinkResponseDto {
  const assets = sharedLink.assets || [];

  const response = {
    id: sharedLink.id,
    description: sharedLink.description,
    password: sharedLink.password,
    userId: sharedLink.userId,
    key: sharedLink.key.toString('base64url'),
    type: sharedLink.type,
    createdAt: sharedLink.createdAt,
    expiresAt: sharedLink.expiresAt,
    assets: assets.map((asset) => mapAsset(asset, { stripMetadata: options.stripAssetMetadata })),
    album: sharedLink.album ? mapAlbum(sharedLink.album) : undefined,
    book: sharedLink.book ? mapSharedLinkBook(sharedLink.book) : undefined,
    allowUpload: sharedLink.allowUpload,
    allowDownload: sharedLink.allowDownload,
    showMetadata: sharedLink.showExif,
    slug: sharedLink.slug,
  };

  // unless we select sharedLink.album.sharedLinks this will be wrong
  if (response.album) {
    response.album.hasSharedLink = true;
    response.album.shared = true;
  }

  return response;
}

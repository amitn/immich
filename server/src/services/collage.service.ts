import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { BookStyle, bookStylePresets, resolveBookStyle } from 'src/dtos/book.dto.js';
import {
  CollageCreateDto,
  CollageDto,
  CollageLayoutsResponseDto,
  CollageRenderDto,
  CollageResponseDto,
} from 'src/dtos/collage.dto.js';
import { AssetType, Permission } from 'src/enum.js';
import { BookRepository } from 'src/repositories/book.repository.js';
import { AlbumService } from 'src/services/album.service.js';
import { BaseService } from 'src/services/base.service.js';
import { getAssetDimensions, getRenderInput } from 'src/services/book.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { formatDateRange } from 'src/utils/book/auto-layout.js';
import {
  COLLAGE_FULL_PX,
  COLLAGE_PREVIEW_PX,
  CollageChoice,
  CollagePhoto,
  chooseCollageLayout,
  getBaseLayoutId,
  getCollageLayoutsFor,
  getCollageName,
  getCollagePageSize,
} from 'src/utils/book/collage.js';
import { PageSize, validatePageStyle } from 'src/utils/book/layouts.js';
import { BookRenderMode, RenderSource, getDpiForLongEdge, normalizeFaces, planPage } from 'src/utils/book/render.js';
import { findOrFail } from 'src/utils/misc.js';
import { requireNotSharedLink } from 'src/utils/shared-link.js';

type CollageAsset = Awaited<ReturnType<BookRepository['getAssetsForRender']>>[number];

type CollagePlan = {
  size: PageSize;
  style: Required<BookStyle>;
  title: string;
  assets: CollageAsset[];
  chosen: CollageChoice;
};

export const getCollageTag = (name: string) => `Collages/${name}`;

const getFileName = (name: string) => `Collage ${name.replaceAll(/[\\/:*?"<>|]/g, '_')}.jpg`;

/**
 * Collages: 2 to 9 photos on one page at a chosen aspect ratio, laid out by the book layout engine and drawn by the book
 * renderer with a book style (see `src/utils/book/collage.ts`), previewed and saved as a new image asset
 */
@Injectable()
export class CollageService extends BaseService {
  /** the layouts for the photos, the one that fits them best first */
  async getLayouts(auth: AuthDto, dto: CollageDto): Promise<CollageLayoutsResponseDto> {
    const { choices } = await this.plan(auth, dto);
    return {
      layouts: choices.map(({ layout }) => ({
        id: getBaseLayoutId(layout),
        name: layout.name,
        description: layout.description,
      })),
    };
  }

  /** the collage as a JPEG: a preview, or the full size one to download */
  async render(auth: AuthDto, dto: CollageRenderDto): Promise<Buffer> {
    const { plan } = await this.plan(auth, dto);
    return dto.full ? this.draw(plan, 'print', COLLAGE_FULL_PX) : this.draw(plan, 'review', COLLAGE_PREVIEW_PX);
  }

  /** saves the collage as a new image asset of the user, tagged Collages/<title or dates> */
  async create(auth: AuthDto, dto: CollageCreateDto): Promise<CollageResponseDto> {
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumAssetCreate, ids: [dto.albumId] });
    }
    const { plan } = await this.plan(auth, dto);
    const data = await this.draw(plan, 'print', COLLAGE_FULL_PX);

    const times = plan.assets.map(({ localDateTime }) => new Date(localDateTime).getTime());
    const name = getCollageName(plan.title, formatDateRange(Math.min(...times), Math.max(...times)));
    const tag = getCollageTag(name);
    // dated like its last photo, so that it sits with them on the timeline
    const last = plan.assets[times.indexOf(Math.max(...times))];
    const dateOf = await this.assetRepository.getById(last.id, { exifInfo: true });

    const { id, duplicate } = await BaseService.create(DerivedAssetService, this).createGeneratedImage(auth, data, {
      fileName: getFileName(name),
      description: plan.title || `Collage of ${plan.assets.length} photos`,
      tags: [tag],
      dateOf: dateOf ?? { fileCreatedAt: new Date(), localDateTime: new Date() },
    });

    if (dto.albumId) {
      try {
        await BaseService.create(AlbumService, this).addAssets(auth, dto.albumId, { ids: [id] });
      } catch (error: any) {
        this.logger.warn(`Unable to add collage ${id} to album ${dto.albumId}: ${error?.message ?? error}`);
      }
    }

    return { assetId: id, duplicate, layout: getBaseLayoutId(plan.chosen.layout), tag };
  }

  private async plan(auth: AuthDto, dto: CollageDto) {
    requireNotSharedLink(auth);
    const assetIds = dto.assetIds;
    if (new Set(assetIds).size !== assetIds.length) {
      throw new BadRequestException('The photos of a collage must be different');
    }
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: assetIds });

    const style = await this.getStyle(auth, dto);
    const size = getCollagePageSize(dto.aspectRatio ?? '1:1');
    const error = validatePageStyle(size, style);
    if (error) {
      throw new BadRequestException(error);
    }

    const rows = await this.bookRepository.getAssetsForRender(assetIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const assets: CollageAsset[] = [];
    for (const id of assetIds) {
      const asset = byId.get(id);
      if (!asset || asset.type !== AssetType.Image) {
        throw new BadRequestException(`Asset ${id} is not a photo in the library`);
      }
      assets.push(asset);
    }

    // face boxes are relative to the unedited image
    const faces = Map.groupBy(await this.bookRepository.getFaces(assetIds), ({ assetId }) => assetId);
    const photos: CollagePhoto[] = assets.map((asset) => ({
      id: asset.id,
      ...getAssetDimensions(asset),
      faces: asset.isEdited ? [] : normalizeFaces(faces.get(asset.id) ?? []),
    }));

    const valid = getCollageLayoutsFor(photos.length).map(({ id }) => id);
    if (dto.layout && !valid.includes(dto.layout)) {
      throw new BadRequestException(
        `Layout "${dto.layout}" is not a collage layout for ${photos.length} photos. Valid layouts: ${valid.join(', ')}`,
      );
    }

    const title = dto.title?.trim() ?? '';
    const { chosen, choices } = chooseCollageLayout(photos, size, style, { title: !!title, layout: dto.layout });
    const plan: CollagePlan = { size, style, title, assets, chosen };
    return { plan, choices };
  }

  private async getStyle(auth: AuthDto, dto: CollageDto): Promise<Required<BookStyle>> {
    if (dto.styleId) {
      await this.requireAccess({ auth, permission: Permission.BookStyleRead, ids: [dto.styleId] });
      const row = await findOrFail(() => this.bookRepository.getStyle(dto.styleId!), 'Book style');
      return resolveBookStyle(row.style);
    }
    return resolveBookStyle(bookStylePresets[dto.stylePreset ?? 'classic']?.style);
  }

  private async draw({ size, style, title, assets, chosen }: CollagePlan, mode: BookRenderMode, longEdgePx: number) {
    const sources = new Map<string, RenderSource>();
    for (const asset of assets) {
      const input = getRenderInput(asset, mode);
      if (!input) {
        throw new BadRequestException(`Asset ${asset.id} has no image to draw yet`);
      }
      sources.set(asset.id, { ...input, ...getAssetDimensions(asset) });
    }

    const plan = planPage(
      { ...size, title, subtitle: null, style, coverAssetId: null },
      {
        layout: chosen.layout.id,
        sectionTitle: null,
        caption: null,
        background: null,
        assets: chosen.order.map((photo, slot) => ({
          slot,
          assetId: photo.id,
          crop: chosen.crops[slot],
          caption: null,
        })),
      },
      { dpi: getDpiForLongEdge(size, longEdgePx), mode, sources, layout: chosen.layout, quality: 90 },
    );
    const result = await this.mediaRepository.composeBookPage(plan.spec);
    const failed = result.slots.findIndex((slot) => !!slot && 'error' in slot);
    if (failed !== -1) {
      throw new BadRequestException(`Photo ${failed + 1} of the collage could not be drawn`);
    }
    return result.data;
  }
}

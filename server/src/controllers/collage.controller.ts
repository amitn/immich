import { Body, Controller, HttpCode, HttpStatus, Post, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  CollageCreateDto,
  CollageDto,
  CollageLayoutsResponseDto,
  CollageRenderDto,
  CollageResponseDto,
} from 'src/dtos/collage.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { CollageService } from 'src/services/collage.service.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Collages)
@Controller('collages')
export class CollageController {
  constructor(private service: CollageService) {}

  @Post('layouts')
  @Authenticated({ permission: Permission.AssetView })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'List the layouts of a collage',
    description:
      'List the layouts for the number of photos, the one that fits their orientations best at the aspect ratio first.',
    history: history(),
  })
  getCollageLayouts(@Auth() auth: AuthDto, @Body() dto: CollageDto): Promise<CollageLayoutsResponseDto> {
    return this.service.getLayouts(auth, dto);
  }

  @Post('render')
  @Authenticated({ permission: Permission.AssetView })
  @HttpCode(HttpStatus.OK)
  @FileResponse()
  @Endpoint({
    summary: 'Render a collage',
    description: 'Render a collage as a JPEG image without saving it: a preview, or the full size image to download.',
    history: history(),
  })
  async renderCollage(@Auth() auth: AuthDto, @Body() dto: CollageRenderDto): Promise<StreamableFile> {
    const data = await this.service.render(auth, dto);
    return new StreamableFile(data, { type: 'image/jpeg', length: data.length });
  }

  @Post()
  @Authenticated({ permission: Permission.AssetUpload })
  @Endpoint({
    summary: 'Save a collage',
    description:
      'Save a collage as a new image asset, dated like its last photo and tagged Collages/<title or dates>; optionally add it to an album.',
    history: history(),
  })
  createCollage(@Auth() auth: AuthDto, @Body() dto: CollageCreateDto): Promise<CollageResponseDto> {
    return this.service.create(auth, dto);
  }
}

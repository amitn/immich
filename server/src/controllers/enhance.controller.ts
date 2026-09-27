import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  EnhanceAnalysisResponseDto,
  EnhanceDto,
  EnhancePreviewDto,
  EnhancePreviewQueryDto,
  EnhanceResponseDto,
} from 'src/dtos/enhance.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Assets)
@Controller('assets')
export class EnhanceController {
  constructor(private service: EnhanceService) {}

  @Post(':id/enhance/preview')
  @Authenticated({ permission: Permission.AssetView })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Analyze a photo for auto-enhance',
    description:
      'Decide which automatic corrections (levels, white balance, exposure, local contrast, saturation, sharpening, noise reduction) a photo needs, without changing anything. Uses local image processing only, no AI.',
    history: history(),
  })
  analyzeEnhancement(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: EnhancePreviewDto,
  ): Promise<EnhanceAnalysisResponseDto> {
    return this.service.analyze(auth, id, dto);
  }

  @Get(':id/enhance/preview.jpg')
  @Authenticated({ permission: Permission.AssetView })
  @FileResponse()
  @Endpoint({
    summary: 'Render an auto-enhance preview',
    description: 'Render the preview of a photo before and after auto-enhance, side by side, as a JPEG image.',
    history: history(),
  })
  async renderEnhancePreview(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() dto: EnhancePreviewQueryDto,
  ): Promise<StreamableFile> {
    const data = await this.service.renderEnhancePreview(auth, id, dto);
    return new StreamableFile(data, { type: 'image/jpeg', length: data.length });
  }

  @Post(':id/enhance')
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Auto-enhance a photo',
    description:
      'Create an automatically enhanced copy of a photo with local image processing (no AI). The original is never changed: the copy is a new asset stacked with it, and the original stays the primary asset of the stack.',
    history: history(),
  })
  enhanceAsset(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: EnhanceDto,
  ): Promise<EnhanceResponseDto> {
    return this.service.createEnhancedCopy(auth, id, dto);
  }
}

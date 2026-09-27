import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto.js';
import {
  OrientationAssetsDto,
  OrientationFixDto,
  OrientationScanDto,
  OrientationSuggestionResponseDto,
  OrientationSuggestionsQueryDto,
} from 'src/dtos/orientation.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { OrientationService } from 'src/services/orientation.service.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Orientation)
@Controller('orientation')
export class OrientationController {
  constructor(private service: OrientationService) {}

  @Post('scan')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Check the orientation of photos',
    description:
      'Check the photos of the user in the background, all of them (newest first, up to 5000), those of an album or those taken in a date range, for photos stored sideways or upside down. Only confident cases are suggested.',
    history: history(),
  })
  scanOrientation(@Auth() auth: AuthDto, @Body() dto: OrientationScanDto): Promise<void> {
    return this.service.scan(auth, dto);
  }

  @Get('suggestions')
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'List orientation suggestions',
    description: 'List the photos found sideways or upside down, with the turn that fixes them and why.',
    history: history(),
  })
  getOrientationSuggestions(
    @Auth() auth: AuthDto,
    @Query() { status }: OrientationSuggestionsQueryDto,
  ): Promise<OrientationSuggestionResponseDto[]> {
    return this.service.getSuggestions(auth, status);
  }

  @Post('fix')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Fix the orientation of photos',
    description:
      'Turn photos with a rotate edit (reversible, no copy is made): by their suggested turn, or by the given one.',
    history: history(),
  })
  fixOrientation(@Auth() auth: AuthDto, @Body() dto: OrientationFixDto): Promise<BulkIdResponseDto[]> {
    return this.service.fix(auth, dto);
  }

  @Post('reject')
  @Authenticated({ permission: Permission.AssetUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Reject orientation suggestions',
    description: 'Keep photos as they are; their turn is not suggested again.',
    history: history(),
  })
  rejectOrientation(@Auth() auth: AuthDto, @Body() dto: OrientationAssetsDto): Promise<BulkIdResponseDto[]> {
    return this.service.reject(auth, dto.assetIds);
  }

  @Post('undo')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Undo orientation fixes',
    description: 'Turn fixed photos back as they were, and suggest the turn again.',
    history: history(),
  })
  undoOrientation(@Auth() auth: AuthDto, @Body() dto: OrientationAssetsDto): Promise<BulkIdResponseDto[]> {
    return this.service.undo(auth, dto.assetIds);
  }
}

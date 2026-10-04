import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { BurstCleanDto, BurstCleanResponseDto, BurstSearchDto, BurstSearchResponseDto } from 'src/dtos/burst.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { BurstService } from 'src/services/burst.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Bursts)
@Controller('bursts')
export class BurstController {
  constructor(private service: BurstService) {}

  @Post('search')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Find bursts',
    description:
      'Find groups of near-identical photos on the timeline (duplicate groups, stacks, and bursts taken seconds apart that are in neither): the user’s own, or those of an album. Each group comes with the photo to keep (by the rules, then the quality score), why, and the photos that cleaning it up archives. Groups with photos of other users are read-only.',
    history: history(),
  })
  searchBursts(@Auth() auth: AuthDto, @Body() dto: BurstSearchDto): Promise<BurstSearchResponseDto> {
    return this.service.search(auth, dto);
  }

  @Post('clean')
  @Authenticated({ permission: Permission.AssetUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Clean up bursts',
    description:
      'Keep one photo of each group and archive the others (never delete them). Only the user’s own photos are archived; a group with photos of other users is skipped. The cleanup is recorded in the activity log, where it can be undone.',
    history: history(),
  })
  cleanBursts(@Auth() auth: AuthDto, @Body() dto: BurstCleanDto): Promise<BurstCleanResponseDto> {
    return this.service.clean(auth, dto, ActivityRecorder.web());
  }
}

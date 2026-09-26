import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ArtJobCreateDto, ArtJobResponseDto, ArtStyleDto } from 'src/dtos/art.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { ArtService } from 'src/services/art.service.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Assistant)
@Controller('art')
export class ArtController {
  constructor(private service: ArtService) {}

  @Get('styles')
  @Authenticated({ permission: Permission.ArtJobRead })
  @Endpoint({
    summary: 'Retrieve artistic styles',
    description: 'Retrieve the artistic styles that photos can be transformed into.',
    history: history(),
  })
  getArtStyles(): ArtStyleDto[] {
    return this.service.getStyles();
  }

  @Post('jobs')
  @Authenticated({ permission: Permission.ArtJobCreate })
  @Endpoint({
    summary: 'Transform a photo into artwork',
    description:
      'Start an artistic style transform of a photo. The configured ACP art agent generates the image, which is saved as a new asset stacked with the photo.',
    history: history(),
  })
  createArtJob(@Auth() auth: AuthDto, @Body() dto: ArtJobCreateDto): Promise<ArtJobResponseDto> {
    return this.service.createJob(auth, dto);
  }

  @Get('jobs/:id')
  @Authenticated({ permission: Permission.ArtJobRead })
  @Endpoint({
    summary: 'Retrieve an art job',
    description: 'Retrieve the status of an artistic style transform.',
    history: history(),
  })
  getArtJob(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ArtJobResponseDto> {
    return this.service.getJob(auth, id);
  }
}

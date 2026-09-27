import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  ArtJobCreateDto,
  ArtJobResponseDto,
  ArtStyleDto,
  ArtUserStyleCreateDto,
  ArtUserStyleResponseDto,
  ArtUserStyleUpdateDto,
} from 'src/dtos/art.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { ArtService } from 'src/services/art.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
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
    description:
      "Retrieve the artistic styles that photos can be transformed into: the built-in styles, then the user's own " +
      '(owned), e.g. designed with the assistant.',
    history: history(),
  })
  getArtStyles(@Auth() auth: AuthDto): Promise<ArtStyleDto[]> {
    return this.service.getStyles(auth);
  }

  @Post('styles')
  @Authenticated({ permission: Permission.ArtStyleCreate })
  @Endpoint({
    summary: 'Create an artistic style',
    description:
      'Save an artistic style of your own. Its prompt is checked: its length, and {caption} exactly when the style ' +
      'renders a caption.',
    history: history(),
  })
  createArtUserStyle(@Auth() auth: AuthDto, @Body() dto: ArtUserStyleCreateDto): Promise<ArtUserStyleResponseDto> {
    return this.service.createStyle(auth, dto, ActivityRecorder.web());
  }

  @Get('styles/:id')
  @Authenticated({ permission: Permission.ArtStyleRead })
  @Endpoint({
    summary: 'Retrieve an artistic style',
    description: 'Retrieve one of your artistic styles, with its prompt.',
    history: history(),
  })
  getArtUserStyle(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ArtUserStyleResponseDto> {
    return this.service.getUserStyle(auth, id);
  }

  @Put('styles/:id')
  @Authenticated({ permission: Permission.ArtStyleUpdate })
  @Endpoint({
    summary: 'Update an artistic style',
    description: 'Rename one of your artistic styles, or change its prompt.',
    history: history(),
  })
  updateArtUserStyle(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: ArtUserStyleUpdateDto,
  ): Promise<ArtUserStyleResponseDto> {
    return this.service.updateStyle(auth, id, dto);
  }

  @Delete('styles/:id')
  @Authenticated({ permission: Permission.ArtStyleDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete an artistic style',
    description: 'Delete one of your artistic styles. The artworks made with it are kept.',
    history: history(),
  })
  deleteArtUserStyle(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.deleteStyle(auth, id);
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

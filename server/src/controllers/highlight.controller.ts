import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  HighlightCreateDto,
  HighlightJobResponseDto,
  HighlightMusicResponseDto,
  HighlightMusicUploadDto,
} from 'src/dtos/highlight.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { HighlightService, MAX_MUSIC_BYTES } from 'src/services/highlight.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Highlights)
@Controller('highlights')
export class HighlightController {
  constructor(private service: HighlightService) {}

  @Post()
  @Authenticated({ permission: Permission.HighlightCreate })
  @Endpoint({
    summary: 'Make a highlight video',
    description:
      'Start making a highlight video of an album, a book or a selection of photos and videos: the best photos as slow pans and zooms, short clips of the videos, title cards and maps for the chapters, lower thirds with the names of the dishes, artworks and places, and optional music. It is rendered in the background and saved as a new video asset.',
    history: history(),
  })
  createHighlight(@Auth() auth: AuthDto, @Body() dto: HighlightCreateDto): Promise<HighlightJobResponseDto> {
    return this.service.create(auth, dto, ActivityRecorder.web());
  }

  @Get()
  @Authenticated({ permission: Permission.HighlightRead })
  @Endpoint({
    summary: 'Retrieve highlight videos',
    description: 'Retrieve the highlight videos of the user, newest first, with their status.',
    history: history(),
  })
  getHighlights(@Auth() auth: AuthDto): Promise<HighlightJobResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Get('music')
  @Authenticated({ permission: Permission.HighlightRead })
  @Endpoint({
    summary: 'Retrieve the music for highlight videos',
    description: 'Retrieve the audio files the user uploaded as music for highlight videos.',
    history: history(),
  })
  getHighlightMusic(@Auth() auth: AuthDto): Promise<HighlightMusicResponseDto[]> {
    return this.service.getMusic(auth);
  }

  @Post('music')
  @Authenticated({ permission: Permission.HighlightCreate })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'An audio file', type: HighlightMusicUploadDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_MUSIC_BYTES } }))
  @Endpoint({
    summary: 'Upload music for highlight videos',
    description:
      'Upload an audio file (MP3, M4A, AAC, WAV, FLAC, OGG or Opus) to play under highlight videos. It is kept as a hidden audio asset of the user.',
    history: history(),
  })
  uploadHighlightMusic(
    @Auth() auth: AuthDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<HighlightMusicResponseDto> {
    return this.service.uploadMusic(auth, file);
  }

  @Delete('music/:id')
  @Authenticated({ permission: Permission.HighlightCreate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete music for highlight videos',
    description: 'Delete an audio file the user uploaded as music for highlight videos.',
    history: history(),
  })
  deleteHighlightMusic(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.deleteMusic(auth, id);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.HighlightRead })
  @Endpoint({
    summary: 'Retrieve a highlight video',
    description: 'Retrieve the status and progress of a highlight video, and the video asset once it is ready.',
    history: history(),
  })
  getHighlight(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<HighlightJobResponseDto> {
    return this.service.get(auth, id);
  }

  @Post(':id/cancel')
  @Authenticated({ permission: Permission.HighlightDelete })
  @Endpoint({
    summary: 'Cancel a highlight video',
    description: 'Stop making a highlight video that is waiting or rendering.',
    history: history(),
  })
  cancelHighlight(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<HighlightJobResponseDto> {
    return this.service.cancel(auth, id);
  }
}

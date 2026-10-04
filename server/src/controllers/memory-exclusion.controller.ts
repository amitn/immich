import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  MemoryExclusionCreateDto,
  MemoryExclusionResponseDto,
  MemoryExclusionsResponseDto,
} from 'src/dtos/memory-exclusion.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Memories)
@Controller('memory-exclusions')
export class MemoryExclusionController {
  constructor(private service: MemoryExclusionService) {}

  @Get()
  @Authenticated({ permission: Permission.UserPreferenceRead })
  @Endpoint({
    summary: 'List the memory exclusions',
    description:
      'List what the user keeps out of their memories: people and pets, albums and ranges of days, and whether ' +
      'screenshots, receipts and documents are left out. Every memory, and every video, book or collage made of one, ' +
      'leaves these photos out.',
    history: history(),
  })
  getMemoryExclusions(@Auth() auth: AuthDto): Promise<MemoryExclusionsResponseDto> {
    return this.service.getAll(auth);
  }

  @Post()
  @Authenticated({ permission: Permission.UserPreferenceUpdate })
  @Endpoint({
    summary: 'Add a memory exclusion',
    description:
      'Leave a person or a pet, an album or a range of days out of the memories, the memories already made included.',
    history: history(),
  })
  createMemoryExclusion(
    @Auth() auth: AuthDto,
    @Body() dto: MemoryExclusionCreateDto,
  ): Promise<MemoryExclusionResponseDto> {
    return this.service.create(auth, dto, ActivityRecorder.web());
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.UserPreferenceUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove a memory exclusion',
    description: 'Let the photos of a memory exclusion back into the memories.',
    history: history(),
  })
  deleteMemoryExclusion(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.remove(auth, id, ActivityRecorder.web());
  }
}

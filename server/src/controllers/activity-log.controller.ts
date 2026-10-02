import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  ActivityLogResponseDto,
  ActivityLogSearchDto,
  ActivityUndoDto,
  ActivityUndoResponseDto,
} from 'src/dtos/activity-log.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.ActivityLog)
@Controller('activity')
export class ActivityLogController {
  constructor(private service: ActivityLogService) {}

  @Get()
  @Authenticated({ permission: Permission.ActivityLogRead })
  @Endpoint({
    summary: 'Retrieve the activity log',
    description:
      'Retrieve the changes the assistant made to the library (and the changes made with its features in the web app), newest first, optionally only those of one chat, group, source or kind, of a date range, or only the undone ones.',
    history: history(),
  })
  getActivityLog(@Auth() auth: AuthDto, @Query() dto: ActivityLogSearchDto): Promise<ActivityLogResponseDto[]> {
    return this.service.search(auth, dto);
  }

  @Post('undo')
  @Authenticated({ permission: Permission.ActivityLogUndo })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Undo changes',
    description:
      'Undo several changes, or every change of a group (a chat turn), newest first. Each change is checked first: a change that later changes depend on (e.g. a copy placed in a book since, or a book edited again) is refused with the reason, and the other changes are still undone.',
    history: history(),
  })
  undoActivities(@Auth() auth: AuthDto, @Body() dto: ActivityUndoDto): Promise<ActivityUndoResponseDto> {
    return this.service.undoAll(auth, dto);
  }

  @Post(':id/undo')
  @Authenticated({ permission: Permission.ActivityLogUndo })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Undo a change',
    description:
      'Undo one change: created copies, artworks and videos go to the trash, photos go back into or out of albums, collection names and books are restored. It is refused, with the reason, when later changes depend on it.',
    history: history(),
  })
  undoActivity(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ActivityUndoResponseDto> {
    return this.service.undo(auth, id);
  }

  @Post(':id/redo')
  @Authenticated({ permission: Permission.ActivityLogUndo })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Redo a change',
    description:
      'Apply an undone change again. Only for the changes that are simple to repeat: adding photos to an album, removing them, and keeping a suggested book.',
    history: history(),
  })
  redoActivity(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ActivityLogResponseDto> {
    return this.service.redo(auth, id);
  }
}

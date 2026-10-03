import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { BookDraftResponseDto } from 'src/dtos/book.dto.js';
import { HighlightJobResponseDto } from 'src/dtos/highlight.dto.js';
import {
  YearRecapBookDto,
  YearRecapParamDto,
  YearRecapResponseDto,
  YearRecapVideoDto,
} from 'src/dtos/year-recap.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { YearRecapService } from 'src/services/year-recap.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Memories)
@Controller('year-recaps')
export class YearRecapController {
  constructor(private service: YearRecapService) {}

  @Get(':year')
  @Authenticated({ permission: Permission.MemoryRead })
  @Endpoint({
    summary: 'Get the recap of a year',
    description:
      'Get the stats of a year in review (photos, places, people and pets, trips, and what the journals saw), without ' +
      'what the user keeps out of their memories, with its year_recap memory and the book of the year waiting to be ' +
      'kept or discarded, when there are.',
    history: history(),
  })
  getYearRecap(@Auth() auth: AuthDto, @Param() { year }: YearRecapParamDto): Promise<YearRecapResponseDto> {
    return this.service.get(auth, year);
  }

  @Post(':year/book')
  @Authenticated({ permission: Permission.BookCreate })
  @Endpoint({
    summary: 'Draft the book of a year',
    description:
      'Lay out a book of a year in review as a draft, to keep or discard like the suggested books. Without ' +
      'exclusions of its own, the draft waiting for the user is returned when there is one.',
    history: history(),
  })
  createYearRecapBook(
    @Auth() auth: AuthDto,
    @Param() { year }: YearRecapParamDto,
    @Body() dto: YearRecapBookDto,
  ): Promise<BookDraftResponseDto> {
    return this.service.createBook(auth, year, dto);
  }

  @Post(':year/video')
  @Authenticated({ permission: Permission.HighlightCreate })
  @Endpoint({
    summary: 'Make the highlight video of a year',
    description:
      'Start a highlight video of a year in review, landscape or vertical, of its photos and videos without what the ' +
      'user keeps out of their memories.',
    history: history(),
  })
  createYearRecapVideo(
    @Auth() auth: AuthDto,
    @Param() { year }: YearRecapParamDto,
    @Body() dto: YearRecapVideoDto,
  ): Promise<HighlightJobResponseDto> {
    return this.service.createVideo(auth, year, dto, ActivityRecorder.web());
  }
}

import { Body, Controller, HttpCode, HttpStatus, Param, Post, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  RedactionCreateDto,
  RedactionPreviewDto,
  RedactionResponseDto,
  RedactionSuggestDto,
  RedactionSuggestionResponseDto,
} from 'src/dtos/redaction.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { RedactionService } from 'src/services/redaction.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Assets)
@Controller('assets')
export class RedactionController {
  constructor(private service: RedactionService) {}

  @Post(':id/redact/suggest')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Suggest regions to redact',
    description:
      'Suggest the regions of a photo to blur before sharing it, from its face and OCR boxes: faces (except the people to keep; pets are never suggested), text that looks personal, number plates, screens and documents. Changes nothing. The regions are fractions of the photo as it is shown, and the selected ones are blurred by default.',
    history: history(),
  })
  suggestRedactions(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: RedactionSuggestDto,
  ): Promise<RedactionSuggestionResponseDto> {
    return this.service.suggest(auth, id, dto);
  }

  @Post(':id/redact/preview')
  @Authenticated({ permission: Permission.AssetView })
  @HttpCode(HttpStatus.OK)
  @FileResponse()
  @Endpoint({
    summary: 'Preview a redaction',
    description:
      'Render the preview of a photo with the regions blurred or pixelated, as a JPEG image, without saving it.',
    history: history(),
  })
  async renderRedactionPreview(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: RedactionPreviewDto,
  ): Promise<StreamableFile> {
    const data = await this.service.renderPreview(auth, id, dto);
    return new StreamableFile(data, { type: 'image/jpeg', length: data.length });
  }

  @Post(':id/redact')
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Redact a photo',
    description:
      'Create a copy of a photo with regions blurred or pixelated: the given regions, or the selected suggestions for the options. The original is never changed: the copy is a new asset stacked with it and tagged Edits/Redacted. Only the owner of a photo can redact it. The copy is recorded in the activity log, where undoing it moves the copy to the trash.',
    history: history(),
  })
  redactAsset(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: RedactionCreateDto,
  ): Promise<RedactionResponseDto> {
    return this.service.createRedactedCopy(auth, id, dto, ActivityRecorder.web());
  }
}

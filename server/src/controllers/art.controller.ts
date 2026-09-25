import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiTag } from 'src/enum.js';
import { ArtService } from 'src/services/art.service.js';

@ApiTags(ApiTag.Assistant)
@Controller('art')
export class ArtController {
  constructor(private service: ArtService) {}
}

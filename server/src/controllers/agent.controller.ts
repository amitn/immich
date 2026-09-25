import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiTag } from 'src/enum.js';
import { AgentService } from 'src/services/agent.service.js';

@ApiTags(ApiTag.Assistant)
@Controller('agent/sessions')
export class AgentController {
  constructor(private service: AgentService) {}
}

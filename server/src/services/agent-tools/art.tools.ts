import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';

/** Artistic style transforms, delegated to an ACP art agent */
@Injectable()
export class ArtAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [];
  }
}

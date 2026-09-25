import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';

/** Album management */
@Injectable()
export class AlbumAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [];
  }
}

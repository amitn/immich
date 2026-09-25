import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';

/** Photo book editing, rendering and export */
@Injectable()
export class BookAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [];
  }
}

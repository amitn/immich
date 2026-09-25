import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';

/** Search, people, events, metadata, contact sheets and photo selection helpers */
@Injectable()
export class LibraryAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [];
  }
}

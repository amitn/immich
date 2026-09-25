import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';

/** Face-aware crop suggestions and cropped copies */
@Injectable()
export class CropAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [];
  }
}

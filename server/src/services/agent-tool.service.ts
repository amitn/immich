import { Injectable } from '@nestjs/common';
import { AlbumAgentTools } from 'src/services/agent-tools/album.tools.js';
import { ArtAgentTools } from 'src/services/agent-tools/art.tools.js';
import { BookAgentTools } from 'src/services/agent-tools/book.tools.js';
import { CropAgentTools } from 'src/services/agent-tools/crop.tools.js';
import { LibraryAgentTools } from 'src/services/agent-tools/library.tools.js';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';

/** Collects the Immich tools exposed to ACP agents over MCP. */
@Injectable()
export class AgentToolService extends BaseService {
  private tools?: Map<string, AgentTool>;

  getTools(): AgentTool[] {
    return this.getToolMap().values().toArray();
  }

  getTool(name: string): AgentTool | undefined {
    return this.getToolMap().get(name);
  }

  private getToolMap() {
    if (!this.tools) {
      const providers = [
        BaseService.create(LibraryAgentTools, this),
        BaseService.create(AlbumAgentTools, this),
        BaseService.create(CropAgentTools, this),
        BaseService.create(BookAgentTools, this),
        BaseService.create(ArtAgentTools, this),
      ];

      this.tools = new Map();
      for (const tool of providers.flatMap((provider) => provider.getTools())) {
        if (this.tools.has(tool.name)) {
          throw new Error(`Duplicate agent tool name: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
      }
    }

    return this.tools;
  }
}

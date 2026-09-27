// eslint-disable-next-line import-x/no-unresolved -- resolved through the package's wildcard export
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Injectable } from '@nestjs/common';
import { serverVersion } from 'src/constants.js';
import { AlbumAgentTools } from 'src/services/agent-tools/album.tools.js';
import { ArtAgentTools } from 'src/services/agent-tools/art.tools.js';
import { BookAgentTools } from 'src/services/agent-tools/book.tools.js';
import { CollectionAgentTools } from 'src/services/agent-tools/collection.tools.js';
import { CropAgentTools } from 'src/services/agent-tools/crop.tools.js';
import { EnhanceAgentTools } from 'src/services/agent-tools/enhance.tools.js';
import { LibraryAgentTools } from 'src/services/agent-tools/library.tools.js';
import { QuestionAgentTools } from 'src/services/agent-tools/question.tools.js';
import { BaseService } from 'src/services/base.service.js';
import { IMMICH_MCP_SERVER_NAME } from 'src/utils/agent/instructions.js';
import { AgentTool, AgentToolResult } from 'src/utils/agent/tools.js';

/** Runs a tool call, e.g. with approval and logging around `tool.handler` */
export type AgentToolRunner = (tool: AgentTool, input: Record<string, unknown>) => Promise<AgentToolResult>;

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

  /** A new MCP server with every tool registered; used once per (stateless) MCP request. */
  createMcpServer(tools: AgentTool[], run: AgentToolRunner) {
    const server = new McpServer(
      { name: IMMICH_MCP_SERVER_NAME, title: 'Immich', version: serverVersion.toString() },
      { capabilities: { tools: {} } },
    );

    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input.shape,
          annotations: { title: tool.title, readOnlyHint: !tool.mutating },
        },
        (input: Record<string, unknown>) => run(tool, input),
      );
    }

    return server;
  }

  private getToolMap() {
    if (!this.tools) {
      const providers = [
        BaseService.create(LibraryAgentTools, this),
        BaseService.create(AlbumAgentTools, this),
        BaseService.create(CropAgentTools, this),
        BaseService.create(BookAgentTools, this),
        BaseService.create(ArtAgentTools, this),
        BaseService.create(EnhanceAgentTools, this),
        BaseService.create(CollectionAgentTools, this),
        BaseService.create(QuestionAgentTools, this),
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

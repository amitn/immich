import { All, Controller, Headers, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Authenticated } from 'src/middleware/auth.guard.js';
import { AgentService } from 'src/services/agent.service.js';

/**
 * The Immich tools, served to ACP agent processes over MCP (Streamable HTTP, stateless).
 * Not a user API: requests are authenticated with the per-process bearer token issued by the agent service.
 */
@ApiExcludeController()
@Controller('agent/mcp')
export class AgentMcpController {
  constructor(private service: AgentService) {}

  @All()
  @Authenticated({ public: true })
  handleMcpRequest(
    @Headers('authorization') authorization: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.service.handleMcpRequest(authorization, req, res, req.body);
  }
}

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  AgentPermissionParamDto,
  AgentPermissionResponseDto,
  AgentPromptDto,
  AgentSessionCreateDto,
  AgentSessionDetailResponseDto,
  AgentSessionResponseDto,
} from 'src/dtos/agent.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { AgentService } from 'src/services/agent.service.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Assistant)
@Controller('agent/sessions')
export class AgentController {
  constructor(private service: AgentService) {}

  @Post()
  @Authenticated({ permission: Permission.AgentSessionCreate })
  @Endpoint({
    summary: 'Create an assistant session',
    description: 'Start a new chat with the AI assistant. The agent process is started with the first message.',
    history: history(),
  })
  createAgentSession(@Auth() auth: AuthDto, @Body() dto: AgentSessionCreateDto): Promise<AgentSessionResponseDto> {
    return this.service.createSession(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve assistant sessions',
    description: 'Retrieve the assistant sessions of the current user, most recently updated first.',
    history: history(),
  })
  getAgentSessions(@Auth() auth: AuthDto): Promise<AgentSessionResponseDto[]> {
    return this.service.getSessions(auth);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve an assistant session',
    description: 'Retrieve an assistant session with all of its messages.',
    history: history(),
  })
  getAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentSessionDetailResponseDto> {
    return this.service.getSession(auth, id);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.AgentSessionDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete an assistant session',
    description: 'Stop the agent process of the session and delete the session with its messages.',
    history: history(),
  })
  deleteAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.deleteSession(auth, id);
  }

  @Post(':id/prompt')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Send a message to the assistant',
    description:
      'Send a message to the assistant. Returns right away; the reply and tool calls are sent with the `on_agent_update` websocket event.',
    history: history(),
  })
  promptAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Body() dto: AgentPromptDto): Promise<void> {
    return this.service.prompt(auth, id, dto);
  }

  @Post(':id/cancel')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Cancel the current assistant turn',
    description: 'Stop the assistant from working on the current message.',
    history: history(),
  })
  cancelAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.cancel(auth, id);
  }

  @Post(':id/permissions/:requestId')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Respond to an assistant permission request',
    description: 'Approve or decline a change the assistant wants to make to the library.',
    history: history(),
  })
  respondToAgentPermission(
    @Auth() auth: AuthDto,
    @Param() { id, requestId }: AgentPermissionParamDto,
    @Body() dto: AgentPermissionResponseDto,
  ): Promise<void> {
    return this.service.respondToPermission(auth, id, requestId, dto);
  }
}

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ActivityUndoResponseDto } from 'src/dtos/activity-log.dto.js';
import {
  RoutineApprovalDecisionDto,
  RoutineApprovalDecisionResponseDto,
  RoutineApprovalResponseDto,
  RoutineConfigResponseDto,
  RoutineCreateDto,
  RoutineResponseDto,
  RoutineRunCreateDto,
  RoutineRunDetailResponseDto,
  RoutineRunResponseDto,
  RoutineUpdateDto,
} from 'src/dtos/routine.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { RoutineService } from 'src/services/routine.service.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

/** Assistant routines (#15): the assistant run on its own, on a schedule or after an event */
@ApiTags(ApiTag.Assistant)
@Controller('routines')
export class RoutineController {
  constructor(private service: RoutineService) {}

  @Get('config')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve the routine settings',
    description:
      'Whether routines can run, the agent profiles, the limits and the tools that are safe to auto-approve.',
    history: history(),
  })
  getRoutineConfig(): Promise<RoutineConfigResponseDto> {
    return this.service.getRoutineConfig();
  }

  @Get('inbox')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve the Routines inbox',
    description: 'The changes of routine runs that wait for approval, the oldest first.',
    history: history(),
  })
  getRoutineInbox(@Auth() auth: AuthDto): Promise<RoutineApprovalResponseDto[]> {
    return this.service.getInbox(auth);
  }

  @Post('approvals')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Approve or deny changes of routine runs',
    description:
      'Approve or deny queued changes, one by one or every change of a run. Approving a change makes the recorded ' +
      'tool call again, exactly as the agent made it; it is recorded in the activity log with the run.',
    history: history(),
  })
  decideRoutineApprovals(
    @Auth() auth: AuthDto,
    @Body() dto: RoutineApprovalDecisionDto,
  ): Promise<RoutineApprovalDecisionResponseDto> {
    return this.service.decide(auth, dto);
  }

  @Get('runs/:id')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve a routine run',
    description: 'A run with its transcript, like a chat, and its changes that waited for approval.',
    history: history(),
  })
  getRoutineRun(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<RoutineRunDetailResponseDto> {
    return this.service.getRun(auth, id);
  }

  @Post('runs/:id/cancel')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Stop a routine run',
    description: 'Cancel a queued run, or stop a running one.',
    history: history(),
  })
  cancelRoutineRun(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<RoutineRunResponseDto> {
    return this.service.cancelRun(auth, id);
  }

  @Post('runs/:id/undo')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Undo a routine run',
    description: 'Undo every change of a run, and the changes of it that were approved later, newest first.',
    history: history(),
  })
  undoRoutineRun(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ActivityUndoResponseDto> {
    return this.service.undoRun(auth, id);
  }

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve the routines',
    description: 'The routines of the current user, the newest first, with their last run.',
    history: history(),
  })
  getRoutines(@Auth() auth: AuthDto): Promise<RoutineResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Post()
  @Authenticated({ permission: Permission.AgentSessionCreate })
  @Endpoint({
    summary: 'Create a routine',
    description: 'Make an instruction the assistant runs on its own, on a schedule or after an event.',
    history: history(),
  })
  createRoutine(@Auth() auth: AuthDto, @Body() dto: RoutineCreateDto): Promise<RoutineResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({ summary: 'Retrieve a routine', description: 'A routine with its last run.', history: history() })
  getRoutine(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<RoutineResponseDto> {
    return this.service.get(auth, id);
  }

  @Patch(':id')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Update a routine',
    description: 'Change a routine, turn it on or off, or resume it after it was paused.',
    history: history(),
  })
  updateRoutine(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: RoutineUpdateDto,
  ): Promise<RoutineResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.AgentSessionDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a routine',
    description: 'Delete a routine with its runs; the changes of its runs stay in the activity log.',
    history: history(),
  })
  deleteRoutine(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }

  @Post(':id/run')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Run a routine now',
    description: 'Queue a run of the routine now, or a dry run that only reports what it would change.',
    history: history(),
  })
  runRoutine(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: RoutineRunCreateDto,
  ): Promise<RoutineRunResponseDto> {
    return this.service.run(auth, id, dto);
  }

  @Get(':id/runs')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve the runs of a routine',
    description: 'The last 50 runs, the newest first.',
    history: history(),
  })
  getRoutineRuns(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<RoutineRunResponseDto[]> {
    return this.service.getRuns(auth, id);
  }
}

import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { RoutineApprovalMode, RoutineEvent, RoutineTriggerType } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { RoutineService } from 'src/services/routine.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';
import { ROUTINE_SAFE_TOOLS, describeEvent } from 'src/utils/routines.js';

/**
 * Assistant routines (#15) from the chat: "do this every time I upload restaurant photos" makes the assistant propose
 * a routine with `create_routine`, which the user approves like any change; `list_routines` shows the ones they have.
 */
@Injectable()
export class RoutineAgentTools extends BaseService {
  private routineService?: RoutineService;

  private get routines() {
    this.routineService ??= BaseService.create(RoutineService, this);
    return this.routineService;
  }

  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'list_routines',
        title: 'List routines',
        description:
          "List the user's assistant routines: instructions the assistant runs on its own, on a schedule or after an " +
          'event, with when they run, their approval mode and their last run.',
        input: z.object({}),
        mutating: false,
        handler: (ctx) =>
          this.run(async () => {
            const routines = await this.routines.getAll(ctx.auth);
            return toolJson({
              routines: routines.map((routine) => ({
                id: routine.id,
                name: routine.name,
                instruction: routine.instruction,
                trigger: routine.trigger,
                approvalMode: routine.approvalMode,
                enabled: routine.enabled,
                ...(routine.pausedAt && { pausedAt: routine.pausedAt }),
                ...(routine.lastRun && { lastRun: { status: routine.lastRun.status, at: routine.lastRun.createdAt } }),
                pendingApprovals: routine.pendingApprovals,
              })),
            });
          }),
      }),

      defineTool({
        name: 'create_routine',
        title: 'Create a routine',
        description:
          'Make an assistant routine: an instruction you will run on your own later, without a chat window, on a ' +
          'schedule or after an event. Use it when the user asks for something to happen regularly or every time ' +
          'something happens ("every night, name the dishes of new restaurant visits", "when I tag photos print, make ' +
          'a book", "after every trip, make a highlight video"). Write the instruction as a complete, standalone task ' +
          '(the run has no chat history). Triggers: manual; schedule with a 5-field cron expression (e.g. "0 2 * * *" ' +
          'nightly at 2:00, "0 9 * * 0" Sundays at 9:00) and the time zone if known; or event: ' +
          `${Object.values(RoutineEvent)
            .map((event) => `${event} (${describeEvent(event)})`)
            .join(', ')}; tag filters a tag event, pack a journal_visit event. Approval modes: ask (the default and ` +
          'the safest: every change waits for the user in the Routines inbox), auto_safe (makes reversible changes ' +
          `right away: ${[...ROUTINE_SAFE_TOOLS].join(', ')}; the others wait), dry_run (only reports). Start new ` +
          'routines in ask, and suggest a dry run from the Routines page first. Then tell the user what you made.',
        input: z.object({
          name: z.string().trim().min(1).max(100).describe('Short name, e.g. "Name new dishes"'),
          instruction: z.string().trim().min(1).max(5000).describe('The task, in plain words, complete on its own'),
          trigger: z
            .object({
              type: z.enum(RoutineTriggerType),
              cron: z.string().optional().describe('Schedule: 5-field cron expression'),
              timezone: z.string().optional().describe('Schedule: IANA time zone, e.g. Europe/London'),
              event: z.enum(RoutineEvent).optional().describe('Event: what the routine runs after'),
              tag: z.string().optional().describe('Tag event: only this tag or a tag under it'),
              pack: z.string().optional().describe('Journal visit event: only this journal, e.g. food'),
            })
            .describe('When it runs'),
          scope: z
            .object({
              albumIds: z.array(z.uuidv4()).max(100).optional(),
              personIds: z.array(z.uuidv4()).max(100).optional(),
              tags: z.array(z.string()).max(100).optional(),
              pack: z.string().optional().describe('A journal, e.g. food'),
              sinceLastRun: z.boolean().optional().describe('Only what is new since the last run'),
              days: z.int().min(1).max(3650).optional().describe('Only the last days'),
            })
            .optional()
            .describe('What the runs are pointed at'),
          approvalMode: z.enum(RoutineApprovalMode).optional().describe('Defaults to ask'),
        }),
        mutating: true,
        handler: (ctx, input) =>
          this.run(async () => {
            const routine = await this.routines.create(ctx.auth, input, ctx.activity);
            return toolJson({
              routineId: routine.id,
              name: routine.name,
              trigger: routine.trigger,
              approvalMode: routine.approvalMode,
              limits: routine.limits,
              ...(routine.nextRunAt && { nextRunAt: routine.nextRunAt }),
              note: 'The user finds it on the Routines page, where they can change it, run it now or try a dry run.',
            });
          }),
      }),
    ];
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`Routine tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}

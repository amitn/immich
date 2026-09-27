import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { ActivityLogSource } from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { BaseService } from 'src/services/base.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';

const MAX_UNDO = 200;

/** The activity log: what the assistant changed, and undoing it */
@Injectable()
export class ActivityAgentTools extends BaseService {
  private activityLogService?: ActivityLogService;

  private get activityLog() {
    this.activityLogService ??= BaseService.create(ActivityLogService, this);
    return this.activityLogService;
  }

  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'list_activity',
        title: 'List the changes',
        description:
          'List the changes made to the library, newest first, as recorded in the activity log: by you in this chat ' +
          '(scope "chat", default), or all of them (scope "all": every chat, and what the user did with the ' +
          'assistant features in the web app). Each change has an id, the tool that made it, a summary, its group ' +
          '(all the changes of one chat turn share a groupId), whether it can be undone and whether it was undone. ' +
          'Call it before undo_activity to find what to undo.',
        input: z.object({
          scope: z
            .enum(['chat', 'all'])
            .optional()
            .describe('chat (default): the changes of this chat; all: every change'),
          includeUndone: z.boolean().optional().describe('Also list the changes that were undone, default false'),
          limit: z.int().min(1).max(200).optional().describe('Most changes to return, default 30'),
        }),
        mutating: false,
        handler: (ctx, { scope = 'chat', includeUndone = false, limit = 30 }) =>
          this.run(async () => {
            if (scope === 'chat' && !ctx.sessionId) {
              return toolError('There is no chat to list the changes of; use scope "all"');
            }
            const changes = await this.activityLog.search(ctx.auth, {
              ...(scope === 'chat' && { sessionId: ctx.sessionId! }),
              ...(!includeUndone && { undone: false }),
              limit,
              offset: 0,
            });
            return toolJson({
              changes: changes.map((change) => ({
                id: change.id,
                at: change.createdAt,
                ...(change.toolName ? { tool: change.toolName } : { source: change.source }),
                summary: change.summary,
                groupId: change.groupId,
                canUndo: change.canUndo,
                ...(change.undoneAt && { undoneAt: change.undoneAt }),
              })),
              ...(changes.length === 0 && { message: 'Nothing was changed yet' }),
            });
          }),
      }),

      defineTool({
        name: 'undo_activity',
        title: 'Undo changes',
        description:
          'Undo changes from list_activity, only when the user asks: pass their ids, or the groupId of a chat turn to ' +
          'undo everything it changed. They are undone newest first. Created copies, artworks and videos go to the ' +
          'trash (they can be restored from there), photos go back into or out of albums, collection names and ' +
          'descriptions and books are restored, new albums and books are deleted. A change is refused when later ' +
          'changes depend on it (e.g. a copy placed in a book since, a book edited again, an album that changed): ' +
          'tell the user what was undone, and for each refusal the reason it gives.',
        input: z.object({
          ids: z.array(z.uuidv4()).min(1).max(MAX_UNDO).optional().describe('Changes to undo'),
          groupId: z.uuidv4().optional().describe('Undo every change of this group (a chat turn)'),
        }),
        mutating: true,
        handler: (ctx, { ids, groupId }) =>
          this.run(async () => {
            if (!ids?.length && !groupId) {
              return toolError('Pass the ids of the changes, or a groupId');
            }
            const response = await this.activityLog.undoAll(ctx.auth, { ids, groupId }, ActivityLogSource.Assistant);
            return toolJson({
              undone: response.undone,
              refused: response.refused,
              results: response.results.map(({ id, summary, status, message, warnings }) => ({
                id,
                summary,
                status,
                ...(message && { message }),
                ...(warnings.length > 0 && { warnings }),
              })),
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
        this.logger.error(`Activity tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}

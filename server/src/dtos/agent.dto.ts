import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { ExtraModel } from 'src/decorators.js';
import {
  AgentMessageKind,
  AgentMessageKindSchema,
  AgentMessageRole,
  AgentMessageRoleSchema,
  AgentSessionStatusSchema,
} from 'src/enum.js';
import { AgentMessageTable } from 'src/schema/tables/agent-message.table.js';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table.js';
import { isoDatetimeToDate } from 'src/validation.js';

const AgentSessionCreateSchema = z
  .object({
    title: z.string().trim().max(200).optional().describe('Session title'),
    autoApprove: z
      .boolean()
      .optional()
      .describe('Let the assistant change the library without asking, in this session'),
  })
  .meta({ id: 'AgentSessionCreateDto' });

const AgentSessionUpdateSchema = z
  .object({
    title: z.string().trim().max(200).optional().describe('Session title'),
    autoApprove: z
      .boolean()
      .optional()
      .describe('Let the assistant change the library without asking, in this session'),
  })
  .meta({ id: 'AgentSessionUpdateDto' });

const AgentPromptSchema = z
  .object({
    text: z.string().trim().min(1).max(20_000).describe('Message for the assistant'),
    assetIds: z.array(z.uuidv4()).max(1000).optional().describe('Assets selected by the user, passed as context'),
  })
  .meta({ id: 'AgentPromptDto' });

const AgentPermissionResponseSchema = z
  .object({
    optionId: z.string().optional().describe('Selected permission option ID'),
    approved: z.boolean().optional().describe('Whether the request is approved (alternative to optionId)'),
  })
  .refine((dto) => dto.optionId !== undefined || dto.approved !== undefined, {
    error: 'Either optionId or approved is required',
  })
  .meta({ id: 'AgentPermissionResponseDto' });

const AgentPermissionParamSchema = z.object({
  id: z.uuidv4(),
  requestId: z.uuidv4(),
});

export enum AgentToolCallStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
}

export enum AgentPermissionStatus {
  Pending = 'pending',
  Approved = 'approved',
  Denied = 'denied',
  Expired = 'expired',
}

const AgentPermissionOptionSchema = z
  .object({
    optionId: z.string().describe('Option ID'),
    name: z.string().describe('Option label'),
    kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']).describe('Option kind'),
  })
  .meta({ id: 'AgentPermissionOptionDto' });

const AgentPlanEntrySchema = z
  .object({
    content: z.string().describe('Plan step'),
    priority: z.string().describe('Priority (high, medium, low)'),
    status: z.string().describe('Status (pending, in_progress, completed)'),
  })
  .meta({ id: 'AgentPlanEntryDto' });

/** One flat shape for every message kind; which fields are set depends on `kind` */
export const AgentMessageContentSchema = z
  .object({
    text: z.string().optional().describe('Text (text, thought and error messages), markdown for agent text'),
    assetIds: z.array(z.string()).optional().describe('Assets referenced by the message (context or tool results)'),
    albumIds: z.array(z.string()).optional().describe('Albums referenced by tool results'),
    bookIds: z.array(z.string()).optional().describe('Books referenced by tool results'),
    toolCallId: z.string().optional().describe('Tool call ID (tool_call)'),
    toolName: z.string().optional().describe('Immich tool name, or the agent tool name (tool_call, permission)'),
    title: z.string().optional().describe('Human readable title (tool_call, permission)'),
    status: z
      .string()
      .optional()
      .describe('Tool call status (pending, in_progress, completed, failed) or permission status'),
    input: z.unknown().optional().describe('Compact tool input (tool_call, permission)'),
    output: z.string().optional().describe('Truncated tool output (tool_call)'),
    summary: z.string().optional().describe('Human readable summary of the tool arguments (permission)'),
    requestId: z.string().optional().describe('Permission request ID, used to respond (permission)'),
    options: z.array(AgentPermissionOptionSchema).optional().describe('Permission options (permission)'),
    entries: z.array(AgentPlanEntrySchema).optional().describe('Plan entries (plan)'),
  })
  .meta({ id: 'AgentMessageContentDto' });

export type AgentMessageContent = z.infer<typeof AgentMessageContentSchema>;

const AgentMessageSchema = z
  .object({
    id: z.uuidv4().describe('Message ID'),
    sessionId: z.uuidv4().describe('Session ID'),
    role: AgentMessageRoleSchema,
    kind: AgentMessageKindSchema,
    content: AgentMessageContentSchema,
    createdAt: isoDatetimeToDate.describe('Creation date'),
  })
  .meta({ id: 'AgentMessageDto' });

const AgentSessionResponseSchema = z
  .object({
    id: z.uuidv4().describe('Session ID'),
    title: z.string().nullable().describe('Session title'),
    profile: z.string().describe('Agent profile'),
    status: AgentSessionStatusSchema,
    autoApprove: z.boolean().describe('Whether changes to the library are approved automatically in this session'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    updatedAt: isoDatetimeToDate.describe('Last update date'),
  })
  .meta({ id: 'AgentSessionResponseDto' });

const AgentSessionDetailResponseSchema = AgentSessionResponseSchema.extend({
  messages: z.array(AgentMessageSchema).describe('Messages, oldest first'),
}).meta({ id: 'AgentSessionDetailResponseDto' });

const AgentUpdateSchema = z
  .object({
    sessionId: z.uuidv4().describe('Session ID'),
    status: AgentSessionStatusSchema,
    message: AgentMessageSchema.optional().describe('Created or updated message (replace by ID)'),
  })
  .meta({ id: 'AgentUpdateDto' });

export class AgentSessionCreateDto extends createZodDto(AgentSessionCreateSchema) {}
export class AgentSessionUpdateDto extends createZodDto(AgentSessionUpdateSchema) {}
export class AgentPromptDto extends createZodDto(AgentPromptSchema) {}
export class AgentPermissionResponseDto extends createZodDto(AgentPermissionResponseSchema) {}
export class AgentPermissionParamDto extends createZodDto(AgentPermissionParamSchema) {}
export class AgentMessageDto extends createZodDto(AgentMessageSchema) {}
export class AgentSessionResponseDto extends createZodDto(AgentSessionResponseSchema) {}
export class AgentSessionDetailResponseDto extends createZodDto(AgentSessionDetailResponseSchema) {}
@ExtraModel()
export class AgentUpdateDto extends createZodDto(AgentUpdateSchema) {}

export const mapAgentSession = (session: Selectable<AgentSessionTable>): AgentSessionResponseDto => ({
  id: session.id,
  title: session.title,
  profile: session.profile,
  status: session.status,
  autoApprove: session.autoApprove,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

export const mapAgentMessage = (message: Selectable<AgentMessageTable>): AgentMessageDto => ({
  id: message.id,
  sessionId: message.sessionId,
  role: message.role as AgentMessageRole,
  kind: message.kind as AgentMessageKind,
  content: message.content as AgentMessageContent,
  createdAt: message.createdAt,
});

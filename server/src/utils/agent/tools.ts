import z from 'zod';
import { AuthDto } from 'src/dtos/auth.dto.js';

export type AgentToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export type AgentToolResult = {
  content: AgentToolContent[];
  isError?: boolean;
};

export type AgentToolContext = {
  /** the user the agent acts on behalf of; all access checks use this */
  auth: AuthDto;
  /** the assistant session that made the call, if any */
  sessionId: string | null;
};

export type AgentTool<S extends z.ZodObject = z.ZodObject> = {
  /** snake_case tool name exposed to the agent */
  name: string;
  title: string;
  description: string;
  input: S;
  /** true when the tool changes the library; the user has to approve the call unless auto-approve is enabled */
  mutating: boolean;
  handler: (ctx: AgentToolContext, input: z.infer<S>) => Promise<AgentToolResult>;
};

export const defineTool = <S extends z.ZodObject>(tool: AgentTool<S>): AgentTool => tool as unknown as AgentTool;

export const toolJson = (value: unknown): AgentToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
});

export const toolImage = (image: Buffer, mimeType = 'image/jpeg', details?: unknown): AgentToolResult => ({
  content: [
    ...(details === undefined ? [] : toolJson(details).content),
    { type: 'image', data: image.toString('base64'), mimeType },
  ],
});

export const toolError = (message: string): AgentToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

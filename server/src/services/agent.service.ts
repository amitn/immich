// eslint-disable-next-line import-x/no-unresolved -- resolved through the package's wildcard export
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Selectable } from 'kysely';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { OnEvent } from 'src/decorators.js';
import {
  AgentMessageContent,
  AgentPermissionResponseDto,
  AgentPermissionStatus,
  AgentPromptDto,
  AgentSessionCreateDto,
  AgentSessionDetailResponseDto,
  AgentSessionResponseDto,
  AgentSessionUpdateDto,
  AgentToolCallStatus,
  mapAgentMessage,
  mapAgentSession,
} from 'src/dtos/agent.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AgentMessageKind, AgentMessageRole, AgentSessionStatus, ImmichWorker, Permission } from 'src/enum.js';
import {
  AcpAgent,
  AcpExitInfo,
  AcpPermissionRequest,
  AcpPermissionResponse,
  AcpSessionNotification,
  AcpSessionOptions,
  AcpToolCallUpdate,
  buildMcpServers,
} from 'src/repositories/acp.repository.js';
import { AgentMessageTable } from 'src/schema/tables/agent-message.table.js';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table.js';
import { AgentToolService } from 'src/services/agent-tool.service.js';
import { BaseService } from 'src/services/base.service.js';
import { AgentConfig, getAgentProfile, isAssistantEnabled } from 'src/utils/agent/config.js';
import { IMMICH_MCP_SERVER_NAME, RecapMessage, buildPromptText, buildRecap } from 'src/utils/agent/instructions.js';
import {
  compactJson,
  extractRefs,
  extractToolCallRefs,
  getAgentToolName,
  getImmichToolName,
  getToolCallResult,
  mergeRefs,
  summarizeToolArgs,
  truncateText,
} from 'src/utils/agent/session-updates.js';
import { AgentTool, AgentToolContext, AgentToolResult, toolError } from 'src/utils/agent/tools.js';

/** how long a mutating tool call waits for the user before it counts as declined */
export const AGENT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
/** streamed text is written to the database at most this often; every chunk is still sent over the websocket */
export const AGENT_TEXT_FLUSH_MS = 1000;
const RECAP_MESSAGES = 20;

/**
 * Options for claude-agent-acp (ignored by other agents), read from `_meta.claudeCode.options` of `session/new` and
 * `session/load` and spread into the Claude Agent SDK options (checked against claude-agent-acp 0.81):
 * - `tools: []` removes every built-in tool (Bash, Read, Write, Edit, WebFetch, Task...), MCP tools are unaffected
 * - `disallowedTools` is merged with the adapter's own list, as defense in depth
 * - `allowedTools` pre-approves the Immich MCP server, so its calls don't go through `session/request_permission`
 *   (mutating tools ask the user in the MCP layer instead)
 * - `settingSources: []` and `strictMcpConfig` ignore the host user's settings, CLAUDE.md, hooks and MCP servers
 */
const CLAUDE_CODE_SESSION_META = {
  claudeCode: {
    options: {
      tools: [],
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],
      allowedTools: [`mcp__${IMMICH_MCP_SERVER_NAME}`],
      settingSources: [],
      strictMcpConfig: true,
    },
  },
};

type Message = Selectable<AgentMessageTable>;
type Session = Selectable<AgentSessionTable>;

type TextSegment = {
  message: Message;
  text: string;
  dirty: boolean;
  flushedAt: number;
  timer?: NodeJS.Timeout;
};

type ToolCallEntry = {
  message: Message;
  content: AgentMessageContent;
  /** the tool call targets the Immich MCP server */
  immich: boolean;
  /** an MCP request was matched to this ACP tool call */
  claimed?: boolean;
  /** created by the MCP layer, since the agent didn't report the tool call (yet) */
  fromMcp?: boolean;
};

type RunningAgent = {
  sessionId: string;
  userId: string;
  token: string;
  agent?: AcpAgent;
  acpSessionId?: string;
  ready?: Promise<void>;
  /** the instructions were sent to the current ACP session */
  primed: boolean;
  recap?: string;
  busy: boolean;
  cancelRequested: boolean;
  /** `session/load` replays the history as updates, which are already stored */
  loading: boolean;
  stopping: boolean;
  deleted: boolean;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
  /** serializes message writes, so updates are applied in order */
  queue: Promise<unknown>;
  segment?: TextSegment;
  plan?: Message;
  toolCalls: Map<string, ToolCallEntry>;
  /** ids of tool calls that target Immich tools */
  immichToolCalls: Set<string>;
};

type PendingApproval = {
  sessionId: string;
  resolve: (status: AgentPermissionStatus) => void;
};

/** Runs assistant chat sessions against an ACP agent */
@Injectable()
export class AgentService extends BaseService {
  private running = new Map<string, RunningAgent>();
  private approvals = new Map<string, PendingApproval>();
  private toolService?: AgentToolService;

  @OnEvent({ name: 'ConfigValidate' })
  onConfigValidate({ newConfig }: ArgOf<'ConfigValidate'>) {
    const { agent } = newConfig;
    const names = agent.profiles.map((profile) => profile.name);
    if (new Set(names).size !== names.length) {
      throw new Error('Agent profile names must be unique');
    }

    if (agent.enabled && !getAgentProfile(agent, agent.chatProfile)) {
      throw new Error(`Unknown assistant chat profile: ${agent.chatProfile}`);
    }

    if (agent.enabled && agent.artProfile && !getAgentProfile(agent, agent.artProfile)) {
      throw new Error(`Unknown assistant art profile: ${agent.artProfile}`);
    }
  }

  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Api] })
  async onBootstrap() {
    await this.agentRepository.resetRunningSessions();
  }

  @OnEvent({ name: 'ConfigUpdate', server: true, workers: [ImmichWorker.Api] })
  async onConfigUpdate({ newConfig }: ArgOf<'ConfigUpdate'>) {
    if (!isAssistantEnabled(newConfig.agent)) {
      await this.stopAll();
    }
  }

  @OnEvent({ name: 'AppShutdown', workers: [ImmichWorker.Api] })
  async onShutdown() {
    await this.stopAll();
  }

  async createSession(auth: AuthDto, dto: AgentSessionCreateDto): Promise<AgentSessionResponseDto> {
    const config = await this.requireEnabled();
    const session = await this.agentRepository.createSession({
      userId: auth.user.id,
      title: dto.title || null,
      profile: config.chatProfile,
      autoApprove: dto.autoApprove ?? false,
    });
    return mapAgentSession(session);
  }

  async updateSession(auth: AuthDto, id: string, dto: AgentSessionUpdateDto): Promise<AgentSessionResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AgentSessionUpdate, ids: [id] });
    const session = await this.agentRepository.updateSession(id, {
      ...(dto.title !== undefined && { title: dto.title || null }),
      ...(dto.autoApprove !== undefined && { autoApprove: dto.autoApprove }),
    });
    return mapAgentSession(session);
  }

  async getSessions(auth: AuthDto): Promise<AgentSessionResponseDto[]> {
    const sessions = await this.agentRepository.getSessions(auth.user.id);
    return sessions.map((session) => mapAgentSession(session));
  }

  async getSession(auth: AuthDto, id: string): Promise<AgentSessionDetailResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AgentSessionRead, ids: [id] });
    const session = await this.findOrFail(id);
    const messages = await this.agentRepository.getMessages(id);
    const run = this.running.get(id);
    return {
      ...mapAgentSession(session),
      // streamed text may not be written to the database yet
      messages: messages.map((message) =>
        mapAgentMessage(run?.segment?.message.id === message.id ? this.segmentMessage(run.segment) : message),
      ),
    };
  }

  async deleteSession(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AgentSessionDelete, ids: [id] });
    const run = this.running.get(id);
    if (run) {
      run.deleted = true;
    }
    await this.stopAgent(id);
    await this.agentRepository.deleteSession(id);
  }

  /** Sends a message to the agent. Returns right away, progress is sent with `on_agent_update`. */
  async prompt(auth: AuthDto, id: string, dto: AgentPromptDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AgentSessionUpdate, ids: [id] });
    const config = await this.requireEnabled();
    const session = await this.findOrFail(id);

    let run = this.running.get(id);
    if (run?.busy) {
      throw new BadRequestException('The assistant is still working on the previous message');
    }

    if (!run) {
      this.makeRoom(config);
      run = this.newRunningAgent(session);
      this.running.set(id, run);
    }

    clearTimeout(run.idleTimer);
    run.busy = true;
    run.cancelRequested = false;
    run.lastUsed = Date.now();

    try {
      const message = await this.agentRepository.createMessage({
        sessionId: id,
        role: AgentMessageRole.User,
        kind: AgentMessageKind.Text,
        content: { text: dto.text, ...(dto.assetIds?.length && { assetIds: dto.assetIds }) },
      });
      this.emit(run, AgentSessionStatus.Running, message);
      await this.agentRepository.updateSession(id, {
        status: AgentSessionStatus.Running,
        ...(!session.title && { title: truncateText(dto.text.replaceAll(/\s+/g, ' '), 80) }),
      });

      if (!run.ready) {
        run.ready = this.startAgent(run, session, config, message.id);
      }
    } catch (error) {
      run.busy = false;
      throw error;
    }

    this.runTurn(run, dto).catch((error) => this.logger.error(`Assistant session ${id} failed`, error));
  }

  async cancel(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AgentSessionUpdate, ids: [id] });
    this.resolveApprovals(id, AgentPermissionStatus.Denied);

    const run = this.running.get(id);
    if (run?.busy) {
      run.cancelRequested = true;
      if (run.agent && run.acpSessionId) {
        await run.agent.cancel(run.acpSessionId).catch((error) => this.logger.warn(`Failed to cancel: ${error}`));
      }
      return;
    }

    const session = await this.findOrFail(id);
    if (session.status === AgentSessionStatus.Running) {
      await this.agentRepository.updateSession(id, { status: AgentSessionStatus.Idle });
    }
  }

  async respondToPermission(
    auth: AuthDto,
    id: string,
    requestId: string,
    dto: AgentPermissionResponseDto,
  ): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AgentSessionUpdate, ids: [id] });
    const approval = this.approvals.get(requestId);
    if (!approval || approval.sessionId !== id) {
      throw new BadRequestException('Permission request not found or expired');
    }

    if (dto.optionId === 'allow_always') {
      await this.agentRepository.updateSession(id, { autoApprove: true });
    }

    const approved = dto.approved ?? (dto.optionId === 'allow' || dto.optionId === 'allow_always');
    approval.resolve(approved ? AgentPermissionStatus.Approved : AgentPermissionStatus.Denied);
  }

  private async isAutoApproved(sessionId: string) {
    const session = await this.agentRepository.getSession(sessionId);
    return !!session?.autoApprove;
  }

  /** Handles a (stateless) MCP request from an agent process, authenticated with its bearer token. */
  async handleMcpRequest(authorization: string | undefined, req: IncomingMessage, res: ServerResponse, body: unknown) {
    const context = await this.authenticateMcp(authorization);
    const tools = this.getToolService();
    const server = tools.createMcpServer(tools.getTools(), (tool, input) => this.runTool(context, tool, input));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async authenticateMcp(authorization: string | undefined): Promise<AgentToolContext> {
    const [scheme, token] = authorization?.split(' ') ?? [];
    const context = scheme?.toLowerCase() === 'bearer' && token ? this.acpRepository.getMcpToken(token) : undefined;
    if (!context) {
      throw new UnauthorizedException('Invalid agent token');
    }

    const user = await this.agentRepository.getAuthUser(context.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid agent token');
    }

    return { auth: { user }, sessionId: context.sessionId };
  }

  /** Runs an MCP tool call: asks the user to approve mutating tools and logs the call to the session. */
  async runTool(context: AgentToolContext, tool: AgentTool, input: Record<string, unknown>): Promise<AgentToolResult> {
    const run = context.sessionId ? this.running.get(context.sessionId) : undefined;
    const { agent: config } = await this.getConfig({ withCache: true });
    const entry = run ? await this.enqueue(run, () => this.startMcpToolCall(run, tool, input)) : undefined;

    let result: AgentToolResult | undefined;
    if (tool.mutating && !config.autoApproveWrites && !(run && (await this.isAutoApproved(run.sessionId)))) {
      const status = run ? await this.requestApproval(run, tool, input) : AgentPermissionStatus.Denied;
      if (status !== AgentPermissionStatus.Approved) {
        result = toolError(
          status === AgentPermissionStatus.Expired
            ? `The user did not respond to the approval request for ${tool.name} in time`
            : `User declined the ${tool.name} call. Don't retry it; ask the user what to do instead.`,
        );
      }
    }

    if (!result) {
      try {
        result = await tool.handler(context, input);
      } catch (error: Error | unknown) {
        this.logger.warn(`Agent tool ${tool.name} failed: ${error}`);
        result = toolError(error instanceof Error ? error.message : String(error));
      }
    }

    if (run && entry) {
      const final = result;
      await this.enqueue(run, () => this.finishMcpToolCall(run, entry, tool, input, final));
    }

    return result;
  }

  protected getToolService() {
    if (!this.toolService) {
      this.toolService = BaseService.create(AgentToolService, this);
    }
    return this.toolService;
  }

  private getTools() {
    return new Map(
      this.getToolService()
        .getTools()
        .map((tool) => [tool.name, tool]),
    );
  }

  private async requireEnabled() {
    const { agent } = await this.getConfig({ withCache: true });
    if (!isAssistantEnabled(agent)) {
      throw new BadRequestException('The assistant is disabled');
    }
    return agent;
  }

  private async findOrFail(id: string) {
    const session = await this.agentRepository.getSession(id);
    if (!session) {
      throw new BadRequestException('Assistant session not found');
    }
    return session;
  }

  private getMcpUrl(config: AgentConfig) {
    return config.mcpUrl || `http://127.0.0.1:${this.configRepository.getEnv().port}/api/agent/mcp`;
  }

  /** Stops the least recently used idle agent when the limit is reached; fails if every agent is busy. */
  private makeRoom(config: AgentConfig) {
    if (this.running.size < config.maxConcurrentSessions) {
      return;
    }

    const idle = this.running
      .values()
      .filter((run) => !run.busy)
      .toArray()
      .toSorted((a, b) => a.lastUsed - b.lastUsed);
    const excess = this.running.size - config.maxConcurrentSessions + 1;
    if (idle.length < excess) {
      throw new BadRequestException('Too many assistant sessions are running, please try again later');
    }

    for (const run of idle.slice(0, excess)) {
      this.running.delete(run.sessionId);
      void this.stopAgent(run.sessionId, run);
    }
  }

  private newRunningAgent(session: Session): RunningAgent {
    return {
      sessionId: session.id,
      userId: session.userId,
      token: this.acpRepository.issueMcpToken({ userId: session.userId, sessionId: session.id }),
      primed: false,
      busy: false,
      cancelRequested: false,
      loading: false,
      stopping: false,
      deleted: false,
      lastUsed: Date.now(),
      queue: Promise.resolve(),
      toolCalls: new Map(),
      immichToolCalls: new Set(),
    };
  }

  private async startAgent(run: RunningAgent, session: Session, config: AgentConfig, promptMessageId: string) {
    const profile = getAgentProfile(config, session.profile) ?? getAgentProfile(config, config.chatProfile);
    if (!profile) {
      throw new Error(`Unknown agent profile: ${session.profile}`);
    }

    // the directory name is stable, so agents that key stored sessions by cwd can load them again
    const cwd = await this.acpRepository.createWorkdir(session.id);
    const agent = await this.acpRepository.start({
      profile,
      cwd,
      handlers: {
        onUpdate: (notification) => {
          if (run.loading) {
            return;
          }
          this.trackImmichToolCall(run, notification);
          void this.enqueue(run, () => this.onSessionUpdate(run, notification));
        },
        onPermission: (request) => this.onPermissionRequest(run, request),
        onExit: (info) => this.onAgentExit(run, info),
      },
    });
    run.agent = agent;

    if (run.stopping) {
      await agent.kill();
      throw new Error('The assistant was stopped');
    }

    const options: AcpSessionOptions = {
      cwd,
      mcpServers: buildMcpServers(agent.initialize, {
        name: IMMICH_MCP_SERVER_NAME,
        url: this.getMcpUrl(config),
        token: run.token,
      }),
      _meta: CLAUDE_CODE_SESSION_META,
    };

    if (session.acpSessionId && agent.initialize.agentCapabilities?.loadSession) {
      run.loading = true;
      try {
        await agent.loadSession(session.acpSessionId, options);
        run.acpSessionId = session.acpSessionId;
        run.primed = true;
        return;
      } catch (error) {
        this.logger.warn(`Unable to load agent session ${session.acpSessionId}, starting a new one: ${error}`);
      } finally {
        run.loading = false;
      }
    }

    const { sessionId } = await agent.newSession(options);
    run.acpSessionId = sessionId;
    run.primed = false;
    await this.agentRepository.updateSession(session.id, { acpSessionId: sessionId });

    const history = await this.agentRepository.getRecentTextMessages(session.id, RECAP_MESSAGES + 1);
    const recap: RecapMessage[] = history
      .filter((message) => message.id !== promptMessageId)
      .slice(0, RECAP_MESSAGES)
      .toReversed()
      .map((message) => ({
        role: message.role === AgentMessageRole.User ? 'user' : 'agent',
        text: String(message.content.text ?? ''),
      }));
    run.recap = buildRecap(recap) || undefined;
  }

  private async runTurn(run: RunningAgent, dto: AgentPromptDto) {
    try {
      await run.ready;
      if (!run.agent || !run.acpSessionId) {
        throw new Error('The assistant is not running');
      }

      if (run.cancelRequested) {
        await this.enqueue(run, () => this.endTurn(run, 'cancelled'));
        return;
      }

      const text = buildPromptText({
        text: dto.text,
        assetIds: dto.assetIds,
        instructions: !run.primed,
        recap: run.recap,
      });
      run.primed = true;
      run.recap = undefined;

      const response = await run.agent.prompt(run.acpSessionId, [{ type: 'text', text }]);
      await this.enqueue(run, () => this.endTurn(run, response.stopReason));
    } catch (error: Error | unknown) {
      this.logger.warn(`Assistant session ${run.sessionId} failed: ${error}`);
      await this.enqueue(run, () => this.failTurn(run, error));
    }
  }

  private async endTurn(run: RunningAgent, stopReason: string) {
    await this.closeSegment(run);
    run.plan = undefined;
    run.toolCalls.clear();
    run.immichToolCalls.clear();

    const reasons: Record<string, string> = {
      max_tokens: 'The assistant reached its output limit.',
      max_turn_requests: 'The assistant reached the maximum number of steps for one message.',
      refusal: 'The assistant refused to continue.',
    };
    if (reasons[stopReason]) {
      await this.addMessage(run, AgentMessageKind.Error, { text: reasons[stopReason] });
    }

    await this.finishTurn(run, AgentSessionStatus.Idle);
  }

  private async failTurn(run: RunningAgent, error: unknown) {
    await this.closeSegment(run);
    run.plan = undefined;
    run.toolCalls.clear();
    run.immichToolCalls.clear();

    const text = error instanceof Error ? error.message : String(error);
    await this.addMessage(run, AgentMessageKind.Error, { text: truncateText(text, 1000) });
    await this.finishTurn(run, AgentSessionStatus.Error);

    if (!run.agent?.isAlive()) {
      await this.stopAgent(run.sessionId, run);
    }
  }

  private async finishTurn(run: RunningAgent, status: AgentSessionStatus) {
    run.busy = false;
    run.lastUsed = Date.now();
    this.resolveApprovals(run.sessionId, AgentPermissionStatus.Expired);

    if (this.running.get(run.sessionId) === run) {
      const { agent: config } = await this.getConfig({ withCache: true });
      clearTimeout(run.idleTimer);
      run.idleTimer = setTimeout(() => void this.stopAgent(run.sessionId, run), config.idleTimeoutMinutes * 60_000);
      run.idleTimer.unref?.();
    }

    await this.setStatus(run, status);
  }

  private onAgentExit(run: RunningAgent, { code, signal, stderr }: AcpExitInfo) {
    if (run.stopping) {
      return;
    }

    this.logger.warn(
      `Agent process of assistant session ${run.sessionId} exited unexpectedly (${signal ?? code}): ${stderr.slice(-2000)}`,
    );
    void this.stopAgent(run.sessionId, run);
  }

  private async stopAgent(sessionId: string, run = this.running.get(sessionId)) {
    if (!run || run.stopping) {
      return;
    }

    run.stopping = true;
    clearTimeout(run.idleTimer);
    if (this.running.get(sessionId) === run) {
      this.running.delete(sessionId);
    }
    this.acpRepository.revokeMcpToken(run.token);
    this.resolveApprovals(sessionId, AgentPermissionStatus.Denied);

    await run.ready?.catch(() => {});
    await run.agent?.kill();
    // a new agent for the same session reuses the directory
    if (!this.running.has(sessionId)) {
      await this.acpRepository.removeWorkdir(this.acpRepository.getWorkdir(sessionId));
    }
  }

  private async stopAll() {
    await Promise.all(this.running.keys().map((sessionId) => this.stopAgent(sessionId)));
  }

  /** Runs `fn` after the pending writes of the session; skipped once the session is deleted */
  private enqueue<T>(run: RunningAgent, fn: () => Promise<T>): Promise<T | undefined> {
    const next = run.queue.then(() => (run.deleted ? undefined : fn()));
    run.queue = next.catch((error) => this.logger.error(`Failed to update assistant session ${run.sessionId}`, error));
    return next;
  }

  private emit(run: RunningAgent, status: AgentSessionStatus, message?: Message) {
    this.websocketRepository.clientSend('on_agent_update', run.userId, {
      sessionId: run.sessionId,
      status,
      ...(message && { message: mapAgentMessage(message) }),
    });
  }

  private getStatus(run: RunningAgent) {
    return run.busy ? AgentSessionStatus.Running : AgentSessionStatus.Idle;
  }

  private async setStatus(run: RunningAgent, status: AgentSessionStatus) {
    await this.agentRepository.updateSession(run.sessionId, { status });
    this.emit(run, status);
  }

  private async addMessage(
    run: RunningAgent,
    kind: AgentMessageKind,
    content: AgentMessageContent,
    externalId?: string,
  ): Promise<Message> {
    const message = await this.agentRepository.createMessage({
      sessionId: run.sessionId,
      role: AgentMessageRole.Agent,
      kind,
      content,
      externalId: externalId ?? null,
    });
    this.emit(run, this.getStatus(run), message);
    return message;
  }

  private async saveMessage(run: RunningAgent, id: string, content: AgentMessageContent): Promise<Message> {
    const message = await this.agentRepository.updateMessage(id, content);
    this.emit(run, this.getStatus(run), message);
    return message;
  }

  private segmentMessage(segment: TextSegment): Message {
    return { ...segment.message, content: { ...segment.message.content, text: segment.text } };
  }

  private async appendText(run: RunningAgent, kind: AgentMessageKind.Text | AgentMessageKind.Thought, text: string) {
    if (run.segment && run.segment.message.kind !== kind) {
      await this.closeSegment(run);
    }

    if (!run.segment) {
      const message = await this.addMessage(run, kind, { text });
      run.segment = { message, text, dirty: false, flushedAt: Date.now() };
      return;
    }

    const segment = run.segment;
    segment.text += text;
    segment.dirty = true;
    this.emit(run, this.getStatus(run), this.segmentMessage(segment));

    if (Date.now() - segment.flushedAt >= AGENT_TEXT_FLUSH_MS) {
      await this.flushSegment(segment);
    } else if (!segment.timer) {
      segment.timer = setTimeout(() => void this.enqueue(run, () => this.flushSegment(segment)), AGENT_TEXT_FLUSH_MS);
    }
  }

  private async flushSegment(segment: TextSegment) {
    clearTimeout(segment.timer);
    segment.timer = undefined;
    if (!segment.dirty) {
      return;
    }

    segment.dirty = false;
    segment.flushedAt = Date.now();
    segment.message = await this.agentRepository.updateMessage(segment.message.id, {
      ...segment.message.content,
      text: segment.text,
    });
  }

  private async closeSegment(run: RunningAgent) {
    const segment = run.segment;
    if (!segment) {
      return;
    }

    run.segment = undefined;
    await this.flushSegment(segment);
  }

  private async onSessionUpdate(run: RunningAgent, { update }: AcpSessionNotification) {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        if (update.content.type === 'text' && update.content.text) {
          const kind =
            update.sessionUpdate === 'agent_message_chunk' ? AgentMessageKind.Text : AgentMessageKind.Thought;
          await this.appendText(run, kind, update.content.text);
        }
        return;
      }

      case 'tool_call':
      case 'tool_call_update': {
        await this.closeSegment(run);
        await this.onToolCall(run, update);
        return;
      }

      case 'plan': {
        await this.closeSegment(run);
        const content: AgentMessageContent = {
          entries: update.entries.map(({ content, priority, status }) => ({ content, priority, status })),
        };
        run.plan = run.plan
          ? await this.saveMessage(run, run.plan.id, content)
          : await this.addMessage(run, AgentMessageKind.Plan, content);
        return;
      }

      default: {
        return;
      }
    }
  }

  private async onToolCall(run: RunningAgent, update: AcpToolCallUpdate & { sessionUpdate: string }) {
    let entry = run.toolCalls.get(update.toolCallId);
    const immichTool = getImmichToolName(update, new Set(this.getTools().keys()));

    if (!entry && immichTool) {
      // the MCP request can arrive before the agent reports the tool call
      entry = run.toolCalls
        .values()
        .find(
          (candidate) =>
            candidate.fromMcp && !candidate.content.toolCallId && candidate.content.toolName === immichTool,
        );
      if (entry) {
        entry.claimed = true;
        run.toolCalls.set(update.toolCallId, entry);
      }
    }

    const { texts, values } = getToolCallResult(update);
    const refTool = immichTool ?? (entry?.immich ? entry.content.toolName : undefined);

    const content: AgentMessageContent = mergeRefs(
      {
        ...entry?.content,
        toolCallId: update.toolCallId,
        ...((immichTool || !entry) && { toolName: immichTool ?? getAgentToolName(update) }),
        ...(immichTool
          ? { title: this.getTools().get(immichTool)?.title ?? immichTool }
          : update.title && !entry?.fromMcp
            ? { title: update.title }
            : {}),
        ...(update.status && { status: update.status }),
        ...(update.rawInput !== undefined && { input: compactJson(update.rawInput) }),
        ...(texts.length > 0 && { output: truncateText(texts.join('\n')) }),
      },
      extractToolCallRefs(refTool, { input: update.rawInput, output: values }),
    );
    content.status ??= AgentToolCallStatus.Pending;

    if (entry) {
      entry.content = content;
      entry.immich ||= !!immichTool;
      entry.message = await this.saveMessage(run, entry.message.id, content);
      return;
    }

    const message = await this.addMessage(run, AgentMessageKind.ToolCall, content, update.toolCallId);
    run.toolCalls.set(update.toolCallId, { message, content, immich: !!immichTool });
  }

  /** Allows calls to Immich MCP tools and rejects every other tool (shell, files, web...). */
  /**
   * Remembers which tool calls target Immich tools as soon as they are reported (before the update is queued),
   * since some agents (codex-acp) only send the tool call id with the permission request.
   */
  private trackImmichToolCall(run: RunningAgent, { update }: AcpSessionNotification) {
    if (
      (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') &&
      getImmichToolName(update, new Set(this.getTools().keys()))
    ) {
      run.immichToolCalls.add(update.toolCallId);
    }
  }

  private onPermissionRequest(run: RunningAgent, request: AcpPermissionRequest): Promise<AcpPermissionResponse> {
    const { toolCall, options, _meta } = request;
    const rawInput = toolCall.rawInput as { serverName?: unknown } | undefined;
    const isImmich =
      !!getImmichToolName(toolCall, new Set(this.getTools().keys())) ||
      run.immichToolCalls.has(toolCall.toolCallId) ||
      // codex-acp approval without a matching tool call
      (!!_meta?.is_mcp_tool_approval && rawInput?.serverName === IMMICH_MCP_SERVER_NAME);

    const select = (kinds: string[]): AcpPermissionResponse => {
      const option = kinds.map((kind) => options.find((option) => option.kind === kind)).find(Boolean);
      return option
        ? { outcome: { outcome: 'selected', optionId: option.optionId } }
        : { outcome: { outcome: 'cancelled' } };
    };

    if (isImmich) {
      return Promise.resolve(select(['allow_once', 'allow_always']));
    }

    this.logger.warn(
      `Rejected tool "${getAgentToolName(toolCall) ?? 'unknown'}" requested by the agent of assistant session ${run.sessionId}`,
    );
    return Promise.resolve(select(['reject_once', 'reject_always']));
  }

  private async startMcpToolCall(run: RunningAgent, tool: AgentTool, input: Record<string, unknown>) {
    const pending = run.toolCalls
      .values()
      .find(
        (entry) =>
          entry.immich &&
          !entry.claimed &&
          !entry.fromMcp &&
          entry.content.toolName === tool.name &&
          entry.content.status !== AgentToolCallStatus.Completed &&
          entry.content.status !== AgentToolCallStatus.Failed,
      );
    if (pending) {
      pending.claimed = true;
      return pending;
    }

    const content: AgentMessageContent = {
      toolName: tool.name,
      title: tool.title,
      status: AgentToolCallStatus.InProgress,
      input: compactJson(input),
    };
    const externalId = `mcp:${randomUUID()}`;
    const message = await this.addMessage(run, AgentMessageKind.ToolCall, content, externalId);
    const entry: ToolCallEntry = { message, content, immich: true, fromMcp: true };
    run.toolCalls.set(externalId, entry);
    return entry;
  }

  private async finishMcpToolCall(
    run: RunningAgent,
    entry: ToolCallEntry,
    tool: AgentTool,
    input: Record<string, unknown>,
    result: AgentToolResult,
  ) {
    const { texts, values } = getToolCallResult({ rawOutput: result });
    let content = mergeRefs(entry.content, extractToolCallRefs(tool.name, { input, output: values }));
    if (entry.fromMcp) {
      content = {
        ...content,
        status: result.isError ? AgentToolCallStatus.Failed : AgentToolCallStatus.Completed,
        output: truncateText(texts.join('\n')),
      };
    }

    entry.content = content;
    entry.message = await this.saveMessage(run, entry.message.id, content);
  }

  private async requestApproval(run: RunningAgent, tool: AgentTool, input: Record<string, unknown>) {
    const requestId = randomUUID();
    const content: AgentMessageContent = {
      requestId,
      toolName: tool.name,
      title: tool.title,
      summary: summarizeToolArgs(input),
      input: compactJson(input),
      status: AgentPermissionStatus.Pending,
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'allow_always', name: 'Allow all in this chat', kind: 'allow_always' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
      ...mergeRefs({}, extractRefs(input, tool.name)),
    };
    const message = await this.enqueue(run, () =>
      this.addMessage(run, AgentMessageKind.Permission, content, requestId),
    );
    if (!message) {
      return AgentPermissionStatus.Denied;
    }

    const status = await new Promise<AgentPermissionStatus>((resolve) => {
      const timer = setTimeout(() => resolve(AgentPermissionStatus.Expired), AGENT_APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      this.approvals.set(requestId, {
        sessionId: run.sessionId,
        resolve: (status) => {
          clearTimeout(timer);
          resolve(status);
        },
      });
    });
    this.approvals.delete(requestId);

    await this.enqueue(run, () => this.saveMessage(run, message.id, { ...content, status }));
    return status;
  }

  private resolveApprovals(sessionId: string, status: AgentPermissionStatus) {
    for (const approval of this.approvals.values()) {
      if (approval.sessionId === sessionId) {
        approval.resolve(status);
      }
    }
  }
}

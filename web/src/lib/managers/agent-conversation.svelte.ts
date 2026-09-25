import {
  AgentMessageKind,
  AgentMessageRole,
  AgentSessionStatus,
  type AgentMessageDto,
  type AgentSessionDetailResponseDto,
  type AgentUpdateDto,
} from '@immich/sdk';

/** `content.status` of tool call messages (a plain string in the API) */
export enum AgentToolCallStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
}

/** `content.status` of permission messages (a plain string in the API) */
export enum AgentPermissionStatus {
  Pending = 'pending',
  Approved = 'approved',
  Denied = 'denied',
  Expired = 'expired',
}

export type ChatMessage = AgentMessageDto & {
  /** optimistic user message that the server has not confirmed yet */
  pending?: boolean;
};

const LOCAL_PREFIX = 'local-';

const nowIso = () => new Date(Date.now()).toISOString();

const sameAssets = (a: string[] | undefined, b: string[] | undefined) => {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((id, i) => id === right[i]);
};

const isFinalStatus = (status: string | undefined) => !!status && status !== AgentPermissionStatus.Pending;

/**
 * Keyed list of the messages of one assistant chat session.
 *
 * - Server messages are keyed by id; an update for an existing id replaces it in place
 *   (streaming text updates the same id repeatedly).
 * - Optimistic user messages are shown immediately and replaced by the server's copy of the
 *   same user message once it arrives.
 */
export class AgentConversation {
  sessionId = $state<string | undefined>();
  status = $state<AgentSessionStatus>(AgentSessionStatus.Idle);
  #messages = $state.raw<ChatMessage[]>([]);
  #localId = 0;

  get messages(): ChatMessage[] {
    return this.#messages;
  }

  get isRunning() {
    return this.status === AgentSessionStatus.Running;
  }

  get isEmpty() {
    return this.#messages.length === 0;
  }

  /** Start an empty conversation (optionally for a freshly created session) */
  reset(sessionId?: string) {
    this.sessionId = sessionId;
    this.status = AgentSessionStatus.Idle;
    this.#messages = [];
  }

  /** Replace the history with the server copy, keeping optimistic messages that are still unconfirmed */
  load(detail: AgentSessionDetailResponseDto) {
    const sameSession = this.sessionId === detail.id;
    const pending = sameSession ? this.#messages.filter((message) => message.pending) : [];

    this.sessionId = detail.id;
    this.status = detail.status;
    this.#messages = detail.messages.map((message) => ({ ...message }));

    for (const message of pending) {
      this.#pushOptimistic(message);
    }
  }

  /** Add a user message before the server has confirmed it; returns its local id */
  addOptimistic(text: string, assetIds?: string[]): string {
    const id = `${LOCAL_PREFIX}${++this.#localId}`;
    this.#messages = [
      ...this.#messages,
      {
        id,
        sessionId: this.sessionId ?? '',
        role: AgentMessageRole.User,
        kind: AgentMessageKind.Text,
        content: { text, assetIds: assetIds?.length ? assetIds : undefined },
        createdAt: nowIso(),
        pending: true,
      },
    ];
    return id;
  }

  /** Drop an optimistic message, e.g. when sending it failed */
  removeOptimistic(localId: string) {
    this.#messages = this.#messages.filter((message) => message.id !== localId);
  }

  /** Apply a websocket update; returns false when it belongs to another session */
  applyUpdate(update: AgentUpdateDto): boolean {
    if (!this.sessionId || update.sessionId !== this.sessionId) {
      return false;
    }

    this.status = update.status;
    if (update.message) {
      this.upsert(update.message);
    }

    return true;
  }

  upsert(message: AgentMessageDto) {
    const messages = this.#messages;
    const index = messages.findIndex(({ id }) => id === message.id);

    if (index !== -1) {
      const next = [...messages];
      next[index] = { ...message };
      this.#messages = next;
      return;
    }

    if (message.role === AgentMessageRole.User && message.kind === AgentMessageKind.Text) {
      const optimisticIndex = messages.findIndex(
        (candidate) =>
          candidate.pending &&
          (candidate.content.text ?? '').trim() === (message.content.text ?? '').trim() &&
          sameAssets(candidate.content.assetIds, message.content.assetIds),
      );
      const fallbackIndex =
        optimisticIndex === -1 ? messages.findIndex((candidate) => candidate.pending) : optimisticIndex;

      if (fallbackIndex !== -1) {
        const next = [...messages];
        next[fallbackIndex] = { ...message };
        this.#messages = next;
        return;
      }
    }

    this.#messages = [...messages, { ...message }];
  }

  /** Show a permission as answered until the server confirms it */
  setPermissionStatus(requestId: string, status: string) {
    this.#messages = this.#messages.map((message) =>
      message.kind === AgentMessageKind.Permission && message.content.requestId === requestId
        ? { ...message, content: { ...message.content, status } }
        : message,
    );
  }

  /** Permission requests that are still waiting for an answer */
  get pendingPermissions() {
    return this.#messages.filter(
      (message) => message.kind === AgentMessageKind.Permission && !isFinalStatus(message.content.status),
    );
  }

  #pushOptimistic(message: ChatMessage) {
    const confirmed = this.#messages.some(
      (candidate) =>
        candidate.role === AgentMessageRole.User &&
        candidate.kind === AgentMessageKind.Text &&
        !candidate.pending &&
        (candidate.content.text ?? '').trim() === (message.content.text ?? '').trim() &&
        Date.parse(candidate.createdAt) >= Date.parse(message.createdAt) - 60_000,
    );

    if (!confirmed) {
      this.#messages = [...this.#messages, message];
    }
  }
}

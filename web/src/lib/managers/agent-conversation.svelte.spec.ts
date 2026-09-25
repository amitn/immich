import { AgentConversation } from '$lib/managers/agent-conversation.svelte';
import type { AgentMessageDto, AgentSessionDetailResponseDto } from '$lib/types/assistant';

const message = (overrides: Partial<AgentMessageDto> & { id: string }): AgentMessageDto => ({
  sessionId: 'session-1',
  role: 'agent',
  kind: 'text',
  content: {},
  createdAt: new Date().toISOString(),
  ...overrides,
});

const detail = (messages: AgentMessageDto[], overrides?: Partial<AgentSessionDetailResponseDto>) => ({
  id: 'session-1',
  title: 'Chat',
  profile: 'claude',
  status: 'idle' as const,
  autoApprove: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages,
  ...overrides,
});

describe(AgentConversation.name, () => {
  let sut: AgentConversation;

  beforeEach(() => {
    sut = new AgentConversation();
    sut.reset('session-1');
  });

  it('should start empty', () => {
    expect(sut.messages).toEqual([]);
    expect(sut.isEmpty).toBe(true);
    expect(sut.isRunning).toBe(false);
  });

  describe('load', () => {
    it('should load the history and status', () => {
      sut.load(detail([message({ id: 'm1' }), message({ id: 'm2' })], { status: 'running' }));

      expect(sut.messages.map(({ id }) => id)).toEqual(['m1', 'm2']);
      expect(sut.status).toBe('running');
      expect(sut.isRunning).toBe(true);
    });

    it('should keep unconfirmed optimistic messages when reloading the same session', () => {
      sut.load(detail([message({ id: 'm1' })]));
      const localId = sut.addOptimistic('hello');

      sut.load(detail([message({ id: 'm1' })]));

      expect(sut.messages.map(({ id }) => id)).toEqual(['m1', localId]);
    });

    it('should drop optimistic messages that the server already has', () => {
      sut.addOptimistic('hello');

      sut.load(detail([message({ id: 'u1', role: 'user', content: { text: 'hello' } })]));

      expect(sut.messages.map(({ id }) => id)).toEqual(['u1']);
    });

    it('should drop optimistic messages when switching to another session', () => {
      sut.addOptimistic('hello');

      sut.load(detail([], { id: 'session-2' }));

      expect(sut.messages).toEqual([]);
      expect(sut.sessionId).toBe('session-2');
    });
  });

  describe('applyUpdate', () => {
    it('should ignore updates for other sessions', () => {
      const applied = sut.applyUpdate({ sessionId: 'other', status: 'running', message: message({ id: 'm1' }) });

      expect(applied).toBe(false);
      expect(sut.messages).toEqual([]);
      expect(sut.status).toBe('idle');
    });

    it('should ignore updates when no session is selected', () => {
      sut.reset();
      expect(sut.applyUpdate({ sessionId: 'session-1', status: 'running' })).toBe(false);
    });

    it('should update the status without a message', () => {
      expect(sut.applyUpdate({ sessionId: 'session-1', status: 'running' })).toBe(true);
      expect(sut.status).toBe('running');
    });

    it('should append new messages', () => {
      sut.applyUpdate({ sessionId: 'session-1', status: 'running', message: message({ id: 'm1' }) });
      sut.applyUpdate({ sessionId: 'session-1', status: 'running', message: message({ id: 'm2' }) });

      expect(sut.messages.map(({ id }) => id)).toEqual(['m1', 'm2']);
    });

    it('should replace a streaming message in place', () => {
      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'm1', content: { text: 'Hel' } }),
      });
      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'm2', kind: 'tool_call', content: { status: 'pending' } }),
      });
      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'm1', content: { text: 'Hello world' } }),
      });

      expect(sut.messages.map(({ id }) => id)).toEqual(['m1', 'm2']);
      expect(sut.messages[0].content.text).toBe('Hello world');
    });

    it('should update tool call status in place', () => {
      const toolCall = message({ id: 't1', kind: 'tool_call', content: { toolCallId: 'x', status: 'in_progress' } });
      sut.applyUpdate({ sessionId: 'session-1', status: 'running', message: toolCall });
      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'idle',
        message: { ...toolCall, content: { ...toolCall.content, status: 'completed', assetIds: ['a1'] } },
      });

      expect(sut.messages).toHaveLength(1);
      expect(sut.messages[0].content).toEqual({ toolCallId: 'x', status: 'completed', assetIds: ['a1'] });
      expect(sut.status).toBe('idle');
    });

    it('should produce a new array on every change', () => {
      const before = sut.messages;
      sut.applyUpdate({ sessionId: 'session-1', status: 'running', message: message({ id: 'm1' }) });
      expect(sut.messages).not.toBe(before);
    });
  });

  describe('optimistic messages', () => {
    it('should add a pending user message', () => {
      const id = sut.addOptimistic('hello', ['a1']);

      expect(id).toMatch(/^local-/);
      expect(sut.messages).toEqual([
        expect.objectContaining({
          id,
          role: 'user',
          kind: 'text',
          pending: true,
          content: { text: 'hello', assetIds: ['a1'] },
        }),
      ]);
    });

    it('should not store an empty asset list', () => {
      sut.addOptimistic('hello', []);
      expect(sut.messages[0].content.assetIds).toBeUndefined();
    });

    it('should remove an optimistic message', () => {
      const id = sut.addOptimistic('hello');
      sut.removeOptimistic(id);
      expect(sut.messages).toEqual([]);
    });

    it('should reconcile the server copy in place', () => {
      sut.addOptimistic('first');
      sut.addOptimistic('second');

      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'u2', role: 'user', content: { text: 'second' } }),
      });

      expect(sut.messages.map(({ id, pending }) => [id, !!pending])).toEqual([
        ['local-1', true],
        ['u2', false],
      ]);
    });

    it('should match on the attached assets as well', () => {
      sut.addOptimistic('same', ['a1']);
      sut.addOptimistic('same', ['a2']);

      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'u1', role: 'user', content: { text: 'same', assetIds: ['a2'] } }),
      });

      expect(sut.messages.map(({ id }) => id)).toEqual(['local-1', 'u1']);
    });

    it('should fall back to the oldest pending message when the server rewrote the text', () => {
      sut.addOptimistic('hello');

      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'u1', role: 'user', content: { text: 'hello (with 2 photos attached)' } }),
      });

      expect(sut.messages.map(({ id }) => id)).toEqual(['u1']);
    });

    it('should keep agent replies after the reconciled user message', () => {
      sut.addOptimistic('hello');
      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'u1', role: 'user', content: { text: 'hello' } }),
      });
      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'a1', content: { text: 'Hi!' } }),
      });

      expect(sut.messages.map(({ id }) => id)).toEqual(['u1', 'a1']);
    });

    it('should not reconcile agent messages with optimistic ones', () => {
      sut.addOptimistic('hello');
      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: message({ id: 'a1', content: { text: 'hello' } }),
      });

      expect(sut.messages.map(({ id }) => id)).toEqual(['local-1', 'a1']);
    });
  });

  describe('permissions', () => {
    const permission = (requestId: string) =>
      message({ id: `p-${requestId}`, kind: 'permission', content: { requestId, status: 'pending', summary: 'x' } });

    it('should list pending permissions', () => {
      sut.load(detail([permission('r1'), permission('r2')]));
      expect(sut.pendingPermissions.map(({ id }) => id)).toEqual(['p-r1', 'p-r2']);
    });

    it('should set a permission status optimistically', () => {
      sut.load(detail([permission('r1'), permission('r2')]));

      sut.setPermissionStatus('r1', 'approved');

      expect(sut.messages[0].content.status).toBe('approved');
      expect(sut.messages[1].content.status).toBe('pending');
      expect(sut.pendingPermissions.map(({ id }) => id)).toEqual(['p-r2']);
    });

    it('should let the server override the optimistic status', () => {
      sut.load(detail([permission('r1')]));
      sut.setPermissionStatus('r1', 'approved');

      sut.applyUpdate({
        sessionId: 'session-1',
        status: 'running',
        message: { ...permission('r1'), content: { requestId: 'r1', status: 'expired' } },
      });

      expect(sut.messages[0].content.status).toBe('expired');
    });
  });
});

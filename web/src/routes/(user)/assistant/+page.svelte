<script lang="ts">
  import { replaceState } from '$app/navigation';
  import AssistantComposer from '$lib/components/assistant/AssistantComposer.svelte';
  import AssistantEmptyState from '$lib/components/assistant/AssistantEmptyState.svelte';
  import AssistantMessage from '$lib/components/assistant/AssistantMessage.svelte';
  import AssistantSessionList from '$lib/components/assistant/AssistantSessionList.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { AgentConversation, type ChatMessage } from '$lib/managers/agent-conversation.svelte';
  import { Route } from '$lib/route';
  import {
    cancelAgentSession,
    createAgentSession,
    deleteAgentSession,
    getAgentSession,
    getAgentSessions,
    respondToAgentPermission,
    sendAgentPrompt,
    updateAgentSession,
  } from '$lib/services/assistant-api';
  import { takePendingAssistantAssets } from '$lib/services/assistant.service';
  import { websocketEvents } from '$lib/stores/websocket';
  import type {
    AgentPermissionResponseDto,
    AgentPermissionStatus,
    AgentSessionResponseDto,
    AgentUpdateDto,
  } from '$lib/types/assistant';
  import { handleError } from '$lib/utils/handle-error';
  import { Alert, Button, IconButton, LoadingSpinner, modalManager, Switch, toastManager } from '@immich/ui';
  import { mdiArrowDown, mdiForumOutline, mdiPlus } from '@mdi/js';
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  const TITLE_LENGTH = 60;
  const BOTTOM_THRESHOLD = 80;

  const conversation = new AgentConversation();

  let sessions = $state<AgentSessionResponseDto[]>(data.sessions);
  let draft = $state(data.context.prompt);
  let contextAssetIds = $state<string[]>([...new Set([...data.context.assetIds, ...takePendingAssistantAssets()])]);
  let isSending = $state(false);
  let isLoadingSession = $state(false);
  let showSessions = $state(false);
  /** auto-approve for a chat that doesn't exist yet, sent when it is created */
  let autoApproveNewChat = $state(false);
  const activeSession = $derived(sessions.find(({ id }) => id === conversation.sessionId));
  const autoApprove = $derived(activeSession ? activeSession.autoApprove : autoApproveNewChat);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let scroller = $state<HTMLElement>();
  let isAtBottom = $state(true);

  const sortedSessions = $derived([...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  const lastMessage = $derived(conversation.messages.at(-1));
  const showWorking = $derived(conversation.isRunning && (!lastMessage || lastMessage.role === 'user'));

  const syncUrl = (sessionId?: string) => {
    try {
      replaceState(Route.assistant({ sessionId }), {});
    } catch {
      // router not ready yet
    }
  };

  const focusInput = async () => {
    await tick();
    textarea?.focus();
  };

  const scrollToBottom = async (behavior: ScrollBehavior = 'auto') => {
    await tick();
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior });
  };

  const onScroll = () => {
    if (!scroller) {
      return;
    }
    isAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_THRESHOLD;
  };

  $effect(() => {
    // re-run whenever the message list changes, but only follow the output when the user is at the bottom
    void conversation.messages;
    void showWorking;
    if (isAtBottom) {
      void scrollToBottom();
    }
  });

  const upsertSession = (session: AgentSessionResponseDto) => {
    const index = sessions.findIndex(({ id }) => id === session.id);
    const value = {
      id: session.id,
      title: session.title,
      profile: session.profile,
      status: session.status,
      autoApprove: session.autoApprove,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    if (index === -1) {
      sessions = [value, ...sessions];
    } else {
      sessions[index] = value;
    }
  };

  const refreshSessions = async () => {
    try {
      sessions = await getAgentSessions();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_assistant_chats'), { notify: false });
    }
  };

  const loadSession = async (id: string) => {
    isLoadingSession = conversation.isEmpty;
    try {
      const detail = await getAgentSession({ id });
      if (conversation.sessionId === id) {
        conversation.load(detail);
        upsertSession(detail);
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_assistant_chat'));
      if (conversation.sessionId === id) {
        conversation.reset();
        syncUrl();
      }
    } finally {
      isLoadingSession = false;
    }
  };

  const selectSession = async (session: { id: string }) => {
    showSessions = false;
    if (conversation.sessionId === session.id) {
      return;
    }
    conversation.reset(session.id);
    isAtBottom = true;
    syncUrl(session.id);
    await loadSession(session.id);
    await focusInput();
  };

  const newChat = async () => {
    showSessions = false;
    conversation.reset();
    isAtBottom = true;
    draft = '';
    syncUrl();
    await focusInput();
  };

  const toTitle = (text: string) => {
    const line = text.split('\n', 1)[0].trim();
    return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || isSending || conversation.isRunning) {
      return;
    }

    isSending = true;
    isAtBottom = true;
    const assetIds = [...contextAssetIds];

    let sessionId = conversation.sessionId;
    if (!sessionId) {
      try {
        const session = await createAgentSession({
          agentSessionCreateDto: { title: toTitle(text), autoApprove: autoApproveNewChat },
        });
        upsertSession(session);
        conversation.reset(session.id);
        sessionId = session.id;
        syncUrl(session.id);
      } catch (error) {
        handleError(error, $t('errors.unable_to_create_assistant_chat'));
        isSending = false;
        return;
      }
    }

    const localId = conversation.addOptimistic(text, assetIds);
    draft = '';
    contextAssetIds = [];
    conversation.status = 'running';

    try {
      await sendAgentPrompt({
        id: sessionId,
        agentPromptDto: { text, assetIds: assetIds.length > 0 ? assetIds : undefined },
      });
    } catch (error) {
      conversation.removeOptimistic(localId);
      conversation.status = 'idle';
      draft = text;
      contextAssetIds = assetIds;
      handleError(error, $t('errors.unable_to_send_assistant_message'));
    } finally {
      isSending = false;
    }
  };

  const stop = async () => {
    if (!conversation.sessionId) {
      return;
    }
    try {
      await cancelAgentSession({ id: conversation.sessionId });
    } catch (error) {
      handleError(error, $t('errors.unable_to_stop_assistant'));
    }
  };

  const respondToPermission = async (
    message: ChatMessage,
    { approved, optionId }: AgentPermissionResponseDto & { approved: boolean },
  ) => {
    const sessionId = conversation.sessionId;
    const requestId = message.content.requestId;
    if (!sessionId || !requestId) {
      return;
    }

    const previous = (message.content.status ?? 'pending') as AgentPermissionStatus;
    conversation.setPermissionStatus(requestId, approved ? 'approved' : 'denied');
    if (optionId === 'allow_always' && activeSession) {
      upsertSession({ ...activeSession, autoApprove: true });
    }

    try {
      await respondToAgentPermission({
        id: sessionId,
        requestId,
        agentPermissionResponseDto: optionId ? { optionId, approved } : { approved },
      });
    } catch (error) {
      conversation.setPermissionStatus(requestId, previous);
      handleError(error, $t('errors.unable_to_respond_to_assistant_permission'));
    }
  };

  const setAutoApprove = async (checked: boolean) => {
    if (!activeSession) {
      autoApproveNewChat = checked;
      return;
    }

    const previous = activeSession;
    upsertSession({ ...previous, autoApprove: checked });
    try {
      upsertSession(await updateAgentSession({ id: previous.id, agentSessionUpdateDto: { autoApprove: checked } }));
    } catch (error) {
      upsertSession(previous);
      handleError(error, $t('errors.unable_to_update_assistant_chat'));
    }
  };

  const deleteSession = async (session: AgentSessionResponseDto) => {
    const confirmed = await modalManager.showDialog({
      title: $t('assistant_delete_chat'),
      prompt: $t('assistant_delete_chat_prompt', { values: { title: session.title || $t('assistant_untitled_chat') } }),
      confirmText: $t('delete'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }

    try {
      await deleteAgentSession({ id: session.id });
      sessions = sessions.filter(({ id }) => id !== session.id);
      if (conversation.sessionId === session.id) {
        await newChat();
      }
      toastManager.primary($t('assistant_chat_deleted'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_assistant_chat'));
    }
  };

  const pickExample = async (prompt: string) => {
    draft = prompt;
    await focusInput();
  };

  const onAgentUpdate = (update: AgentUpdateDto) => {
    const index = sessions.findIndex(({ id }) => id === update.sessionId);
    if (index === -1) {
      void refreshSessions();
    } else {
      const session = sessions[index];
      const wasRunning = session.status === 'running';
      sessions[index] = {
        ...session,
        status: update.status,
        updatedAt:
          update.message?.createdAt && update.message.createdAt > session.updatedAt
            ? update.message.createdAt
            : session.updatedAt,
      };
      if (wasRunning && update.status !== 'running') {
        // pick up server-side changes such as a generated title
        void refreshSessions();
      }
    }

    conversation.applyUpdate(update);
  };

  const onWebsocketConnect = () => {
    if (!data.enabled) {
      return;
    }
    void refreshSessions();
    if (conversation.sessionId) {
      void loadSession(conversation.sessionId);
    }
  };

  onMount(() => {
    if (data.loadError) {
      handleError(data.loadError, $t('errors.unable_to_load_assistant_chats'));
    }

    if (data.sessionId && data.enabled) {
      void selectSession({ id: data.sessionId });
    } else {
      // drop consumed ?assetIds= / ?prompt= parameters so a reload does not attach them again
      syncUrl();
      void focusInput();
    }

    return websocketEvents.on('on_agent_update', onAgentUpdate);
  });
</script>

<OnEvents {onWebsocketConnect} />

<UserPageLayout title={data.meta.title} scrollbar={false}>
  {#snippet buttons()}
    {#if data.enabled}
      <div class="flex items-center gap-1">
        <label
          class="me-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
          title={$t('assistant_auto_approve_description')}
        >
          <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
          <span class="hidden sm:inline">{$t('assistant_auto_approve')}</span>
        </label>
        <Button
          class="md:hidden"
          variant="ghost"
          size="small"
          color="secondary"
          leadingIcon={mdiForumOutline}
          aria-expanded={showSessions}
          aria-controls="assistant-sessions"
          onclick={() => (showSessions = !showSessions)}
        >
          {$t('assistant_chats')}
        </Button>
        <Button variant="ghost" size="small" color="secondary" leadingIcon={mdiPlus} onclick={newChat}>
          {$t('assistant_new_chat')}
        </Button>
      </div>
    {/if}
  {/snippet}

  {#if !data.enabled}
    <div class="mx-auto mt-10 max-w-xl px-4">
      <Alert color="info" title={$t('assistant_disabled_title')}>
        <p class="text-sm">{$t('assistant_disabled_description')}</p>
      </Alert>
    </div>
  {:else}
    <div class="relative -m-2 flex h-[calc(100%+(--spacing(4)))] min-h-0">
      <aside
        id="assistant-sessions"
        class="{showSessions
          ? 'flex'
          : 'hidden'} absolute inset-0 z-10 w-full flex-col border-e border-gray-200 bg-light md:static md:flex md:w-72 md:shrink-0 dark:border-gray-700"
      >
        <AssistantSessionList
          sessions={sortedSessions}
          activeId={conversation.sessionId}
          onSelect={selectSession}
          onNew={newChat}
          onDelete={deleteSession}
        />
      </aside>

      <section class="relative flex min-w-0 flex-1 flex-col" aria-label={$t('assistant_conversation')}>
        <div bind:this={scroller} onscroll={onScroll} class="min-h-0 flex-1 immich-scrollbar overflow-y-auto">
          <div
            class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6"
            role="log"
            aria-live="polite"
            aria-busy={conversation.isRunning}
          >
            {#if isLoadingSession}
              <div class="flex justify-center py-10"><LoadingSpinner size="large" /></div>
            {:else if conversation.isEmpty}
              <AssistantEmptyState hasContext={contextAssetIds.length > 0} onPick={pickExample} />
            {:else}
              {#each conversation.messages as message (message.id)}
                <AssistantMessage {message} onPermission={respondToPermission} />
              {/each}
            {/if}

            {#if showWorking}
              <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <LoadingSpinner size="small" />
                <span>{$t('assistant_working')}</span>
              </div>
            {/if}
          </div>
        </div>

        {#if !isAtBottom}
          <div class="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center">
            <IconButton
              class="pointer-events-auto shadow-md"
              shape="round"
              color="secondary"
              icon={mdiArrowDown}
              aria-label={$t('assistant_jump_to_latest')}
              title={$t('assistant_jump_to_latest')}
              onclick={() => {
                isAtBottom = true;
                void scrollToBottom('smooth');
              }}
            />
          </div>
        {/if}

        <div class="mx-auto w-full max-w-3xl">
          <AssistantComposer
            bind:value={draft}
            bind:contextAssetIds
            bind:textarea
            running={conversation.isRunning}
            sending={isSending}
            disabled={isLoadingSession}
            onSend={send}
            onStop={stop}
          />
        </div>
      </section>
    </div>
  {/if}
</UserPageLayout>

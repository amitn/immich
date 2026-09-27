<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import AssistantMarkdown from '$lib/components/assistant/AssistantMarkdown.svelte';
  import { AgentConversation } from '$lib/managers/agent-conversation.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { websocketEvents } from '$lib/stores/websocket';
  import { parseAnswer } from '$lib/utils/ask-library';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AgentMessageKind,
    AgentMessageRole,
    cancelAgentSession,
    createAgentSession,
    promptAgentSession,
    updateMyPreferences,
    type AgentUpdateDto,
  } from '@immich/sdk';
  import { Button, Icon, IconButton, LoadingSpinner, Text } from '@immich/ui';
  import { mdiClose, mdiCreationOutline, mdiForumOutline, mdiStop, mdiTagOutline } from '@mdi/js';
  import { onDestroy, untrack } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    /** a question typed in the search bar */
    question: string;
  };

  const { question }: Props = $props();

  const enabled = $derived(featureFlagsManager.value.assistant && (authManager.preferences.aiAnswers?.enabled ?? true));

  let conversation = $state<AgentConversation>();
  let starting = $state(false);
  let failed = $state<string>();
  let stopped = $state(false);
  let unsubscribe: (() => void) | undefined;
  let run = 0;

  const agentTexts = $derived(
    (conversation?.messages ?? []).filter(
      (message) => message.role === AgentMessageRole.Agent && message.kind === AgentMessageKind.Text,
    ),
  );
  const error = $derived(
    (conversation?.messages ?? []).findLast((message) => message.kind === AgentMessageKind.Error)?.content.text,
  );
  // the last text of the assistant is its answer; what it said before looking things up is left out
  const answer = $derived(parseAnswer(agentTexts.at(-1)?.content.text));
  const running = $derived(starting || !!conversation?.isRunning);
  const phase = $derived.by(() => {
    if (failed || error) {
      return 'error';
    }
    if (answer.text) {
      return running ? 'streaming' : 'answer';
    }
    if (running) {
      return 'loading';
    }
    return stopped ? 'stopped' : 'empty';
  });

  const stop = async () => {
    const sessionId = conversation?.sessionId;
    stopped = true;
    if (sessionId && running) {
      try {
        await cancelAgentSession({ id: sessionId });
      } catch {
        // the answer was done or the session is gone
      }
    }
  };

  const start = async (text: string) => {
    const current = ++run;
    const previous = conversation;
    if (previous?.sessionId && previous.isRunning) {
      void cancelAgentSession({ id: previous.sessionId }).catch(() => {});
    }

    failed = undefined;
    stopped = false;
    starting = true;
    const next = new AgentConversation();
    conversation = next;
    try {
      const session = await createAgentSession({ agentSessionCreateDto: { title: text } });
      if (current !== run) {
        void cancelAgentSession({ id: session.id }).catch(() => {});
        return;
      }
      next.reset(session.id);
      await promptAgentSession({ id: session.id, agentPromptDto: { text, answer: true } });
    } catch (error_) {
      if (current === run) {
        failed = $t('errors.unable_to_answer');
        handleError(error_, $t('errors.unable_to_answer'), { notify: false });
      }
    } finally {
      if (current === run) {
        starting = false;
      }
    }
  };

  const onAgentUpdate = (update: AgentUpdateDto) => {
    conversation?.applyUpdate(update);
  };

  const turnOff = async () => {
    await stop();
    try {
      const preferences = await updateMyPreferences({ userPreferencesUpdateDto: { aiAnswers: { enabled: false } } });
      authManager.setPreferences(preferences);
    } catch (error_) {
      handleError(error_, $t('errors.unable_to_update_settings'));
    }
  };

  $effect(() => {
    if (!enabled) {
      return;
    }
    const text = question;
    untrack(() => {
      unsubscribe ??= websocketEvents.on('on_agent_update', onAgentUpdate);
      void start(text);
    });
  });

  onDestroy(() => {
    run++;
    unsubscribe?.();
    const sessionId = conversation?.sessionId;
    if (sessionId && conversation?.isRunning) {
      void cancelAgentSession({ id: sessionId }).catch(() => {});
    }
  });
</script>

{#if enabled}
  <aside
    class="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-light p-4 dark:border-gray-700"
    aria-label={$t('ai_answer')}
    aria-busy={running}
    data-testid="ask-library-panel"
    data-state={phase}
  >
    <div class="flex items-center gap-2">
      <Icon icon={mdiCreationOutline} size="18" class="text-primary" aria-hidden />
      <Text size="small" fontWeight="semi-bold" class="flex-1">{$t('ai_answer')}</Text>
      {#if running}
        <Button size="tiny" variant="ghost" color="secondary" leadingIcon={mdiStop} onclick={stop}>
          {$t('stop')}
        </Button>
      {/if}
      <IconButton
        size="tiny"
        variant="ghost"
        shape="round"
        color="secondary"
        icon={mdiClose}
        aria-label={$t('ai_answers_turn_off')}
        title={$t('ai_answers_turn_off')}
        onclick={turnOff}
      />
    </div>

    {#if phase === 'loading'}
      <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300" role="status">
        <LoadingSpinner size="small" />
        {$t('ai_answer_thinking')}
      </div>
    {:else if phase === 'error'}
      <Text size="small" color="danger">{error || failed}</Text>
    {:else if phase === 'stopped'}
      <Text size="small" color="muted">{$t('ai_answer_stopped')}</Text>
    {:else if phase === 'streaming' || phase === 'answer'}
      <AssistantMarkdown text={answer.text} class="text-sm/6" />
      {#if phase === 'answer' && answer.photoIds.length > 0}
        <AssistantAssetStrip assetIds={answer.photoIds} size="small" limit={6} />
      {/if}
      {#if phase === 'answer' && answer.tags.length > 0}
        <ul class="flex flex-wrap gap-1.5" aria-label={$t('ai_answer_tags')}>
          {#each answer.tags as tag (tag)}
            <li>
              <a
                href={Route.tags({ path: tag })}
                class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20"
              >
                <Icon icon={mdiTagOutline} size="14" aria-hidden />
                {tag}
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if conversation?.sessionId && !running}
      <a
        href={Route.assistant({ sessionId: conversation.sessionId })}
        class="inline-flex items-center gap-1 self-start text-xs text-primary hover:underline"
      >
        <Icon icon={mdiForumOutline} size="14" aria-hidden />
        {$t('ai_answer_continue')}
      </a>
    {/if}
  </aside>
{/if}

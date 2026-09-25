import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { getAgentSessions } from '$lib/services/assistant-api';
import { getAssistantUrlContext } from '$lib/services/assistant.service';
import type { AgentSessionResponseDto } from '$lib/types/assistant';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  // feature flags are initialized by the root layout
  await parent();
  await authenticate(url);
  const $t = await getFormatter();

  const enabled = featureFlagsManager.value.assistant;

  let sessions: AgentSessionResponseDto[] = [];
  let loadError: unknown;
  if (enabled) {
    try {
      sessions = await getAgentSessions();
    } catch (error) {
      loadError = error;
    }
  }

  return {
    enabled,
    sessions,
    loadError,
    sessionId: url.searchParams.get('session') ?? undefined,
    context: getAssistantUrlContext(url),
    meta: {
      title: $t('assistant'),
    },
  };
}) satisfies PageLoad;

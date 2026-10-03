import type { WorkflowResponseDto } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import { mdiCreationOutline, mdiTextBoxOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import WorkflowExplainModal from '$lib/modals/WorkflowExplainModal.svelte';
import { openAssistant } from '$lib/services/assistant.service';

/** Smart albums in plain words (#11): the assistant's entry points on the Workflows page */
export const getWorkflowsAssistantActions = ($t: MessageFormatter) => {
  const Describe: ActionItem = {
    title: $t('workflow_describe'),
    icon: mdiCreationOutline,
    $if: () => !!featureFlagsManager.valueOrUndefined?.assistant,
    onAction: () => openAssistant({ prompt: $t('workflow_describe_prompt') }),
  };

  return { Describe };
};

export const getWorkflowAssistantActions = ($t: MessageFormatter, workflow: WorkflowResponseDto) => {
  const Explain: ActionItem = {
    title: $t('workflow_explain'),
    icon: mdiTextBoxOutline,
    $if: () => !!featureFlagsManager.valueOrUndefined?.assistant,
    onAction: () => modalManager.show(WorkflowExplainModal, { workflow }),
  };

  return { Explain };
};

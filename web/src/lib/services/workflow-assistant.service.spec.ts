import type { WorkflowResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import WorkflowExplainModal from '$lib/modals/WorkflowExplainModal.svelte';
import { getWorkflowAssistantActions, getWorkflowsAssistantActions } from '$lib/services/workflow-assistant.service';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { flags } = vi.hoisted(() => ({ flags: { assistant: true } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { valueOrUndefined: flags, value: flags } as never,
}));

vi.mock(import('$lib/modals/WorkflowExplainModal.svelte'), () => ({ default: vi.fn() as never }));

const $t = ((key: string) => key) as unknown as MessageFormatter;

const workflow = { id: 'workflow-1', name: 'Italian food', steps: [] } as unknown as WorkflowResponseDto;

describe('workflow assistant actions (#11)', () => {
  beforeEach(() => {
    flags.assistant = true;
    vi.mocked(goto).mockReset();
  });

  it('should open the assistant to describe a workflow', async () => {
    const { Describe } = getWorkflowsAssistantActions($t);
    expect(Describe.$if?.()).toBe(true);

    await Describe.onAction(Describe);

    expect(goto).toHaveBeenCalledWith('/assistant?prompt=workflow_describe_prompt');
  });

  it('should explain a workflow in plain words', async () => {
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    const { Explain } = getWorkflowAssistantActions($t, workflow);
    expect(Explain.$if?.()).toBe(true);

    await Explain.onAction(Explain);

    expect(show).toHaveBeenCalledWith(WorkflowExplainModal, { workflow });
  });

  it('should hide both without the assistant', () => {
    flags.assistant = false;
    expect(getWorkflowsAssistantActions($t).Describe.$if?.()).toBe(false);
    expect(getWorkflowAssistantActions($t, workflow).Explain.$if?.()).toBe(false);
  });
});

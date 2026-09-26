import { screen } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import AgentSettings from './AgentSettings.svelte';

const agent = vi.hoisted(() => ({
  enabled: true,
  chatProfile: 'claude',
  artProfile: '',
  maxConcurrentSessions: 2,
  idleTimeoutMinutes: 30,
  autoApproveWrites: false,
  mcpUrl: '',
  profiles: [{ name: 'claude', command: 'claude-agent-acp', args: [], env: [], passEnv: [] }],
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: { configFile: false } } as never,
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    value: { agent: structuredClone(agent) },
    cloneValue: () => ({ agent: structuredClone(agent) }),
  } as never,
}));

describe('AgentSettings component', () => {
  it('should describe the profile inputs with help text below them', () => {
    renderWithTooltips(AgentSettings, {});

    for (const key of ['agent_command', 'agent_args', 'agent_pass_env']) {
      const input = screen.getByRole('textbox', { name: `admin.${key}` });
      const help = screen.getByText(`admin.${key}_description`);
      expect(input).toHaveAccessibleDescription(`admin.${key}_description`);
      expect(input.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

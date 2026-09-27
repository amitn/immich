import {
  AgentMessageKind,
  AgentMessageRole,
  AgentSessionStatus,
  type AgentSessionResponseDto,
  type AgentUpdateDto,
} from '@immich/sdk';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { renderWithTooltips } from '$tests/helpers';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import AskLibraryPanel from './AskLibraryPanel.svelte';

const websocket = vi.hoisted(() => ({ handlers: [] as Array<(update: AgentUpdateDto) => void> }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: {} } as never,
}));
vi.mock('$lib/stores/websocket', () => ({
  websocketEvents: {
    on: (_event: string, handler: (update: AgentUpdateDto) => void) => {
      websocket.handlers.push(handler);
      return () => {
        websocket.handlers = websocket.handlers.filter((item) => item !== handler);
      };
    },
  },
}));

const PHOTO = '1f0c3f2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

const session: AgentSessionResponseDto = {
  id: 'session-1',
  title: 'what did we eat at noma',
  profile: 'claude',
  status: AgentSessionStatus.Idle,
  autoApprove: false,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
};

const send = (status: AgentSessionStatus, text?: string, kind = AgentMessageKind.Text) => {
  for (const handler of websocket.handlers) {
    handler({
      sessionId: session.id,
      status,
      ...(text !== undefined && {
        message: {
          id: 'answer-1',
          sessionId: session.id,
          role: AgentMessageRole.Agent,
          kind,
          content: { text },
          createdAt: '2026-09-27T10:00:01.000Z',
        },
      }),
    });
  }
};

describe('AskLibraryPanel component', () => {
  const question = 'what did we eat at noma';
  const panel = () => screen.queryByTestId('ask-library-panel');

  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    websocket.handlers = [];
    featureFlagsManager.value.assistant = true;
    authManager.setPreferences(preferencesFactory.build({ aiAnswers: { enabled: true } }));
    sdkMock.createAgentSession.mockResolvedValue(session);
    sdkMock.promptAgentSession.mockResolvedValue(undefined as never);
    sdkMock.cancelAgentSession.mockResolvedValue(undefined as never);
  });

  it('should ask the assistant for a short answer and show that it is looking', async () => {
    renderWithTooltips(AskLibraryPanel, { question });

    await waitFor(() => expect(sdkMock.promptAgentSession).toHaveBeenCalled());
    expect(sdkMock.createAgentSession).toHaveBeenCalledWith({ agentSessionCreateDto: { title: question } });
    expect(sdkMock.promptAgentSession).toHaveBeenCalledWith({
      id: session.id,
      agentPromptDto: { text: question, answer: true },
    });
    send(AgentSessionStatus.Running);
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'loading'));
    expect(screen.getByText('ai_answer_thinking')).toBeInTheDocument();
  });

  it('should stream the answer, then cite its photos and tags', async () => {
    renderWithTooltips(AskLibraryPanel, { question });
    await waitFor(() => expect(sdkMock.promptAgentSession).toHaveBeenCalled());

    send(AgentSessionStatus.Running, 'You had eight dishes');
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'streaming'));
    expect(screen.getByText('You had eight dishes')).toBeInTheDocument();

    send(
      AgentSessionStatus.Idle,
      `You had eight dishes at Noma Australia on 24 March 2016.\nSources: photos ${PHOTO}; tags Food/Noma Australia`,
    );
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'answer'));
    expect(screen.getByText('You had eight dishes at Noma Australia on 24 March 2016.')).toBeInTheDocument();
    expect(screen.queryByText(/Sources:/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Food/Noma Australia' })).toHaveAttribute(
      'href',
      '/tags?path=Food%2FNoma%20Australia',
    );
    expect(screen.getByRole('link', { name: 'assistant_open_photo' })).toHaveAttribute('href', `/photos/${PHOTO}`);
    expect(screen.getByRole('link', { name: 'ai_answer_continue' })).toHaveAttribute(
      'href',
      expect.stringContaining(session.id),
    );
  });

  it('should show why there is no answer', async () => {
    renderWithTooltips(AskLibraryPanel, { question });
    await waitFor(() => expect(sdkMock.promptAgentSession).toHaveBeenCalled());
    send(AgentSessionStatus.Idle, 'The agent is not installed', AgentMessageKind.Error);
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'));
    expect(screen.getByText('The agent is not installed')).toBeInTheDocument();
  });

  it('should stop the answer', async () => {
    renderWithTooltips(AskLibraryPanel, { question });
    await waitFor(() => expect(sdkMock.promptAgentSession).toHaveBeenCalled());
    send(AgentSessionStatus.Running);

    await fireEvent.click(await screen.findByRole('button', { name: 'stop' }));

    expect(sdkMock.cancelAgentSession).toHaveBeenCalledWith({ id: session.id });
  });

  it('should turn answers off for the user', async () => {
    sdkMock.updateMyPreferences.mockResolvedValue(preferencesFactory.build({ aiAnswers: { enabled: false } }));
    renderWithTooltips(AskLibraryPanel, { question });
    await waitFor(() => expect(sdkMock.promptAgentSession).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole('button', { name: 'ai_answers_turn_off' }));

    await waitFor(() => expect(panel()).not.toBeInTheDocument());
    expect(sdkMock.updateMyPreferences).toHaveBeenCalledWith({
      userPreferencesUpdateDto: { aiAnswers: { enabled: false } },
    });
  });

  it('should not ask the assistant when the user turned answers off', () => {
    authManager.setPreferences(preferencesFactory.build({ aiAnswers: { enabled: false } }));
    renderWithTooltips(AskLibraryPanel, { question });
    expect(panel()).not.toBeInTheDocument();
    expect(sdkMock.createAgentSession).not.toHaveBeenCalled();
  });

  it('should not ask the assistant when it is disabled', () => {
    featureFlagsManager.value.assistant = false;
    renderWithTooltips(AskLibraryPanel, { question });
    expect(panel()).not.toBeInTheDocument();
    expect(sdkMock.createAgentSession).not.toHaveBeenCalled();
  });

  it('should say when the answer could not be asked', async () => {
    sdkMock.createAgentSession.mockRejectedValue(new Error('Too many assistant sessions'));
    renderWithTooltips(AskLibraryPanel, { question });
    await waitFor(() => expect(panel()).toHaveAttribute('data-state', 'error'));
    expect(screen.getByText('errors.unable_to_answer')).toBeInTheDocument();
  });
});

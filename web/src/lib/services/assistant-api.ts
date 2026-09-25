// TODO: replace with @immich/sdk once the open-api spec is regenerated
//
// Adapter for the /api/agent endpoints. The function signatures follow the shape the generated
// SDK uses (a single object argument named after the DTO), so components keep working when the
// implementation below is replaced with re-exports from @immich/sdk.
import { adapterRequest } from '$lib/services/api-adapter';
import type {
  AgentPermissionResponseDto,
  AgentPromptDto,
  AgentSessionCreateDto,
  AgentSessionDetailResponseDto,
  AgentSessionResponseDto,
} from '$lib/types/assistant';

export const createAgentSession = ({ agentSessionCreateDto }: { agentSessionCreateDto: AgentSessionCreateDto }) =>
  adapterRequest<AgentSessionResponseDto>('/agent/sessions', { method: 'POST', body: agentSessionCreateDto });

export const getAgentSessions = () => adapterRequest<AgentSessionResponseDto[]>('/agent/sessions');

export const getAgentSession = ({ id }: { id: string }) =>
  adapterRequest<AgentSessionDetailResponseDto>(`/agent/sessions/${id}`);

export const deleteAgentSession = ({ id }: { id: string }) =>
  adapterRequest(`/agent/sessions/${id}`, { method: 'DELETE' });

export const sendAgentPrompt = ({ id, agentPromptDto }: { id: string; agentPromptDto: AgentPromptDto }) =>
  adapterRequest(`/agent/sessions/${id}/prompt`, { method: 'POST', body: agentPromptDto });

export const cancelAgentSession = ({ id }: { id: string }) =>
  adapterRequest(`/agent/sessions/${id}/cancel`, { method: 'POST' });

export const respondToAgentPermission = ({
  id,
  requestId,
  agentPermissionResponseDto,
}: {
  id: string;
  requestId: string;
  agentPermissionResponseDto: AgentPermissionResponseDto;
}) =>
  adapterRequest(`/agent/sessions/${id}/permissions/${requestId}`, {
    method: 'POST',
    body: agentPermissionResponseDto,
  });

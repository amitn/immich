import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// The chats of the AI assistant (`/agent/sessions`)
class AssistantApiRepository extends ApiRepository {
  final ApiService _apiService;

  AssistantApiRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  AssistantApi get _api => AssistantApi(_apiService.serverInfoApi.apiClient);

  /// The chats, with the most recently active first
  Future<List<AgentSessionResponseDto>> getSessions() async {
    final sessions = await checkNull(_api.getAgentSessions());
    return [...sessions]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  Future<AgentSessionDetailResponseDto> getSession(String id) => checkNull(_api.getAgentSession(id));

  Future<AgentSessionResponseDto> createSession({String? title, bool autoApprove = false}) => checkNull(
    _api.createAgentSession(
      AgentSessionCreateDto(
        title: title == null ? const Optional.absent() : Optional.present(title),
        autoApprove: Optional.present(autoApprove),
      ),
    ),
  );

  Future<AgentSessionResponseDto> setAutoApprove(String id, bool autoApprove) =>
      checkNull(_api.updateAgentSession(id, AgentSessionUpdateDto(autoApprove: Optional.present(autoApprove))));

  Future<void> deleteSession(String id) => _api.deleteAgentSession(id);

  /// Sends a message; the replies arrive over the websocket (`on_agent_update`)
  Future<void> prompt(String id, String text, {List<String> assetIds = const []}) => _api.promptAgentSession(
    id,
    AgentPromptDto(text: text, assetIds: assetIds.isEmpty ? const Optional.absent() : Optional.present(assetIds)),
  );

  /// Stops the running turn of a chat
  Future<void> cancel(String id) => _api.cancelAgentSession(id);

  /// Answers a permission request with one of its options, or with a plain yes or no when it has none
  Future<void> respond(String id, String requestId, {String? optionId, required bool approved}) =>
      _api.respondToAgentPermission(
        id,
        requestId,
        AgentPermissionResponseDto(
          optionId: optionId == null ? const Optional.absent() : Optional.present(optionId),
          approved: Optional.present(approved),
        ),
      );
}

final assistantApiRepositoryProvider = Provider<AssistantApiRepository>(
  (ref) => AssistantApiRepository(ref.watch(apiServiceProvider)),
);

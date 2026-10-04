import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// The assistant routines (`/routines`): the inbox of changes waiting for approval, and the runs
class RoutineApiRepository extends ApiRepository {
  final ApiService _apiService;

  RoutineApiRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  AssistantApi get _api => AssistantApi(_apiService.serverInfoApi.apiClient);

  /// The changes of routine runs that wait for approval, the oldest first
  Future<List<RoutineApprovalResponseDto>> getInbox() => checkNull(_api.getRoutineInbox());

  /// Approves (applies) or denies changes: [ids], or every pending change of [runId]
  Future<RoutineApprovalDecisionResponseDto> decide({
    List<String> ids = const [],
    String? runId,
    required bool approve,
  }) => checkNull(
    _api.decideRoutineApprovals(
      RoutineApprovalDecisionDto(
        approve: approve,
        ids: ids.isEmpty ? const Optional.absent() : Optional.present(ids),
        runId: runId == null ? const Optional.absent() : Optional.present(runId),
      ),
    ),
  );

  /// A run with its transcript and its changes
  Future<RoutineRunDetailResponseDto> getRun(String id) => checkNull(_api.getRoutineRun(id));
}

final routineApiRepositoryProvider = Provider<RoutineApiRepository>(
  (ref) => RoutineApiRepository(ref.watch(apiServiceProvider)),
);

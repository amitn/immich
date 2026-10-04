import 'package:openapi/api.dart';

RoutineApprovalResponseDto routineChange(
  String id, {
  String runId = 'run-1',
  String routineName = 'Name dishes',
  String title = 'Save names',
  String summary = '3 dishes at Trattoria',
  String status = 'pending',
  List<String> assetIds = const ['asset-1'],
  String? result,
}) => RoutineApprovalResponseDto.fromJson({
  'id': id,
  'runId': runId,
  'routineId': 'routine-1',
  'routineName': routineName,
  'toolName': 'save_entries',
  'title': title,
  'summary': summary,
  'input': {'pack': 'food'},
  'assetIds': assetIds,
  'status': status,
  'result': result,
  'activityIds': <String>[],
  'expiresAt': '2026-10-10T10:00:00.000Z',
  'decidedAt': null,
  'createdAt': '2026-10-03T10:00:00.000Z',
})!;

RoutineApprovalDecisionResponseDto routineDecision(
  List<RoutineApprovalResponseDto> results, {
  int applied = 0,
  int denied = 0,
  int failed = 0,
}) =>
    RoutineApprovalDecisionResponseDto(results: results, applied: applied, denied: denied, failed: failed, skipped: 0);

RoutineRunDetailResponseDto routineRun(
  String id, {
  String status = 'succeeded',
  String? summary = 'Named **3 dishes**; 2 changes wait for you.',
  List<RoutineApprovalResponseDto> approvals = const [],
  String approvalMode = 'ask',
}) => RoutineRunDetailResponseDto.fromJson({
  'id': id,
  'routineId': 'routine-1',
  'routineName': 'Name dishes',
  'sessionId': 'session-1',
  'trigger': 'schedule',
  'approvalMode': approvalMode,
  'status': status,
  'assetIds': ['asset-1'],
  'moreAssets': 0,
  'events': <Object?>[],
  'summary': summary,
  'error': null,
  'toolCalls': 4,
  'changes': 1,
  'pendingApprovals': approvals.where((change) => change.status == RoutineApprovalStatus.pending).length,
  'startedAt': '2026-10-03T10:00:00.000Z',
  'finishedAt': '2026-10-03T10:02:00.000Z',
  'createdAt': '2026-10-03T10:00:00.000Z',
  'messages': [
    {
      'id': 'm-1',
      'sessionId': 'session-1',
      'role': 'agent',
      'kind': 'text',
      'content': {'text': 'I read the menu of Trattoria and matched 3 dishes.'},
      'createdAt': '2026-10-03T10:01:00.000Z',
    },
  ],
  'approvals': [for (final change in approvals) change.toJson()],
})!;

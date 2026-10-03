import 'package:openapi/api.dart';

const photoA = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const photoB = '1b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const albumId = '2b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';

int _clock = 0;

/// A timestamp a second later than the one before, so messages keep their order
String nextTimestamp() => DateTime.utc(2026, 9, 1, 10).add(Duration(seconds: ++_clock)).toIso8601String();

AgentSessionResponseDto session(
  String id, {
  String? title,
  String status = 'idle',
  bool autoApprove = false,
  DateTime? updatedAt,
}) => AgentSessionResponseDto.fromJson({
  'id': id,
  'title': title,
  'profile': 'claude',
  'status': status,
  'autoApprove': autoApprove,
  'createdAt': '2026-09-01T09:00:00.000Z',
  'updatedAt': (updatedAt ?? DateTime.utc(2026, 9, 1, 10)).toIso8601String(),
})!;

Map<String, Object?> messageJson(
  String id, {
  String sessionId = 'session-1',
  String role = 'agent',
  String kind = 'text',
  Map<String, Object?> content = const {},
  String? createdAt,
}) => {
  'id': id,
  'sessionId': sessionId,
  'role': role,
  'kind': kind,
  'content': content,
  'createdAt': createdAt ?? nextTimestamp(),
};

AgentMessageDto message(
  String id, {
  String sessionId = 'session-1',
  String role = 'agent',
  String kind = 'text',
  Map<String, Object?> content = const {},
}) => AgentMessageDto.fromJson(messageJson(id, sessionId: sessionId, role: role, kind: kind, content: content))!;

/// A permission request with the server's three options
Map<String, Object?> permissionContent({String requestId = 'request-1', String status = 'pending'}) => {
  'requestId': requestId,
  'toolName': 'mcp__immich__create_album',
  'title': 'Create album',
  'summary': 'Create the album "Beach" with 2 photos',
  'status': status,
  'assetIds': [photoA, photoB],
  'options': [
    {'optionId': 'allow', 'name': 'Allow', 'kind': 'allow_once'},
    {'optionId': 'allow_always', 'name': 'Allow all in this chat', 'kind': 'allow_always'},
    {'optionId': 'deny', 'name': 'Deny', 'kind': 'reject_once'},
  ],
};

AgentSessionDetailResponseDto detail(
  String id, {
  String? title,
  String status = 'idle',
  bool autoApprove = false,
  List<Map<String, Object?>> messages = const [],
}) => AgentSessionDetailResponseDto.fromJson({
  'id': id,
  'title': title,
  'profile': 'claude',
  'status': status,
  'autoApprove': autoApprove,
  'createdAt': '2026-09-01T09:00:00.000Z',
  'updatedAt': '2026-09-01T10:00:00.000Z',
  'messages': messages,
})!;

AgentUpdateDto update(String sessionId, String status, {Map<String, Object?>? message}) =>
    AgentUpdateDto.fromJson({'sessionId': sessionId, 'status': status, 'message': ?message})!;

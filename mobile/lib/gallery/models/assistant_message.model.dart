import 'package:openapi/api.dart';

/// `content.status` of a tool call message (a plain string in the API)
abstract final class AssistantToolStatus {
  static const pending = 'pending';
  static const inProgress = 'in_progress';
  static const completed = 'completed';
  static const failed = 'failed';
}

/// `content.status` of a permission message (a plain string in the API)
abstract final class AssistantPermissionStatus {
  static const pending = 'pending';
  static const approved = 'approved';
  static const denied = 'denied';
  static const expired = 'expired';

  static bool isFinal(String? status) => status != null && status != pending;
}

/// What an answer to a permission request does, from its option kind
enum AssistantPermissionChoice {
  /// Allow this one change
  allow,

  /// Allow it and every later change of the chat: turns on the chat's auto-approve
  allowAll,

  deny;

  static AssistantPermissionChoice fromKind(String kind) => switch (kind) {
    'allow_once' => allow,
    'allow_always' => allowAll,
    _ => deny,
  };

  bool get approves => this != deny;
}

class AssistantPermissionOption {
  final String optionId;
  final String name;
  final AssistantPermissionChoice choice;

  const AssistantPermissionOption({required this.optionId, required this.name, required this.choice});

  factory AssistantPermissionOption.fromDto(AgentPermissionOptionDto dto) => AssistantPermissionOption(
    optionId: dto.optionId,
    name: dto.name,
    choice: AssistantPermissionChoice.fromKind(dto.kind.toJson()),
  );
}

class AssistantPlanEntry {
  final String content;
  final String priority;
  final String status;

  const AssistantPlanEntry({required this.content, required this.priority, required this.status});

  bool get isCompleted => status == 'completed';
  bool get isInProgress => status == 'in_progress';
}

/// One message of an assistant chat, flattened from `AgentMessageDto`: which fields are set depends on [kind]
class AssistantMessage {
  final String id;
  final AgentMessageRole role;
  final AgentMessageKind kind;
  final DateTime createdAt;

  /// The text (text, thought and error messages): markdown for the assistant's text
  final String? text;
  final List<String> assetIds;
  final List<String> albumIds;
  final List<String> bookIds;

  /// The tool (tool calls and permissions), e.g. `mcp__immich__create_album`
  final String? toolName;
  final String? title;

  /// Tool call status, or permission status
  final String? status;
  final Object? input;
  final String? output;

  /// What the change would do, for a permission request
  final String? summary;
  final String? requestId;
  final List<AssistantPermissionOption> options;
  final List<AssistantPlanEntry> entries;

  /// An optimistic user message that the server has not confirmed yet
  final bool pending;

  const AssistantMessage({
    required this.id,
    required this.role,
    required this.kind,
    required this.createdAt,
    this.text,
    this.assetIds = const [],
    this.albumIds = const [],
    this.bookIds = const [],
    this.toolName,
    this.title,
    this.status,
    this.input,
    this.output,
    this.summary,
    this.requestId,
    this.options = const [],
    this.entries = const [],
    this.pending = false,
  });

  factory AssistantMessage.fromDto(AgentMessageDto dto) {
    final content = dto.content;
    return AssistantMessage(
      id: dto.id,
      role: dto.role,
      kind: dto.kind,
      createdAt: dto.createdAt,
      text: content.text.orElse(null),
      assetIds: content.assetIds.orElse(null) ?? const [],
      albumIds: content.albumIds.orElse(null) ?? const [],
      bookIds: content.bookIds.orElse(null) ?? const [],
      toolName: content.toolName.orElse(null),
      title: content.title.orElse(null),
      status: content.status.orElse(null),
      input: content.input.orElse(null),
      output: content.output.orElse(null),
      summary: content.summary.orElse(null),
      requestId: content.requestId.orElse(null),
      options: (content.options.orElse(null) ?? const []).map(AssistantPermissionOption.fromDto).toList(),
      entries: (content.entries.orElse(null) ?? const [])
          .map((entry) => AssistantPlanEntry(content: entry.content, priority: entry.priority, status: entry.status))
          .toList(),
    );
  }

  /// The user's message, shown before the server confirms it
  factory AssistantMessage.optimistic({
    required String id,
    required String sessionText,
    required List<String> assetIds,
    DateTime? now,
  }) => AssistantMessage(
    id: id,
    role: AgentMessageRole.user,
    kind: AgentMessageKind.text,
    createdAt: now ?? DateTime.now(),
    text: sessionText,
    assetIds: assetIds,
    pending: true,
  );

  bool get isUserText => role == AgentMessageRole.user && kind == AgentMessageKind.text;

  /// The tool name without the prefix of the server's MCP tools
  String? get shortToolName => toolName?.replaceFirst(RegExp(r'^mcp__immich__'), '');

  AssistantMessage withStatus(String value) => AssistantMessage(
    id: id,
    role: role,
    kind: kind,
    createdAt: createdAt,
    text: text,
    assetIds: assetIds,
    albumIds: albumIds,
    bookIds: bookIds,
    toolName: toolName,
    title: title,
    status: value,
    input: input,
    output: output,
    summary: summary,
    requestId: requestId,
    options: options,
    entries: entries,
    pending: pending,
  );
}

import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:openapi/api.dart';

/// The pure rules of an assistant chat, the same as the web's `AgentConversation`:
///
/// - server messages are keyed by id, and an update of an id replaces the message in place (streamed text updates
///   the same id again and again);
/// - an optimistic user message shows right away, and the server's copy of it replaces it once it arrives.
abstract final class AssistantConversation {
  static const _titleLength = 80;

  /// The title of a chat from its first message, the same way the server titles an untitled chat
  static String toChatTitle(String text) {
    final title = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    return title.length > _titleLength ? '${title.substring(0, _titleLength)}…' : title;
  }

  static bool _sameAssets(List<String> a, List<String> b) {
    if (a.length != b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) {
        return false;
      }
    }
    return true;
  }

  /// [messages] with [message] added, or replacing the message of the same id, or the optimistic copy of it
  static List<AssistantMessage> upsert(List<AssistantMessage> messages, AssistantMessage message) {
    final index = messages.indexWhere((candidate) => candidate.id == message.id);
    if (index != -1) {
      return [...messages]..[index] = message;
    }

    if (message.isUserText) {
      final text = (message.text ?? '').trim();
      var optimistic = messages.indexWhere(
        (candidate) =>
            candidate.pending &&
            (candidate.text ?? '').trim() == text &&
            _sameAssets(candidate.assetIds, message.assetIds),
      );
      if (optimistic == -1) {
        optimistic = messages.indexWhere((candidate) => candidate.pending);
      }
      if (optimistic != -1) {
        return [...messages]..[optimistic] = message;
      }
    }

    return [...messages, message];
  }

  /// The server's history of a chat, keeping the optimistic messages it does not have yet
  static List<AssistantMessage> load(List<AssistantMessage> current, List<AssistantMessage> history) {
    final result = [...history];
    for (final message in current.where((message) => message.pending)) {
      final confirmed = result.any(
        (candidate) =>
            candidate.isUserText &&
            !candidate.pending &&
            (candidate.text ?? '').trim() == (message.text ?? '').trim() &&
            !candidate.createdAt.isBefore(message.createdAt.subtract(const Duration(minutes: 1))),
      );
      if (!confirmed) {
        result.add(message);
      }
    }
    return result;
  }

  /// Shows a permission as answered until the server confirms it
  static List<AssistantMessage> setPermissionStatus(List<AssistantMessage> messages, String requestId, String status) =>
      [
        for (final message in messages)
          message.kind == AgentMessageKind.permission && message.requestId == requestId
              ? message.withStatus(status)
              : message,
      ];

  /// The permission requests still waiting for an answer
  static List<AssistantMessage> pendingPermissions(List<AssistantMessage> messages) => messages
      .where(
        (message) => message.kind == AgentMessageKind.permission && !AssistantPermissionStatus.isFinal(message.status),
      )
      .toList();

  /// The photos a chat refers to (attached, and those of tool results and replies), lower case: their ids in the
  /// replies show as thumbnails
  static Set<String> assetIds(List<AssistantMessage> messages) => {
    for (final message in messages)
      for (final id in message.assetIds) id.toLowerCase(),
  };

  /// A chat of the chat list after a websocket update of it: the update is its latest activity, and an untitled chat
  /// takes its title from the first message right away (the server sets the same title, but the update lacks it)
  static AgentSessionResponseDto applySessionUpdate(
    AgentSessionResponseDto session,
    AgentUpdateDto update, {
    DateTime? now,
  }) {
    final message = update.message.orElse(null);
    final text = message != null && message.role == AgentMessageRole.user && message.kind == AgentMessageKind.text
        ? message.content.text.orElse(null)
        : null;
    final at = (now ?? DateTime.now()).toUtc();
    return AgentSessionResponseDto(
      id: session.id,
      title: (session.title?.isNotEmpty ?? false) ? session.title : (text != null ? toChatTitle(text) : session.title),
      profile: session.profile,
      status: update.status,
      autoApprove: session.autoApprove,
      createdAt: session.createdAt,
      updatedAt: at.isAfter(session.updatedAt) ? at : session.updatedAt,
    );
  }

  static AgentSessionResponseDto withAutoApprove(AgentSessionResponseDto session, bool autoApprove) =>
      AgentSessionResponseDto(
        id: session.id,
        title: session.title,
        profile: session.profile,
        status: session.status,
        autoApprove: autoApprove,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      );
}

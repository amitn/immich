import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/assistant_api.repository.dart';
import 'package:immich_mobile/gallery/utils/assistant_conversation.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

/// The assistant screen: the chat list, and the open chat
class AssistantState {
  /// The chats, the most recently active first; null until loaded
  final List<AgentSessionResponseDto>? sessions;
  final bool sessionsFailed;

  /// The open chat, or null for a new chat that has no message yet
  final String? sessionId;
  final AgentSessionStatus status;
  final List<AssistantMessage> messages;

  /// The photos attached to the next message
  final List<String> contextAssetIds;

  /// Auto-approve for the new chat, sent when it is created
  final bool autoApproveNewChat;
  final bool isSending;
  final bool isLoadingSession;

  const AssistantState({
    this.sessions,
    this.sessionsFailed = false,
    this.sessionId,
    this.status = AgentSessionStatus.idle,
    this.messages = const [],
    this.contextAssetIds = const [],
    this.autoApproveNewChat = false,
    this.isSending = false,
    this.isLoadingSession = false,
  });

  bool get isRunning => status == AgentSessionStatus.running;

  AgentSessionResponseDto? get session {
    final id = sessionId;
    return id == null ? null : sessions?.where((session) => session.id == id).firstOrNull;
  }

  /// Whether the open chat may change the library without asking
  bool get autoApprove => sessionId == null ? autoApproveNewChat : (session?.autoApprove ?? false);

  /// Shows "Working…" while the assistant has not answered the last message yet
  bool get isWorking => isRunning && (messages.isEmpty || messages.last.role == AgentMessageRole.user);

  AssistantState copyWith({
    List<AgentSessionResponseDto>? sessions,
    bool? sessionsFailed,
    String? Function()? sessionId,
    AgentSessionStatus? status,
    List<AssistantMessage>? messages,
    List<String>? contextAssetIds,
    bool? autoApproveNewChat,
    bool? isSending,
    bool? isLoadingSession,
  }) => AssistantState(
    sessions: sessions ?? this.sessions,
    sessionsFailed: sessionsFailed ?? this.sessionsFailed,
    sessionId: sessionId == null ? this.sessionId : sessionId(),
    status: status ?? this.status,
    messages: messages ?? this.messages,
    contextAssetIds: contextAssetIds ?? this.contextAssetIds,
    autoApproveNewChat: autoApproveNewChat ?? this.autoApproveNewChat,
    isSending: isSending ?? this.isSending,
    isLoadingSession: isLoadingSession ?? this.isLoadingSession,
  );
}

/// Why an action of the assistant screen failed, for the screen's message
enum AssistantFailure { loadChats, loadChat, createChat, send, stop, respond, updateChat, deleteChat }

class AssistantError implements Exception {
  final AssistantFailure failure;
  final Object cause;

  const AssistantError(this.failure, this.cause);

  @override
  String toString() => 'AssistantError($failure, $cause)';
}

class AssistantNotifier extends StateNotifier<AssistantState> {
  static final _log = Logger('AssistantNotifier');

  final AssistantApiRepository _repository;
  StreamSubscription<AgentUpdateDto>? _updates;
  int _localId = 0;

  AssistantNotifier(this._repository, GalleryEventBus bus) : super(const AssistantState()) {
    _updates = bus.agentUpdates.listen(_onUpdate);
  }

  @override
  void dispose() {
    unawaited(_updates?.cancel());
    super.dispose();
  }

  void _upsertSession(AgentSessionResponseDto session) {
    final sessions = [...?state.sessions];
    final index = sessions.indexWhere((candidate) => candidate.id == session.id);
    if (index == -1) {
      sessions.insert(0, session);
    } else {
      sessions[index] = session;
    }
    state = state.copyWith(sessions: sessions);
  }

  Future<void> loadSessions() async {
    try {
      final sessions = await _repository.getSessions();
      if (mounted) {
        state = state.copyWith(sessions: sessions, sessionsFailed: false);
      }
    } catch (error, stackTrace) {
      _log.warning('Unable to load the assistant chats', error, stackTrace);
      if (mounted) {
        state = state.copyWith(sessions: state.sessions ?? const [], sessionsFailed: true);
      }
    }
  }

  /// Opens the screen: an earlier chat, or a new one with [assetIds] attached
  Future<void> start({String? sessionId, List<String> assetIds = const []}) async {
    state = state.copyWith(contextAssetIds: assetIds.toSet().toList());
    unawaited(loadSessions());
    if (sessionId != null) {
      await openSession(sessionId);
    }
  }

  Future<void> openSession(String id) async {
    if (state.sessionId == id && state.messages.isNotEmpty) {
      return;
    }
    state = state.copyWith(
      sessionId: () => id,
      status: AgentSessionStatus.idle,
      messages: const [],
      isLoadingSession: true,
    );
    try {
      final detail = await _repository.getSession(id);
      if (!mounted || state.sessionId != id) {
        return;
      }
      state = state.copyWith(
        status: detail.status,
        messages: AssistantConversation.load(state.messages, detail.messages.map(AssistantMessage.fromDto).toList()),
        isLoadingSession: false,
      );
      _upsertSession(
        AgentSessionResponseDto(
          id: detail.id,
          title: detail.title,
          profile: detail.profile,
          status: detail.status,
          autoApprove: detail.autoApprove,
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
        ),
      );
    } catch (error) {
      if (mounted && state.sessionId == id) {
        state = state.copyWith(sessionId: () => null, isLoadingSession: false);
      }
      throw AssistantError(AssistantFailure.loadChat, error);
    }
  }

  /// Catches up after the websocket was away (the app in the background): the chat list, and the open chat
  Future<void> refresh() async {
    unawaited(loadSessions());
    final id = state.sessionId;
    if (id == null || state.isLoadingSession) {
      return;
    }
    try {
      final detail = await _repository.getSession(id);
      if (mounted && state.sessionId == id) {
        state = state.copyWith(
          status: detail.status,
          messages: AssistantConversation.load(state.messages, detail.messages.map(AssistantMessage.fromDto).toList()),
        );
      }
    } catch (error, stackTrace) {
      _log.warning('Unable to refresh the assistant chat $id', error, stackTrace);
    }
  }

  void newChat() {
    state = state.copyWith(
      sessionId: () => null,
      status: AgentSessionStatus.idle,
      messages: const [],
      isLoadingSession: false,
    );
  }

  void removeContextAsset(String id) {
    state = state.copyWith(contextAssetIds: state.contextAssetIds.where((asset) => asset != id).toList());
  }

  /// Sends [text] with the attached photos, creating the chat first when it is new. Returns false when it was not
  /// sent (an empty text, or a turn still running); throws an [AssistantError] when sending failed, with the text and
  /// photos kept so the user can send them again.
  Future<bool> send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || state.isSending || state.isRunning) {
      return false;
    }

    final assetIds = [...state.contextAssetIds];
    state = state.copyWith(isSending: true);

    var sessionId = state.sessionId;
    if (sessionId == null) {
      try {
        final session = await _repository.createSession(
          title: AssistantConversation.toChatTitle(trimmed),
          autoApprove: state.autoApproveNewChat,
        );
        sessionId = session.id;
        _upsertSession(session);
        state = state.copyWith(sessionId: () => session.id, messages: const [], status: AgentSessionStatus.idle);
      } catch (error) {
        state = state.copyWith(isSending: false);
        throw AssistantError(AssistantFailure.createChat, error);
      }
    }

    final localId = 'local-${++_localId}';
    final previousStatus = state.status;
    state = state.copyWith(
      messages: [
        ...state.messages,
        AssistantMessage.optimistic(id: localId, sessionText: trimmed, assetIds: assetIds),
      ],
      contextAssetIds: const [],
      status: AgentSessionStatus.running,
    );

    try {
      await _repository.prompt(sessionId, trimmed, assetIds: assetIds);
      return true;
    } catch (error) {
      state = state.copyWith(
        messages: state.messages.where((message) => message.id != localId).toList(),
        contextAssetIds: assetIds,
        status: previousStatus == AgentSessionStatus.running ? AgentSessionStatus.idle : previousStatus,
      );
      throw AssistantError(AssistantFailure.send, error);
    } finally {
      if (mounted) {
        state = state.copyWith(isSending: false);
      }
    }
  }

  Future<void> stop() async {
    final id = state.sessionId;
    if (id == null) {
      return;
    }
    try {
      await _repository.cancel(id);
    } catch (error) {
      throw AssistantError(AssistantFailure.stop, error);
    }
  }

  /// Answers a permission request: with [option], or a plain allow or deny when the request has no options
  Future<void> respond(AssistantMessage message, {AssistantPermissionOption? option, bool? approved}) async {
    final sessionId = state.sessionId;
    final requestId = message.requestId;
    if (sessionId == null || requestId == null) {
      return;
    }

    final approves = option?.choice.approves ?? approved ?? false;
    final previous = message.status ?? AssistantPermissionStatus.pending;
    final previousSession = state.session;
    state = state.copyWith(
      messages: AssistantConversation.setPermissionStatus(
        state.messages,
        requestId,
        approves ? AssistantPermissionStatus.approved : AssistantPermissionStatus.denied,
      ),
    );
    if (option?.choice == AssistantPermissionChoice.allowAll && previousSession != null) {
      // the server turns on auto-approve for the rest of the chat
      _upsertSession(AssistantConversation.withAutoApprove(previousSession, true));
    }

    try {
      await _repository.respond(sessionId, requestId, optionId: option?.optionId, approved: approves);
    } catch (error) {
      state = state.copyWith(messages: AssistantConversation.setPermissionStatus(state.messages, requestId, previous));
      if (previousSession != null) {
        _upsertSession(previousSession);
      }
      throw AssistantError(AssistantFailure.respond, error);
    }
  }

  Future<void> setAutoApprove(bool value) async {
    final session = state.session;
    if (state.sessionId == null || session == null) {
      state = state.copyWith(autoApproveNewChat: value);
      return;
    }

    _upsertSession(AssistantConversation.withAutoApprove(session, value));
    try {
      _upsertSession(await _repository.setAutoApprove(session.id, value));
    } catch (error) {
      _upsertSession(session);
      throw AssistantError(AssistantFailure.updateChat, error);
    }
  }

  Future<void> deleteSession(String id) async {
    try {
      await _repository.deleteSession(id);
    } catch (error) {
      throw AssistantError(AssistantFailure.deleteChat, error);
    }
    state = state.copyWith(sessions: [...?state.sessions?.where((session) => session.id != id)]);
    if (state.sessionId == id) {
      newChat();
    }
  }

  void _onUpdate(AgentUpdateDto update) {
    if (!mounted) {
      return;
    }

    final sessions = state.sessions;
    final index = sessions?.indexWhere((session) => session.id == update.sessionId) ?? -1;
    if (sessions != null && index != -1) {
      final session = sessions[index];
      _upsertSession(AssistantConversation.applySessionUpdate(session, update));
      if (session.status == AgentSessionStatus.running && update.status != AgentSessionStatus.running) {
        // pick up changes of the server such as a generated title
        unawaited(loadSessions());
      }
    } else if (sessions != null) {
      unawaited(loadSessions());
    }

    if (update.sessionId != state.sessionId) {
      return;
    }
    final message = update.message.orElse(null);
    state = state.copyWith(
      status: update.status,
      messages: message == null
          ? state.messages
          : AssistantConversation.upsert(state.messages, AssistantMessage.fromDto(message)),
    );
  }
}

/// The state of one assistant screen, by a key of the screen: a chat opened from a book opened from another chat is
/// a chat of its own
final assistantProvider = StateNotifierProvider.autoDispose.family<AssistantNotifier, AssistantState, Object>(
  (ref, _) => AssistantNotifier(ref.watch(assistantApiRepositoryProvider), ref.watch(galleryEventBusProvider)),
);

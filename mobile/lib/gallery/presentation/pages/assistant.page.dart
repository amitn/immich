import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_composer.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_empty_state.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_message.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_permission_card.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_sessions_drawer.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_confirm_dialog.widget.dart';
import 'package:immich_mobile/gallery/providers/assistant.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/utils/assistant_conversation.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/providers/websocket.provider.dart';
import 'package:openapi/api.dart';

/// The AI assistant: a chat that searches the library, makes albums, crops and photo books, and asks before changing
/// anything (unless the chat auto-approves)
@RoutePage()
class AssistantPage extends HookConsumerWidget {
  /// An earlier chat to open
  final String? sessionId;

  /// Photos to attach to the first message of a new chat ("Ask assistant" on a selection)
  final List<String> assetIds;

  /// A prompt to start from, to edit before sending ("Create with assistant")
  final String? prompt;

  const AssistantPage({super.key, this.sessionId, this.assetIds = const [], this.prompt});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(galleryFeaturesProvider.select((features) => features.assistant));
    if (!enabled) {
      return Scaffold(
        appBar: AppBar(title: Text(context.t.assistant)),
        body: const AssistantDisabledState(),
      );
    }
    return _AssistantChat(sessionId: sessionId, assetIds: assetIds, prompt: prompt);
  }
}

class _AssistantChat extends HookConsumerWidget {
  final String? sessionId;
  final List<String> assetIds;
  final String? prompt;

  const _AssistantChat({required this.sessionId, required this.assetIds, required this.prompt});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final screen = useMemoized(Object.new);
    final state = ref.watch(assistantProvider(screen));
    final notifier = ref.read(assistantProvider(screen).notifier);
    final controller = useTextEditingController(text: prompt ?? '');
    final focusNode = useFocusNode();
    final scaffoldKey = useMemoized(GlobalKey<ScaffoldState>.new);
    final t = context.t;

    String failureMessage(AssistantFailure failure) => switch (failure) {
      AssistantFailure.loadChats => t.errors.unable_to_load_assistant_chats,
      AssistantFailure.loadChat => t.errors.unable_to_load_assistant_chat,
      AssistantFailure.createChat => t.errors.unable_to_create_assistant_chat,
      AssistantFailure.send => t.errors.unable_to_send_assistant_message,
      AssistantFailure.stop => t.errors.unable_to_stop_assistant,
      AssistantFailure.respond => t.errors.unable_to_respond_to_assistant_permission,
      AssistantFailure.updateChat => t.errors.unable_to_update_assistant_chat,
      AssistantFailure.deleteChat => t.errors.unable_to_delete_assistant_chat,
    };

    Future<void> guard(Future<void> Function() action) async {
      try {
        await action();
      } on AssistantError catch (error) {
        await ref.read(toastServiceProvider).error(failureMessage(error.failure));
      }
    }

    useEffect(() {
      // after the first build: a provider must not change while the tree builds
      unawaited(Future.microtask(() => guard(() => notifier.start(sessionId: sessionId, assetIds: assetIds))));
      return null;
    }, const []);

    // the replies come over the websocket: when it reconnects, catch up on what it missed
    ref.listen(websocketProvider.select((socket) => socket.isConnected), (previous, connected) {
      if (connected && previous == false) {
        unawaited(notifier.refresh());
      }
    });

    // the text leaves the box while it is sent, and comes back when sending fails
    Future<void> send() => guard(() async {
      final text = controller.text;
      controller.clear();
      try {
        if (!await notifier.send(text)) {
          controller.text = text;
        }
      } on AssistantError {
        controller.text = text;
        rethrow;
      }
    });

    Future<void> respond(AssistantMessage message, AssistantPermissionAnswer answer) =>
        guard(() => notifier.respond(message, option: answer.option, approved: answer.approved));

    Future<void> openSession(AgentSessionResponseDto session) async {
      scaffoldKey.currentState?.closeEndDrawer();
      await guard(() => notifier.openSession(session.id));
    }

    void newChat() {
      scaffoldKey.currentState?.closeEndDrawer();
      notifier.newChat();
      controller.clear();
      focusNode.requestFocus();
    }

    Future<void> deleteSession(AgentSessionResponseDto session) async {
      final title = session.title?.isNotEmpty ?? false ? session.title! : t.assistant_untitled_chat;
      final confirmed = await showGalleryConfirmDialog(
        context,
        title: t.assistant_delete_chat,
        content: t.assistant_delete_chat_prompt(title: title),
        confirmText: t.delete,
      );
      if (!confirmed) {
        return;
      }
      await guard(() async {
        await notifier.deleteSession(session.id);
        await ref.read(toastServiceProvider).success(t.assistant_chat_deleted);
      });
    }

    final title = state.sessionId == null
        ? t.assistant_new_chat
        : (state.session?.title?.isNotEmpty ?? false ? state.session!.title! : t.assistant_untitled_chat);
    final chatAssetIds = AssistantConversation.assetIds(state.messages);
    final reversed = state.messages.reversed.toList();
    final itemCount = reversed.length + (state.isWorking ? 1 : 0);

    return Scaffold(
      key: scaffoldKey,
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            key: const Key('assistant-new-chat'),
            tooltip: t.assistant_new_chat,
            onPressed: newChat,
            icon: const Icon(Icons.add_comment_outlined),
          ),
          IconButton(
            key: const Key('assistant-chats'),
            tooltip: t.assistant_chats,
            onPressed: () => scaffoldKey.currentState?.openEndDrawer(),
            icon: const Icon(Icons.history),
          ),
          PopupMenuButton<String>(
            key: const Key('assistant-menu'),
            onSelected: (value) async {
              if (value == 'auto-approve') {
                await guard(() => notifier.setAutoApprove(!state.autoApprove));
              } else if (value == 'delete' && state.session != null) {
                await deleteSession(state.session!);
              }
            },
            itemBuilder: (context) => [
              CheckedPopupMenuItem(
                key: const Key('assistant-auto-approve'),
                value: 'auto-approve',
                checked: state.autoApprove,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(t.assistant_auto_approve),
                  subtitle: Text(t.assistant_auto_approve_description),
                ),
              ),
              if (state.session != null && !state.isRunning)
                PopupMenuItem(
                  key: const Key('assistant-delete-chat'),
                  value: 'delete',
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.delete_outline),
                    title: Text(t.assistant_delete_chat),
                  ),
                ),
            ],
          ),
        ],
      ),
      endDrawer: AssistantSessionsDrawer(
        sessions: state.sessions,
        activeSessionId: state.sessionId,
        onOpen: (session) => unawaited(openSession(session)),
        onDelete: (session) => unawaited(deleteSession(session)),
        onNewChat: newChat,
      ),
      body: Column(
        children: [
          Expanded(
            child: state.isLoadingSession
                ? const Center(child: CircularProgressIndicator())
                : state.messages.isEmpty
                ? AssistantEmptyState(
                    hasPhotos: state.contextAssetIds.isNotEmpty,
                    onExample: (example) {
                      controller.text = example;
                      focusNode.requestFocus();
                    },
                  )
                : ListView.separated(
                    key: const Key('assistant-messages'),
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                    itemCount: itemCount,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      if (state.isWorking && index == 0) {
                        return const _Working();
                      }
                      final message = reversed[index - (state.isWorking ? 1 : 0)];
                      return AssistantMessageView(
                        key: ValueKey(message.id),
                        message: message,
                        chatAssetIds: chatAssetIds,
                        onPermission: respond,
                      );
                    },
                  ),
          ),
          AssistantComposer(
            controller: controller,
            focusNode: focusNode,
            attachedAssetIds: state.contextAssetIds,
            isRunning: state.isRunning,
            isSending: state.isSending,
            autoApprove: state.autoApprove,
            onSend: () => unawaited(send()),
            onStop: () => unawaited(guard(notifier.stop)),
            onRemoveAsset: notifier.removeContextAsset,
          ),
        ],
      ),
    );
  }
}

class _Working extends StatelessWidget {
  const _Working();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2)),
        const SizedBox(width: 10),
        Text(
          context.t.assistant_working,
          style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

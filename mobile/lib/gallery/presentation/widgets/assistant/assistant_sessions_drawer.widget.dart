import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// The list of the assistant's chats: open one, start a new one, or delete one
class AssistantSessionsDrawer extends StatelessWidget {
  /// null while loading
  final List<AgentSessionResponseDto>? sessions;
  final String? activeSessionId;
  final void Function(AgentSessionResponseDto session) onOpen;
  final void Function(AgentSessionResponseDto session) onDelete;
  final VoidCallback onNewChat;

  const AssistantSessionsDrawer({
    super.key,
    required this.sessions,
    required this.activeSessionId,
    required this.onOpen,
    required this.onDelete,
    required this.onNewChat,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final sessions = this.sessions;
    final dateFormat = DateFormat.yMMMd(context.locale.toString());

    return Drawer(
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
              child: Row(
                children: [
                  Expanded(child: Text(context.t.assistant_chats, style: theme.textTheme.titleLarge)),
                  TextButton.icon(
                    key: const Key('assistant-drawer-new-chat'),
                    onPressed: onNewChat,
                    icon: const Icon(Icons.add),
                    label: Text(context.t.assistant_new_chat),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: sessions == null
                  ? const Center(child: CircularProgressIndicator())
                  : sessions.isEmpty
                  ? Center(
                      child: Text(
                        context.t.assistant_no_chats,
                        style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.onSurfaceVariant),
                      ),
                    )
                  : ListView.builder(
                      itemCount: sessions.length,
                      itemBuilder: (context, index) {
                        final session = sessions[index];
                        final title = session.title?.isNotEmpty ?? false
                            ? session.title!
                            : context.t.assistant_untitled_chat;
                        final isRunning = session.status == AgentSessionStatus.running;
                        final subtitle = switch (session.status) {
                          AgentSessionStatus.running => context.t.assistant_status_running,
                          AgentSessionStatus.error => context.t.assistant_status_error,
                          _ => dateFormat.format(session.updatedAt.toLocal()),
                        };
                        return ListTile(
                          key: ValueKey('assistant-session-${session.id}'),
                          selected: session.id == activeSessionId,
                          leading: isRunning
                              ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.chat_bubble_outline),
                          title: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text(subtitle),
                          onTap: () => onOpen(session),
                          // a running chat is left alone: its agent is still working
                          trailing: isRunning
                              ? null
                              : IconButton(
                                  key: ValueKey('assistant-delete-${session.id}'),
                                  tooltip: context.t.assistant_delete_chat_named(title: title),
                                  icon: const Icon(Icons.delete_outline),
                                  onPressed: () => onDelete(session),
                                ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

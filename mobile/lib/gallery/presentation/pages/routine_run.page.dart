import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_markdown.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_message.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/routines/routine_change_list.widget.dart';
import 'package:immich_mobile/gallery/providers/routines.provider.dart';
import 'package:immich_mobile/gallery/repositories/routine_api.repository.dart';
import 'package:immich_mobile/gallery/utils/assistant_conversation.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';

/// The label of the status of a run
String routineRunStatusLabel(BuildContext context, RoutineRunStatus status) {
  final t = context.t;
  return switch (status) {
    RoutineRunStatus.queued => t.routine_run_status_queued,
    RoutineRunStatus.running => t.routine_run_status_running,
    RoutineRunStatus.succeeded => t.routine_run_status_succeeded,
    RoutineRunStatus.failed => t.routine_run_status_failed,
    RoutineRunStatus.cancelled => t.routine_run_status_cancelled,
    RoutineRunStatus.skipped => t.routine_run_status_skipped,
  };
}

/// A routine run: its status and summary, its changes to approve or deny, and its transcript like a chat. A run
/// that is still going is polled, like on the web.
@RoutePage()
class RoutineRunPage extends HookConsumerWidget {
  final String runId;

  const RoutineRunPage({super.key, required this.runId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final theme = Theme.of(context);
    final runAsync = ref.watch(routineRunProvider(runId));
    final busy = useState(<String>{});
    final status = runAsync.valueOrNull?.status;
    final going = status == RoutineRunStatus.queued || status == RoutineRunStatus.running;

    useEffect(() {
      if (!going) {
        return null;
      }
      final timer = Timer.periodic(const Duration(seconds: 3), (_) => ref.invalidate(routineRunProvider(runId)));
      return timer.cancel;
    }, [going]);

    Future<void> report(String message, {required bool error}) async {
      final toast = ref.read(toastServiceProvider);
      await (error ? toast.error(message) : toast.success(message));
    }

    void decide(List<String> ids, bool approve) => decideRoutineChangesLater(
      context,
      decide: () async {
        busy.value = {...busy.value, ...ids};
        try {
          return await ref.read(routineApiRepositoryProvider).decide(ids: ids, approve: approve);
        } finally {
          if (context.mounted) {
            busy.value = busy.value.difference(ids.toSet());
            ref
              ..invalidate(routineRunProvider(runId))
              ..invalidate(routinesInboxProvider);
          }
        }
      },
      report: report,
    );

    return Scaffold(
      appBar: AppBar(title: Text(runAsync.valueOrNull?.routineName ?? t.routine_run)),
      body: runAsync.when(
        skipLoadingOnRefresh: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            spacing: 8,
            children: [
              Text(t.errors.unable_to_load_routine_run),
              TextButton(onPressed: () => ref.invalidate(routineRunProvider(runId)), child: Text(t.retry)),
            ],
          ),
        ),
        data: (run) {
          final messages = run.messages.map(AssistantMessage.fromDto).toList();
          final chatAssetIds = AssistantConversation.assetIds(messages);
          return RefreshIndicator(
            onRefresh: () => ref.refresh(routineRunProvider(runId).future),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Chip(
                      key: const Key('routine-run-status'),
                      label: Text(routineRunStatusLabel(context, run.status)),
                      visualDensity: VisualDensity.compact,
                    ),
                    if (run.approvalMode == RoutineApprovalMode.dryRun)
                      Chip(label: Text(t.routine_run_dry_run_badge), visualDensity: VisualDensity.compact),
                    Text(t.routine_run_changes(count: run.changes), style: theme.textTheme.labelLarge),
                    if (run.pendingApprovals > 0)
                      Text(
                        t.routine_run_pending(count: run.pendingApprovals),
                        style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.tertiary),
                      ),
                  ],
                ),
                if (going) const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator()),
                if (run.summary != null && run.summary!.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(t.routine_run_summary, style: theme.textTheme.titleSmall),
                  const SizedBox(height: 4),
                  AssistantMarkdown(text: run.summary, assetIds: chatAssetIds),
                ],
                if (run.error != null && run.error!.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(run.error!, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error)),
                ],
                if (run.approvals.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text(t.routine_changes, style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  RoutineChangeList(changes: run.approvals, busy: busy.value, onDecide: decide),
                ],
                if (messages.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text(t.routine_run_transcript, style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  for (final message in messages)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AssistantMessageView(
                        message: message,
                        chatAssetIds: chatAssetIds,
                        // a run asks for no permission in a chat: its changes wait in the list above
                        onPermission: (_, _) async {},
                      ),
                    ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

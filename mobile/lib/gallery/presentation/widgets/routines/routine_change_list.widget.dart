import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_asset_strip.widget.dart';
import 'package:immich_mobile/gallery/providers/routines.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// The label of the status of a change
String routineChangeStatusLabel(BuildContext context, RoutineApprovalStatus status) {
  final t = context.t;
  return switch (status) {
    RoutineApprovalStatus.pending => t.routine_change_status_pending,
    RoutineApprovalStatus.applying => t.routine_change_status_applying,
    RoutineApprovalStatus.applied => t.routine_change_status_applied,
    RoutineApprovalStatus.failed => t.routine_change_status_failed,
    RoutineApprovalStatus.denied => t.routine_change_status_denied,
    RoutineApprovalStatus.expired => t.routine_change_status_expired,
    RoutineApprovalStatus.dryRun => t.routine_change_status_dry_run,
  };
}

/// The changes of routine runs, grouped by run: approve or deny each one, or every waiting change of a run at once.
/// In the inbox ([onOpenRun]) each run links to its page.
class RoutineChangeList extends StatelessWidget {
  final List<RoutineApprovalResponseDto> changes;
  final Set<String> busy;
  final void Function(List<String> ids, bool approve) onDecide;
  final void Function(String runId)? onOpenRun;

  const RoutineChangeList({
    super.key,
    required this.changes,
    required this.onDecide,
    this.busy = const {},
    this.onOpenRun,
  });

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 16,
      children: [
        for (final group in groupRoutineChanges(changes))
          Column(
            key: ValueKey('routine-run-${group.runId}'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: 8,
            children: [
              Row(
                children: [
                  Expanded(
                    child: onOpenRun == null
                        ? const SizedBox.shrink()
                        : Text(
                            group.routineName ?? t.routine_run,
                            style: theme.textTheme.titleSmall,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                  ),
                  if (onOpenRun != null)
                    TextButton(
                      key: ValueKey('routine-open-run-${group.runId}'),
                      onPressed: () => onOpenRun!(group.runId),
                      child: Text(t.routine_run_open),
                    ),
                ],
              ),
              if (group.pendingIds.length > 1)
                Wrap(
                  spacing: 8,
                  children: [
                    FilledButton.tonalIcon(
                      key: ValueKey('routine-approve-all-${group.runId}'),
                      onPressed: group.pendingIds.any(busy.contains) ? null : () => onDecide(group.pendingIds, true),
                      icon: const Icon(Icons.done_all),
                      label: Text(t.routine_approve_all),
                    ),
                    TextButton.icon(
                      key: ValueKey('routine-deny-all-${group.runId}'),
                      onPressed: group.pendingIds.any(busy.contains) ? null : () => onDecide(group.pendingIds, false),
                      icon: const Icon(Icons.close),
                      label: Text(t.routine_deny_all),
                    ),
                  ],
                ),
              for (final change in group.changes)
                _ChangeCard(
                  change: change,
                  busy: busy.contains(change.id),
                  onDecide: (approve) => onDecide([change.id], approve),
                ),
            ],
          ),
      ],
    );
  }
}

class _ChangeCard extends StatelessWidget {
  final RoutineApprovalResponseDto change;
  final bool busy;
  final void Function(bool approve) onDecide;

  const _ChangeCard({required this.change, required this.busy, required this.onDecide});

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final pending = change.status == RoutineApprovalStatus.pending;
    final statusColor = switch (change.status) {
      RoutineApprovalStatus.applied => colorScheme.primary,
      RoutineApprovalStatus.failed => colorScheme.error,
      RoutineApprovalStatus.pending => colorScheme.tertiary,
      _ => colorScheme.onSurfaceVariant,
    };
    final expires = DateFormat.yMMMd(context.locale.toString()).add_Hm().format(change.expiresAt.toLocal());

    return Card(
      key: ValueKey('routine-change-${change.id}'),
      elevation: 0,
      color: colorScheme.surfaceContainerHigh,
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 8,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 2,
                    children: [
                      Text(change.title, style: theme.textTheme.titleSmall),
                      if (change.summary.isNotEmpty)
                        Text(
                          change.summary,
                          style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
                        ),
                    ],
                  ),
                ),
                Text(
                  routineChangeStatusLabel(context, change.status),
                  style: theme.textTheme.labelMedium?.copyWith(color: statusColor),
                ),
              ],
            ),
            if (change.assetIds.isNotEmpty) AssistantAssetStrip(assetIds: change.assetIds, size: 44),
            if (change.result != null && !pending)
              Text(change.result!, style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant)),
            if (pending)
              Row(
                children: [
                  Expanded(
                    child: Text(
                      t.routine_expires(date: expires),
                      style: theme.textTheme.labelSmall?.copyWith(color: colorScheme.onSurfaceVariant),
                    ),
                  ),
                  TextButton(
                    key: ValueKey('routine-deny-${change.id}'),
                    onPressed: busy ? null : () => onDecide(false),
                    child: Text(t.routine_deny),
                  ),
                  FilledButton(
                    key: ValueKey('routine-approve-${change.id}'),
                    onPressed: busy ? null : () => onDecide(true),
                    child: busy
                        ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(t.routine_approve),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// Says what a decision did ("2 changes applied", "1 change denied", "1 change could not be applied")
String routineDecisionMessage(BuildContext context, RoutineApprovalDecisionResponseDto result) {
  final t = context.t;
  return [
    if (result.applied > 0) t.routine_approved_count(count: result.applied),
    if (result.denied > 0) t.routine_denied_count(count: result.denied),
    if (result.failed > 0) t.routine_changes_failed(count: result.failed),
  ].join(' · ');
}

/// Runs a decision and reports it in a toast
Future<void> decideRoutineChanges(
  BuildContext context, {
  required Future<RoutineApprovalDecisionResponseDto> Function() decide,
  required Future<void> Function(String message, {required bool error}) report,
}) async {
  final failedMessage = context.t.errors.unable_to_decide_routine_changes;
  try {
    final result = await decide();
    if (!context.mounted) {
      return;
    }
    final message = routineDecisionMessage(context, result);
    if (message.isNotEmpty) {
      await report(message, error: result.failed > 0);
    }
  } catch (_) {
    await report(failedMessage, error: true);
  }
}

/// Fires a decision without waiting for it, for button callbacks
void decideRoutineChangesLater(
  BuildContext context, {
  required Future<RoutineApprovalDecisionResponseDto> Function() decide,
  required Future<void> Function(String message, {required bool error}) report,
}) => unawaited(decideRoutineChanges(context, decide: decide, report: report));

import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/routines/routine_change_list.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/providers/routines.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';

/// The Routines inbox: the changes the assistant's routines want to make, waiting for the user's OK. Approve or deny
/// each change or every change of a run, or open the run to see what it did.
@RoutePage()
class RoutinesInboxPage extends ConsumerWidget {
  const RoutinesInboxPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final inbox = ref.watch(routinesInboxProvider);
    final navigator = ref.read(galleryNavigatorProvider);

    Future<void> report(String message, {required bool error}) async {
      final toast = ref.read(toastServiceProvider);
      await (error ? toast.error(message) : toast.success(message));
    }

    return Scaffold(
      appBar: AppBar(title: Text('${t.routines} · ${t.routines_inbox}')),
      body: inbox.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            spacing: 8,
            children: [
              Text(t.errors.unable_to_load_routines),
              TextButton(
                onPressed: () => unawaited(ref.read(routinesInboxProvider.notifier).load()),
                child: Text(t.retry),
              ),
            ],
          ),
        ),
        data: (state) => RefreshIndicator(
          onRefresh: () => ref.read(routinesInboxProvider.notifier).load(),
          child: state.changes.isEmpty
              ? ListView(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 96, 24, 24),
                      child: Column(
                        spacing: 12,
                        children: [
                          Icon(Icons.inbox_outlined, size: 48, color: Theme.of(context).colorScheme.onSurfaceVariant),
                          Text(
                            t.routines_inbox_empty,
                            key: const Key('routines-inbox-empty'),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  ],
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    RoutineChangeList(
                      changes: state.changes,
                      busy: state.busy,
                      onOpenRun: (runId) => unawaited(navigator.openRoutineRun(runId)),
                      onDecide: (ids, approve) => decideRoutineChangesLater(
                        context,
                        decide: () => ref.read(routinesInboxProvider.notifier).decide(ids, approve: approve),
                        report: report,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/routine_api.repository.dart';
import 'package:openapi/api.dart';

/// The changes of one routine run, in the order the server lists them
class RoutineChangeGroup {
  final String runId;
  final String? routineName;
  final List<RoutineApprovalResponseDto> changes;

  const RoutineChangeGroup(this.runId, this.routineName, this.changes);

  List<String> get pendingIds =>
      changes.where((change) => change.status == RoutineApprovalStatus.pending).map((change) => change.id).toList();
}

/// Groups changes by their run, keeping the order of the first change of each run (the web's `RoutineChangeList`)
List<RoutineChangeGroup> groupRoutineChanges(List<RoutineApprovalResponseDto> changes) {
  final groups = <String, RoutineChangeGroup>{};
  for (final change in changes) {
    groups
        .putIfAbsent(change.runId, () => RoutineChangeGroup(change.runId, change.routineName.orElse(null), []))
        .changes
        .add(change);
  }
  return groups.values.toList();
}

/// Replaces the changes the server answered for a decision
List<RoutineApprovalResponseDto> applyRoutineDecision(
  List<RoutineApprovalResponseDto> changes,
  List<RoutineApprovalResponseDto> results,
) {
  final byId = {for (final result in results) result.id: result};
  return [for (final change in changes) byId[change.id] ?? change];
}

/// The changes on screen, and the ones being decided
class RoutineChangesState {
  final List<RoutineApprovalResponseDto> changes;
  final Set<String> busy;

  const RoutineChangesState(this.changes, {this.busy = const {}});
}

/// The Routines inbox: the changes of routine runs that wait for approval. A decided change leaves it; a new run's
/// notification reloads it.
class RoutinesInboxNotifier extends StateNotifier<AsyncValue<RoutineChangesState>> {
  final RoutineApiRepository _repository;
  StreamSubscription<GalleryNotification>? _notifications;

  RoutinesInboxNotifier(this._repository, GalleryEventBus bus) : super(const AsyncValue.loading()) {
    _notifications = bus.notifications.listen((notification) {
      if (notification.target is RoutineRunNotificationTarget) {
        unawaited(load());
      }
    });
    unawaited(load());
  }

  @override
  void dispose() {
    unawaited(_notifications?.cancel());
    super.dispose();
  }

  Future<void> load() async {
    try {
      final changes = await _repository.getInbox();
      if (mounted) {
        state = AsyncValue.data(RoutineChangesState(changes, busy: state.valueOrNull?.busy ?? const {}));
      }
    } catch (error, stackTrace) {
      if (mounted && !state.hasValue) {
        state = AsyncValue.error(error, stackTrace);
      }
    }
  }

  void _setBusy(Set<String> busy) {
    final current = state.valueOrNull;
    if (current != null && mounted) {
      state = AsyncValue.data(RoutineChangesState(current.changes, busy: busy));
    }
  }

  /// Approves or denies [ids]; the decided changes leave the inbox
  Future<RoutineApprovalDecisionResponseDto> decide(List<String> ids, {required bool approve}) async {
    final before = state.valueOrNull?.busy ?? const <String>{};
    _setBusy({...before, ...ids});
    try {
      final result = await _repository.decide(ids: ids, approve: approve);
      final current = state.valueOrNull;
      if (current != null && mounted) {
        final decided = applyRoutineDecision(current.changes, result.results);
        state = AsyncValue.data(
          RoutineChangesState(
            decided.where((change) => change.status == RoutineApprovalStatus.pending).toList(),
            busy: current.busy.difference(ids.toSet()),
          ),
        );
      }
      return result;
    } catch (_) {
      _setBusy((state.valueOrNull?.busy ?? const <String>{}).difference(ids.toSet()));
      rethrow;
    }
  }
}

final routinesInboxProvider = StateNotifierProvider.autoDispose<RoutinesInboxNotifier, AsyncValue<RoutineChangesState>>(
  (ref) => RoutinesInboxNotifier(ref.watch(routineApiRepositoryProvider), ref.watch(galleryEventBusProvider)),
);

/// A routine run with its transcript and changes
final routineRunProvider = FutureProvider.autoDispose.family<RoutineRunDetailResponseDto, String>(
  (ref, id) => ref.watch(routineApiRepositoryProvider).getRun(id),
);

/// How many changes wait in the Routines inbox, for the Library entry; 0 when it can't be told (an older server)
final routinesPendingCountProvider = FutureProvider.autoDispose<int>((ref) async {
  try {
    return (await ref.watch(routineApiRepositoryProvider).getInbox()).length;
  } catch (_) {
    return 0;
  }
});

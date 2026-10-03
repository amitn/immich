import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/repositories/notification_api.repository.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:logging/logging.dart';

/// Shows a notification that just arrived, with a way to open what it is about
typedef GalleryNotificationAnnouncer = void Function(GalleryNotification notification, VoidCallback? onOpen);

final galleryNotificationAnnouncerProvider = Provider<GalleryNotificationAnnouncer>(
  (ref) =>
      (notification, onOpen) => snackbar.info(
        notification.title,
        duration: const Duration(seconds: 6),
        action: onOpen == null ? null : SnackbarAction(label: StaticTranslations.instance.open, onPressed: onOpen),
      ),
);

/// The id of the signed-in user: the notifications are theirs
final galleryUserIdProvider = Provider<String?>((ref) => ref.watch(currentUserProvider.select((user) => user?.id)));

/// The unread notifications: a server-backed list, loaded once and kept current by the websocket
class GalleryNotificationsNotifier extends StateNotifier<AsyncValue<List<GalleryNotification>>> {
  static final _log = Logger('GalleryNotificationsNotifier');

  final NotificationApiRepository _repository;
  final GalleryNavigator _navigator;
  final GalleryNotificationAnnouncer _announce;
  StreamSubscription<GalleryNotification>? _subscription;

  GalleryNotificationsNotifier(this._repository, this._navigator, this._announce, GalleryEventBus bus)
    : super(const AsyncValue.loading()) {
    _subscription = bus.notifications.listen(_receive);
    unawaited(load());
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  int get unreadCount => state.valueOrNull?.length ?? 0;

  Future<void> load() async {
    try {
      final notifications = await _repository.getUnread();
      if (mounted) {
        state = AsyncValue.data(notifications);
      }
    } catch (error, stackTrace) {
      _log.warning('Unable to load the notifications', error, stackTrace);
      if (mounted && !state.hasValue) {
        state = AsyncValue.error(error, stackTrace);
      }
    }
  }

  void _receive(GalleryNotification notification) {
    if (!mounted) {
      return;
    }
    final current = state.valueOrNull ?? const [];
    state = AsyncValue.data([notification, ...current.where((other) => other.id != notification.id)]);
    final target = notification.target;
    _announce(notification, target == null ? null : () => unawaited(open(notification)));
  }

  /// Marks notifications read: they leave the list
  Future<void> markRead(List<String> ids) async {
    final previous = state.valueOrNull;
    if (previous == null || ids.isEmpty) {
      return;
    }
    state = AsyncValue.data(previous.where((notification) => !ids.contains(notification.id)).toList());
    try {
      await _repository.markRead(ids);
    } catch (error, stackTrace) {
      _log.warning('Unable to mark notifications read', error, stackTrace);
      if (mounted) {
        state = AsyncValue.data(previous);
      }
      rethrow;
    }
  }

  Future<void> markAllRead() => markRead([...?state.valueOrNull?.map((notification) => notification.id)]);

  /// Opens what a notification is about, and marks it read; false when that is not on this device (yet)
  Future<bool> open(GalleryNotification notification) async {
    unawaited(markRead([notification.id]).catchError((_) {}));
    final target = notification.target;
    return target == null ? true : _navigator.openTarget(target);
  }
}

final galleryNotificationsProvider =
    StateNotifierProvider<GalleryNotificationsNotifier, AsyncValue<List<GalleryNotification>>>((ref) {
      // another account has other notifications
      ref.watch(galleryUserIdProvider);
      return GalleryNotificationsNotifier(
        ref.watch(notificationApiRepositoryProvider),
        ref.watch(galleryNavigatorProvider),
        ref.watch(galleryNotificationAnnouncerProvider),
        ref.watch(galleryEventBusProvider),
      );
    });

/// Wakes the notifications when the websocket connects, so a notification that arrives is shown wherever the user is
void connectGalleryNotifications(Ref ref) => ref.read(galleryNotificationsProvider);

import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/providers/notifications.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';

/// The unread notifications: a book that is ready, an artwork, a highlight video, a draft book. Tapping one opens what
/// it is about and marks it read.
@RoutePage()
class GalleryNotificationsPage extends ConsumerWidget {
  const GalleryNotificationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final notificationsAsync = ref.watch(galleryNotificationsProvider);
    final notifier = ref.read(galleryNotificationsProvider.notifier);
    final hasUnread = notificationsAsync.valueOrNull?.isNotEmpty ?? false;

    Future<void> open(GalleryNotification notification) async {
      final unavailable = t.not_on_device_yet;
      if (!await notifier.open(notification)) {
        await ref.read(toastServiceProvider).error(unavailable);
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(t.notifications),
        actions: [
          if (hasUnread)
            TextButton(
              key: const Key('notifications-mark-all-read'),
              onPressed: () => unawaited(notifier.markAllRead().catchError((_) {})),
              child: Text(t.mark_all_as_read),
            ),
        ],
      ),
      body: notificationsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => Center(
          child: TextButton(onPressed: () => unawaited(notifier.load()), child: Text(t.retry)),
        ),
        data: (notifications) => notifications.isEmpty
            ? Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 12,
                  children: [
                    Icon(Icons.notifications_none, size: 48, color: Theme.of(context).colorScheme.onSurfaceVariant),
                    Text(t.no_notifications, style: Theme.of(context).textTheme.titleMedium),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: notifier.load,
                child: ListView.separated(
                  itemCount: notifications.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) => _NotificationTile(
                    notification: notifications[index],
                    onTap: () => unawaited(open(notifications[index])),
                  ),
                ),
              ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final GalleryNotification notification;
  final VoidCallback onTap;

  const _NotificationTile({required this.notification, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final (icon, color) = switch (notification.target) {
      BookNotificationTarget() => (Icons.menu_book_outlined, colorScheme.primary),
      AssetNotificationTarget() => (Icons.image_outlined, colorScheme.primary),
      AlbumNotificationTarget() => (Icons.photo_album_outlined, colorScheme.primary),
      MemoryNotificationTarget() => (Icons.auto_awesome_outlined, colorScheme.primary),
      JournalNotificationTarget() => (Icons.edit_note_outlined, colorScheme.primary),
      null => switch (notification.level) {
        'error' => (Icons.error_outline, colorScheme.error),
        'warning' => (Icons.warning_amber_outlined, colorScheme.tertiary),
        'success' => (Icons.check_circle_outline, colorScheme.primary),
        _ => (Icons.notifications_outlined, colorScheme.onSurfaceVariant),
      },
    };
    final date = DateFormat.yMMMd(context.locale.toString()).add_Hm().format(notification.createdAt);

    return ListTile(
      key: ValueKey('notification-${notification.id}'),
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.12),
        child: Icon(icon, color: color),
      ),
      title: Text(notification.title),
      subtitle: Text(
        [if (notification.description != null) notification.description!, date].join('\n'),
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
      ),
      isThreeLine: notification.description != null,
      trailing: notification.target == null ? null : const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}

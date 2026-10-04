import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/providers/notifications.provider.dart';
import 'package:immich_mobile/gallery/providers/routines.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// The Library entries of the assistant work: the assistant, the Routines inbox and the photo books, on a server that
/// has them
class GalleryLibraryEntries extends ConsumerWidget {
  const GalleryLibraryEntries({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final features = ref.watch(galleryFeaturesProvider);
    if (!features.assistant && !features.books) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final navigator = ref.read(galleryNavigatorProvider);
    final style = theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w500);

    return SliverPadding(
      padding: const EdgeInsets.only(left: 16, top: 12, right: 16),
      sliver: SliverToBoxAdapter(
        child: Material(
          color: colorScheme.primary.withAlpha(12),
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            side: BorderSide(color: colorScheme.onSurface.withAlpha(10)),
            borderRadius: const BorderRadius.all(Radius.circular(20)),
          ),
          child: Column(
            children: [
              if (features.assistant)
                ListTile(
                  key: const Key('library-assistant'),
                  leading: const Icon(Icons.auto_awesome_outlined, size: 26),
                  title: Text(context.t.assistant, style: style),
                  onTap: () => unawaited(navigator.openAssistant()),
                ),
              if (features.assistant) const _RoutinesInboxEntry(),
              if (features.books)
                ListTile(
                  key: const Key('library-books'),
                  leading: const Icon(Icons.menu_book_outlined, size: 26),
                  title: Text(context.t.photo_books, style: style),
                  onTap: () => unawaited(navigator.openBooks()),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The Routines inbox, with the number of changes waiting for approval
class _RoutinesInboxEntry extends ConsumerWidget {
  const _RoutinesInboxEntry();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final pending = ref.watch(routinesPendingCountProvider).valueOrNull ?? 0;
    return ListTile(
      key: const Key('library-routines'),
      leading: const Icon(Icons.event_repeat_outlined, size: 26),
      title: Text(context.t.routines, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w500)),
      trailing: pending > 0
          ? Badge(key: const Key('library-routines-pending'), label: Text(pending > 99 ? '99+' : '$pending'))
          : null,
      onTap: () async {
        await ref.read(galleryNavigatorProvider).openRoutinesInbox();
        ref.invalidate(routinesPendingCountProvider);
      },
    );
  }
}

/// The notifications, with the number of unread ones
class GalleryNotificationBell extends ConsumerWidget {
  const GalleryNotificationBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(galleryNotificationsProvider.select((state) => state.valueOrNull?.length ?? 0));
    return IconButton(
      key: const Key('notifications-bell'),
      tooltip: context.t.notifications,
      onPressed: () => unawaited(ref.read(galleryNavigatorProvider).openNotifications()),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: Icon(count > 0 ? Icons.notifications : Icons.notifications_none),
      ),
    );
  }
}

/// "Create with assistant" on the Albums page: the assistant asks which photos to put in a new album
class GalleryCreateAlbumWithAssistantButton extends ConsumerWidget {
  const GalleryCreateAlbumWithAssistantButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(galleryFeaturesProvider.select((features) => features.assistant));
    if (!enabled) {
      return const SizedBox.shrink();
    }
    return IconButton(
      key: const Key('albums-create-with-assistant'),
      tooltip: context.t.album_create_with_assistant,
      onPressed: () =>
          unawaited(ref.read(galleryNavigatorProvider).openAssistant(prompt: context.t.album_create_prompt)),
      icon: const Icon(Icons.auto_awesome_outlined),
    );
  }
}

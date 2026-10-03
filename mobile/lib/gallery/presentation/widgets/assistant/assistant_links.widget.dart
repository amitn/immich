import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';

/// Buttons to the albums and photo books a message refers to (an album the assistant made, a book it laid out)
class AssistantLinks extends ConsumerWidget {
  final List<String> albumIds;
  final List<String> bookIds;

  const AssistantLinks({super.key, this.albumIds = const [], this.bookIds = const []});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (albumIds.isEmpty && bookIds.isEmpty) {
      return const SizedBox.shrink();
    }

    Future<void> openAlbum(String id) async {
      final message = context.t.not_on_device_yet;
      if (!await ref.read(galleryNavigatorProvider).openAlbum(id)) {
        await ref.read(toastServiceProvider).error(message);
      }
    }

    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: [
        for (final (index, id) in albumIds.indexed)
          ActionChip(
            key: ValueKey('assistant-album-$id'),
            avatar: const Icon(Icons.photo_album_outlined, size: 18),
            label: Text(
              albumIds.length == 1
                  ? context.t.assistant_open_album
                  : context.t.assistant_open_album_number(index: index + 1),
            ),
            onPressed: () => unawaited(openAlbum(id)),
          ),
        for (final (index, id) in bookIds.indexed)
          ActionChip(
            key: ValueKey('assistant-book-$id'),
            avatar: const Icon(Icons.menu_book_outlined, size: 18),
            label: Text(
              bookIds.length == 1
                  ? context.t.assistant_open_book
                  : context.t.assistant_open_book_number(index: index + 1),
            ),
            onPressed: () => unawaited(ref.read(galleryNavigatorProvider).openBook(id)),
          ),
      ],
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/journals/journal_picker.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/base_action_button.widget.dart';

/// The entries of the assistant work (#3) in the ⋮ menu of an album: "Export as book…" on a server with photo books,
/// and "Name in a journal…" with the journals
List<Widget> galleryAlbumMenuItems(BuildContext context, WidgetRef ref, RemoteAlbum album) {
  final features = ref.watch(galleryFeaturesProvider);
  final journals = ref.watch(galleryJournalsProvider);
  final navigator = ref.read(galleryNavigatorProvider);
  if (album.assetCount == 0) {
    return const [];
  }

  return [
    if (features.books)
      BaseActionButton(
        key: const Key('album-export-book'),
        label: context.t.book_export_album_action,
        iconData: Icons.menu_book_outlined,
        menuItem: true,
        onPressed: () => unawaited(
          navigator.exportAlbumAsBook(albumId: album.id, albumName: album.name, assetCount: album.assetCount),
        ),
      ),
    if (journals)
      BaseActionButton(
        key: const Key('album-name-journal'),
        label: context.t.journal_name_action,
        iconData: Icons.edit_note_outlined,
        menuItem: true,
        onPressed: () => unawaited(
          showJournalPicker(context, ref, albumId: album.id, albumName: album.name, albumAssetCount: album.assetCount),
        ),
      ),
  ];
}

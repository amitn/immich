import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// "Name in a journal…": the journals ("Name the dishes…", "Name the artworks…"), one of which opens its naming page
/// for an album or for photos; false when none was chosen. One entry in the menus instead of one per journal
Future<bool> showJournalPicker(
  BuildContext context,
  WidgetRef ref, {
  String? albumId,
  String? albumName,
  int albumAssetCount = 0,
  List<String> assetIds = const [],
}) async {
  final navigator = ref.read(galleryNavigatorProvider);
  final pack = await showModalBottomSheet<JournalPack>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      builder: (context, scroll) => ListView(
        controller: scroll,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(context.t.journal_name_action, style: Theme.of(context).textTheme.titleMedium),
          ),
          for (final pack in journalPacks)
            ListTile(
              key: ValueKey('journal-pack-${pack.id}'),
              leading: Icon(pack.icon),
              title: Text(journalLabel(context, pack, 'name_action')),
              onTap: () => Navigator.of(context).pop(pack),
            ),
        ],
      ),
    ),
  );
  if (pack == null) {
    return false;
  }
  unawaited(
    navigator.nameInJournal(
      pack: pack.id,
      albumId: albumId,
      albumName: albumName,
      albumAssetCount: albumAssetCount,
      assetIds: assetIds,
    ),
  );
  return true;
}

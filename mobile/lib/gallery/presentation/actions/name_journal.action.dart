import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/gallery/presentation/widgets/journals/journal_picker.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';

/// The selected photos a journal looks in: on the server, not in the trash or the locked folder; null when the
/// action does not apply. The photos of others are looked in too (they help to read the names), but at least one
/// must be the user's: only their owner can name photos (#21)
final _journalAssetIdsProvider = Provider.family.autoDispose<List<String>?, ActionSource>((ref, source) {
  if (!ref.watch(galleryJournalsProvider)) {
    return null;
  }
  final usable = ref.watch(assetsActionProvider(source)).trashed(isTrashed: false).locked(isLocked: false);
  final owned = ref.watch(ownedAssetsActionProvider(source)).trashed(isTrashed: false).locked(isLocked: false);
  if (owned.isEmpty) {
    return null;
  }
  return usable.map((asset) => asset.id).toList(growable: false);
}, dependencies: [assetsActionProvider, ownedAssetsActionProvider]);

/// "Name in a journal…" on selected photos: the journals, one of which looks for its visits in them
class NameJournalAction extends AssetActionBuilder {
  const NameJournalAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    final assetIds = ref.watch(_journalAssetIdsProvider(source));
    if (assetIds == null) {
      return null;
    }

    return ActionItem(
      icon: Icons.edit_note_outlined,
      label: context.t.journal_name_action,
      onAction: () async {
        // the selection (and the sheet of this action) goes once a journal is chosen
        final clearSelection = ref.read(clearSelectionProvider(source));
        if (await showJournalPicker(context, ref, assetIds: assetIds)) {
          clearSelection();
        }
      },
    );
  }
}

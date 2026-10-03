import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';

/// The selected photos and videos a highlight video can be made of: on the server, not in the trash or the locked
/// folder (the photos of others too); null when the action does not apply
final _highlightAssetIdsProvider = Provider.family.autoDispose<List<String>?, ActionSource>((ref, source) {
  if (!ref.watch(galleryFeaturesProvider.select((features) => features.highlights))) {
    return null;
  }
  final assetIds = ref
      .watch(assetsActionProvider(source))
      .trashed(isTrashed: false)
      .locked(isLocked: false)
      .map((asset) => asset.id)
      .toList(growable: false);
  return assetIds.isEmpty ? null : assetIds;
}, dependencies: [assetsActionProvider]);

/// "Make a highlight video…" of selected photos and videos
class MakeHighlightAction extends AssetActionBuilder {
  const MakeHighlightAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    final assetIds = ref.watch(_highlightAssetIdsProvider(source));
    if (assetIds == null) {
      return null;
    }

    return ActionItem(
      icon: Icons.movie_creation_outlined,
      label: context.t.highlight_video_make_action,
      onAction: () {
        ref.read(clearSelectionProvider(source))();
        unawaited(ref.read(galleryNavigatorProvider).makeHighlightVideo(assetIds: assetIds));
      },
    );
  }
}

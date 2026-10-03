import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/gallery/presentation/actions/ask_assistant.action.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';

/// The photo an artwork or an enhanced copy can be made of: one photo of the user's (both make a copy, which needs
/// the owner's rights), on the server, not in the trash or the locked folder
final _ownPhotoProvider = Provider.family.autoDispose<String?, ActionSource>((ref, source) {
  final assets = ref.watch(assetsActionProvider(source));
  final owned = ref.watch(ownedAssetsActionProvider(source)).trashed(isTrashed: false).locked(isLocked: false);
  if (assets.length != 1 || owned.length != 1 || !owned.first.isImage) {
    return null;
  }
  return owned.first.id;
}, dependencies: [assetsActionProvider, ownedAssetsActionProvider]);

/// "Artistic style…": an artwork of the photo in a style, made by the art agent
class ArtisticStyleAction extends AssetActionBuilder {
  const ArtisticStyleAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    final assetId = ref.watch(_ownPhotoProvider(source));
    if (assetId == null || !ref.watch(galleryFeaturesProvider.select((features) => features.artisticStyles))) {
      return null;
    }
    return ActionItem(
      icon: Icons.brush_outlined,
      label: context.t.artistic_style,
      onAction: () => unawaited(ref.read(galleryNavigatorProvider).openArtisticStyle(assetId)),
    );
  }
}

/// "Auto enhance": an enhanced copy of the photo, made on the server without AI
class AutoEnhanceAction extends AssetActionBuilder {
  const AutoEnhanceAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    final assetId = ref.watch(_ownPhotoProvider(source));
    if (assetId == null || !ref.watch(galleryFeaturesProvider.select((features) => features.autoEnhance))) {
      return null;
    }
    return ActionItem(
      icon: Icons.auto_fix_high_outlined,
      label: context.t.auto_enhance,
      onAction: () => unawaited(ref.read(galleryNavigatorProvider).openAutoEnhance(assetId)),
    );
  }
}

/// The entries of the assistant work (#3) in the ⋮ menu of the asset viewer: each hides itself where it does not
/// apply
const galleryViewerMenuItems = <Widget>[
  ActionMenuItem(action: AskAssistantAction(source: ActionSource.viewer)),
  ActionMenuItem(action: ArtisticStyleAction(source: ActionSource.viewer)),
  ActionMenuItem(action: AutoEnhanceAction(source: ActionSource.viewer)),
];

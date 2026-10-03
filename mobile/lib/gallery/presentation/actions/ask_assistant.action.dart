import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';

/// The selected photos the assistant can work with: on the server, not in the trash or the locked folder; null when
/// the action does not apply
final _askAssistantAssetIdsProvider = Provider.family.autoDispose<List<String>?, ActionSource>((ref, source) {
  if (!ref.watch(galleryFeaturesProvider.select((features) => features.assistant))) {
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

/// "Ask assistant" on selected photos: a new chat with them attached
class AskAssistantAction extends AssetActionBuilder {
  const AskAssistantAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    final assetIds = ref.watch(_askAssistantAssetIdsProvider(source));
    if (assetIds == null) {
      return null;
    }

    return ActionItem(
      icon: Icons.auto_awesome_outlined,
      label: context.t.ask_assistant,
      onAction: () {
        ref.read(clearSelectionProvider(source))();
        unawaited(ref.read(galleryNavigatorProvider).openAssistant(assetIds: assetIds));
      },
    );
  }
}

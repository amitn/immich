import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_asset_thumbnail.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';

/// Opens [assetIds] in the asset viewer at [index], or says the photo is not on this device yet
Future<void> openGalleryAssets(BuildContext context, WidgetRef ref, List<String> assetIds, int index) async {
  final message = context.t.not_on_device_yet;
  final opened = await ref.read(galleryNavigatorProvider).openAssets(assetIds, index: index);
  if (!opened) {
    await ref.read(toastServiceProvider).error(message);
  }
}

/// A row of photo thumbnails (the photos of a message or a tool result), which open the photos; a long list shows
/// the first [limit] and a "+N" tile that shows them all
class AssistantAssetStrip extends HookConsumerWidget {
  final List<String> assetIds;
  final double size;
  final int limit;

  /// Removes a photo (the photos attached to the next message)
  final void Function(String assetId)? onRemove;

  const AssistantAssetStrip({super.key, required this.assetIds, this.size = 56, this.limit = 8, this.onRemove});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final expanded = useState(false);
    if (assetIds.isEmpty) {
      return const SizedBox.shrink();
    }

    final shown = expanded.value || assetIds.length <= limit ? assetIds : assetIds.take(limit).toList();
    final hidden = assetIds.length - shown.length;
    final colorScheme = Theme.of(context).colorScheme;

    return SizedBox(
      height: size,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: shown.length + (hidden > 0 ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          if (index == shown.length) {
            return Tooltip(
              message: context.t.assistant_show_more_photos(count: hidden),
              child: InkWell(
                borderRadius: const BorderRadius.all(Radius.circular(8)),
                onTap: () => expanded.value = true,
                child: Ink(
                  width: size,
                  height: size,
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: const BorderRadius.all(Radius.circular(8)),
                  ),
                  child: Center(child: Text('+$hidden', style: Theme.of(context).textTheme.titleSmall)),
                ),
              ),
            );
          }

          final id = shown[index];
          final thumbnail = GalleryAssetThumbnail(
            key: ValueKey('assistant-asset-$id'),
            assetId: id,
            size: size,
            semanticLabel: context.t.assistant_open_photo(index: index + 1),
            onTap: () => openGalleryAssets(context, ref, assetIds, index),
          );
          if (onRemove == null) {
            return thumbnail;
          }
          return Stack(
            children: [
              thumbnail,
              Positioned(
                top: 2,
                right: 2,
                child: Material(
                  color: colorScheme.surface.withValues(alpha: 0.85),
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => onRemove!(id),
                    child: Padding(
                      padding: const EdgeInsets.all(2),
                      child: Icon(
                        Icons.close,
                        size: 16,
                        semanticLabel: context.t.assistant_remove_attached_photo(index: index + 1),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

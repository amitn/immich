import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/gallery/providers/tags.provider.dart';

/// A square tile of a tag: its newest photo (or a tag icon), its levels above it small, and its name
class GalleryTagTile extends ConsumerWidget {
  final String name;
  final String parents;

  /// The tag of the tile; none for a level no tag stands for
  final String? tagId;

  /// Its newest photo covers the tile
  final bool showCover;
  final double size;
  final VoidCallback onTap;

  const GalleryTagTile({
    super.key,
    required this.name,
    this.parents = '',
    this.tagId,
    this.showCover = true,
    this.size = 120,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final tagId = this.tagId;
    final cover = tagId == null || !showCover ? null : ref.watch(galleryTagCoverProvider(tagId)).valueOrNull;
    const radius = BorderRadius.all(Radius.circular(16));

    return SizedBox.square(
      dimension: size,
      child: Material(
        color: colorScheme.surfaceContainerHighest,
        borderRadius: radius,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (cover != null)
                ColorFiltered(
                  colorFilter: const ColorFilter.mode(Color(0x55000000), BlendMode.darken),
                  child: Image(
                    image: ref.watch(galleryImagesProvider).assetThumbnail(cover),
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                )
              else
                Icon(
                  tagId == null ? Icons.folder_outlined : Icons.sell_outlined,
                  size: size / 3,
                  color: colorScheme.onSurfaceVariant.withAlpha(80),
                ),
              Positioned(
                left: 10,
                right: 10,
                bottom: 10,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (parents.isNotEmpty)
                      Text(
                        parents,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: cover != null ? Colors.white70 : colorScheme.onSurfaceVariant,
                        ),
                      ),
                    Text(
                      name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: cover != null ? Colors.white : colorScheme.onSurface,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

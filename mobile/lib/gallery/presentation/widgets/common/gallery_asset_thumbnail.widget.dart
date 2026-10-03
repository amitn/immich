import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';

/// A square thumbnail of a photo by its id, with a placeholder while it loads or when it fails
class GalleryAssetThumbnail extends ConsumerWidget {
  final String assetId;
  final double size;
  final BorderRadius borderRadius;
  final VoidCallback? onTap;
  final String? semanticLabel;

  const GalleryAssetThumbnail({
    super.key,
    required this.assetId,
    this.size = 64,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
    this.onTap,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final placeholder = ColoredBox(
      color: colorScheme.surfaceContainerHighest,
      child: Icon(Icons.image_outlined, size: size / 2.5, color: colorScheme.onSurfaceVariant),
    );
    final image = ClipRRect(
      borderRadius: borderRadius,
      child: SizedBox.square(
        dimension: size,
        child: Image(
          image: ref.watch(galleryImagesProvider).assetThumbnail(assetId),
          fit: BoxFit.cover,
          semanticLabel: semanticLabel,
          errorBuilder: (_, _, _) => placeholder,
          frameBuilder: (_, child, frame, wasSynchronouslyLoaded) =>
              wasSynchronouslyLoaded || frame != null ? child : placeholder,
        ),
      ),
    );
    if (onTap == null) {
      return image;
    }
    return InkWell(borderRadius: borderRadius, onTap: onTap, child: image);
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// Shows photos full screen, to read them (a menu, a wall label, a setlist): pinch to zoom, swipe between them
Future<void> showGalleryPhotos(BuildContext context, List<String> assetIds, {int index = 0, String? title}) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => GalleryPhotoViewer(assetIds: assetIds, initialIndex: index, title: title),
      ),
    );

class GalleryPhotoViewer extends ConsumerStatefulWidget {
  final List<String> assetIds;
  final int initialIndex;
  final String? title;

  const GalleryPhotoViewer({super.key, required this.assetIds, this.initialIndex = 0, this.title});

  @override
  ConsumerState<GalleryPhotoViewer> createState() => _GalleryPhotoViewerState();
}

class _GalleryPhotoViewerState extends ConsumerState<GalleryPhotoViewer> {
  late final PageController _pages = PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final images = ref.watch(galleryImagesProvider);
    final count = widget.assetIds.length;
    final title = [if (widget.title != null) widget.title!, if (count > 1) '${_index + 1} / $count'].join(' · ');

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(title),
        leading: IconButton(
          tooltip: context.t.close,
          icon: const Icon(Icons.close),
          onPressed: () => unawaited(Navigator.of(context).maybePop()),
        ),
      ),
      body: PageView.builder(
        controller: _pages,
        itemCount: count,
        onPageChanged: (index) => setState(() => _index = index),
        itemBuilder: (context, index) => InteractiveViewer(
          maxScale: 6,
          child: Center(
            child: Image(
              key: ValueKey('gallery-photo-${widget.assetIds[index]}'),
              image: images.assetPreview(widget.assetIds[index]),
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48),
            ),
          ),
        ),
      ),
    );
  }
}

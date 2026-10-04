import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// "Make a video" of a memory, in the top corner of its page: the video of the whole moment it stands for (e.g. every
/// day of a trip), landscape or vertical 9:16 to share to other apps. A [Positioned] child of the memory's stack
class GalleryMemoryVideoButton extends ConsumerWidget {
  final Memory memory;
  final String title;

  const GalleryMemoryVideoButton({super.key, required this.memory, required this.title});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(galleryFeaturesProvider.select((features) => features.highlights))) {
      return const Positioned(top: 0, right: 0, child: SizedBox.shrink());
    }
    final navigator = ref.read(galleryNavigatorProvider);

    return Positioned(
      top: 8,
      right: 8,
      child: PopupMenuButton<bool>(
        key: ValueKey('memory-video-${memory.id}'),
        tooltip: context.t.memory_make_video,
        icon: const Icon(Icons.movie_creation_outlined, color: Colors.white, shadows: [Shadow(blurRadius: 6)]),
        onSelected: (vertical) =>
            unawaited(navigator.makeHighlightVideo(memoryId: memory.id, title: title, vertical: vertical)),
        itemBuilder: (context) => [
          PopupMenuItem(
            value: false,
            child: ListTile(leading: const Icon(Icons.crop_landscape), title: Text(context.t.memory_make_video)),
          ),
          PopupMenuItem(
            value: true,
            child: ListTile(leading: const Icon(Icons.crop_portrait), title: Text(context.t.year_recap_video_vertical)),
          ),
        ],
      ),
    );
  }
}

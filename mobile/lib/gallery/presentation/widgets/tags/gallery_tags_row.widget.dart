import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/tags/gallery_tag_tile.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/providers/tags.provider.dart';
import 'package:immich_mobile/gallery/utils/tag_tree.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// The tags row of the Library, like the web's Explore row: a tile per tag (not the photo tags of the journals), which
/// shows its photos in the timeline, and "View all" for the tree of the tags. Hidden without tags
class GalleryTagsRow extends ConsumerWidget {
  /// The tiles that get a cover photo, like the web's
  static const coveredTiles = 24;

  const GalleryTagsRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tags = exploreTags(ref.watch(galleryTagsProvider).valueOrNull ?? const []);
    if (tags.isEmpty) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }
    final navigator = ref.read(galleryNavigatorProvider);
    final theme = Theme.of(context);

    return SliverPadding(
      padding: const EdgeInsets.only(top: 16),
      sliver: SliverToBoxAdapter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 16, right: 8),
              child: Row(
                children: [
                  Expanded(child: Text(context.t.tags, style: theme.textTheme.titleMedium)),
                  TextButton(
                    key: const Key('library-tags-view-all'),
                    onPressed: () => unawaited(navigator.openTags()),
                    child: Text(context.t.view_all),
                  ),
                ],
              ),
            ),
            SizedBox(
              height: 120,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                itemCount: tags.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final tag = tags[index];
                  final parts = tag.value.split('/');
                  return GalleryTagTile(
                    key: ValueKey('library-tag-${tag.id}'),
                    name: parts.last,
                    parents: tagParentLabel(tag.value),
                    tagId: tag.id,
                    showCover: index < coveredTiles,
                    onTap: () => navigator.openTagPhotos(tag.id),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

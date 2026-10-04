import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/tags/gallery_tag_tile.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/providers/tags.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// The tree of the tags, a level at a time like the web's tags page: a level with more tags opens it, a tag shows
/// its photos in the timeline
@RoutePage()
class TagsPage extends ConsumerWidget {
  /// The level shown, e.g. Holidays/Italy; empty for the top
  final String path;

  const TagsPage({super.key, this.path = ''});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final theme = Theme.of(context);
    final tree = ref.watch(galleryTagTreeProvider);
    final navigator = ref.read(galleryNavigatorProvider);
    final parts = path.isEmpty ? const <String>[] : path.split('/');

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(parts.isEmpty ? t.tags : parts.last),
            if (parts.length > 1)
              Text(
                parts.take(parts.length - 1).join(' / '),
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
          ],
        ),
      ),
      body: tree.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => _Message(
          icon: Icons.error_outline,
          text: t.errors.unable_to_load_tags,
          action: TextButton(onPressed: () => ref.invalidate(galleryTagsProvider), child: Text(t.retry)),
        ),
        data: (root) {
          final node = root.find(path);
          if (node == null || (node.children.isEmpty && !node.hasPhotos)) {
            return _Message(icon: Icons.sell_outlined, text: t.tags_none, description: t.tag_feature_description);
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(galleryTagsProvider.future),
            child: CustomScrollView(
              slivers: [
                if (node.hasPhotos)
                  SliverToBoxAdapter(
                    child: ListTile(
                      key: const Key('tags-show-photos'),
                      leading: const Icon(Icons.photo_library_outlined),
                      title: Text(t.photos),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => navigator.openTagPhotos(node.tagId!),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.all(12),
                  sliver: SliverGrid.builder(
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 160,
                      mainAxisSpacing: 8,
                      crossAxisSpacing: 8,
                    ),
                    itemCount: node.children.length,
                    itemBuilder: (context, index) {
                      final child = node.children[index];
                      return LayoutBuilder(
                        builder: (context, constraints) => GalleryTagTile(
                          key: ValueKey('tags-node-${child.path}'),
                          name: child.name,
                          parents: child.children.isEmpty ? '' : t.tag_count(count: child.tagCount),
                          tagId: child.tagId,
                          size: constraints.maxWidth,
                          onTap: () => child.children.isEmpty
                              ? navigator.openTagPhotos(child.tagId!)
                              : unawaited(navigator.openTags(path: child.path)),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String text;
  final String? description;
  final Widget? action;

  const _Message({required this.icon, required this.text, this.description, this.action});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 12,
          children: [
            Icon(icon, size: 48, color: theme.colorScheme.onSurfaceVariant),
            Text(text, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            if (description != null)
              Text(
                description!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ?action,
          ],
        ),
      ),
    );
  }
}

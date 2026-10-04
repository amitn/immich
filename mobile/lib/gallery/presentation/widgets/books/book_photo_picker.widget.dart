import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_asset_thumbnail.widget.dart';
import 'package:immich_mobile/gallery/providers/books.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// Picks the photo for a slot: one of the photos of the book's album, or any photo from the timeline. Answers the
/// asset id, or null when dismissed.
Future<String?> showBookPhotoPicker(
  BuildContext context, {
  required String title,
  String? albumId,
  String? currentAssetId,
  Set<String> inBook = const {},
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  useSafeArea: true,
  builder: (context) => DraggableScrollableSheet(
    expand: false,
    initialChildSize: 0.75,
    maxChildSize: 0.95,
    builder: (context, scrollController) => _PhotoPicker(
      scrollController: scrollController,
      title: title,
      albumId: albumId,
      currentAssetId: currentAssetId,
      inBook: inBook,
    ),
  ),
);

class _PhotoPicker extends ConsumerWidget {
  final ScrollController scrollController;
  final String title;
  final String? albumId;
  final String? currentAssetId;
  final Set<String> inBook;

  const _PhotoPicker({
    required this.scrollController,
    required this.title,
    required this.albumId,
    required this.currentAssetId,
    required this.inBook,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final theme = Theme.of(context);
    final album = albumId;
    final photos = album == null ? null : ref.watch(bookAlbumPhotosProvider(album));

    Future<void> fromTimeline() async {
      final navigator = Navigator.of(context);
      final picked = await ref.read(galleryNavigatorProvider).pickPhoto();
      if (picked != null && navigator.mounted) {
        navigator.pop(picked);
      }
    }

    return CustomScrollView(
      controller: scrollController,
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Text(title, style: theme.textTheme.titleMedium),
          ),
        ),
        SliverToBoxAdapter(
          child: ListTile(
            key: const Key('book-photo-from-timeline'),
            leading: const Icon(Icons.photo_library_outlined),
            title: Text(t.timeline),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => unawaited(fromTimeline()),
          ),
        ),
        if (photos != null) ...[
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Text(t.book_photo_album_only, style: theme.textTheme.labelLarge),
            ),
          ),
          photos.when(
            loading: () => const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
            error: (_, _) => SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(t.errors.unable_to_load_book_photos, textAlign: TextAlign.center),
              ),
            ),
            data: (assets) => assets.isEmpty
                ? SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(t.book_photo_none, textAlign: TextAlign.center),
                    ),
                  )
                : SliverPadding(
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 24),
                    sliver: SliverGrid.builder(
                      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 110,
                        mainAxisSpacing: 4,
                        crossAxisSpacing: 4,
                      ),
                      itemCount: assets.length,
                      itemBuilder: (context, index) {
                        final asset = assets[index];
                        final current = asset.id == currentAssetId;
                        final used = inBook.contains(asset.id);
                        return Stack(
                          fit: StackFit.expand,
                          children: [
                            LayoutBuilder(
                              builder: (context, constraints) => GalleryAssetThumbnail(
                                key: ValueKey('book-photo-${asset.id}'),
                                assetId: asset.id,
                                size: constraints.maxWidth,
                                borderRadius: BorderRadius.circular(4),
                                semanticLabel: current
                                    ? t.book_photo_in_slot(name: asset.originalFileName)
                                    : used
                                    ? t.book_photo_in_book(name: asset.originalFileName)
                                    : asset.originalFileName,
                                onTap: current ? null : () => Navigator.of(context).pop(asset.id),
                              ),
                            ),
                            if (current || used)
                              IgnorePointer(
                                child: Align(
                                  alignment: Alignment.topRight,
                                  child: Padding(
                                    padding: const EdgeInsets.all(4),
                                    child: Icon(
                                      current ? Icons.radio_button_checked : Icons.menu_book,
                                      size: 18,
                                      color: Colors.white,
                                      shadows: const [Shadow(blurRadius: 4)],
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        );
                      },
                    ),
                  ),
          ),
        ],
      ],
    );
  }
}

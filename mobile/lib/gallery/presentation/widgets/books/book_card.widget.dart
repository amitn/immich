import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// The cover of a book: its first page rendered, or its cover photo, in the shape of its pages
class BookCover extends ConsumerWidget {
  final BookResponseDto book;

  const BookCover({super.key, required this.book});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final ratio = book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1.0;
    final images = ref.watch(galleryImagesProvider);
    final firstPageId = book.firstPageId;
    final coverAssetId = book.coverAssetId;
    final ImageProvider? image = firstPageId != null
        ? images.bookPage(book.id, firstPageId, size: 600, cacheKey: book.updatedAt)
        : coverAssetId != null
        ? images.assetThumbnail(coverAssetId)
        : null;
    final placeholder = Center(child: Icon(Icons.menu_book_outlined, size: 40, color: colorScheme.onSurfaceVariant));

    return AspectRatio(
      aspectRatio: ratio,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerHighest,
          borderRadius: const BorderRadius.all(Radius.circular(10)),
          boxShadow: [
            BoxShadow(color: colorScheme.shadow.withValues(alpha: 0.12), blurRadius: 4, offset: const Offset(0, 2)),
          ],
        ),
        child: ClipRRect(
          borderRadius: const BorderRadius.all(Radius.circular(10)),
          child: image == null
              ? placeholder
              : Image(
                  image: image,
                  fit: BoxFit.cover,
                  semanticLabel: context.t.book_cover_of(title: book.title),
                  errorBuilder: (_, _, _) => placeholder,
                ),
        ),
      ),
    );
  }
}

/// A book of the user: its cover, title and page count, and whether its PDF is ready
class BookCard extends StatelessWidget {
  final BookResponseDto book;
  final VoidCallback onTap;

  const BookCard({super.key, required this.book, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pdfReady = book.exportStatus == BookExportStatus.completed && !book.exportStale;
    final exporting = book.exportStatus == BookExportStatus.pending || book.exportStatus == BookExportStatus.running;

    return InkWell(
      key: ValueKey('book-${book.id}'),
      borderRadius: const BorderRadius.all(Radius.circular(12)),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            BookCover(book: book),
            const SizedBox(height: 8),
            Text(book.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall),
            if (book.subtitle?.isNotEmpty ?? false)
              Text(
                book.subtitle!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            const SizedBox(height: 2),
            Wrap(
              spacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  context.t.book_page_count(count: book.pageCount),
                  style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                if (pdfReady) _Badge(label: context.t.book_pdf_ready, color: theme.colorScheme.primary),
                if (exporting) _Badge(label: context.t.book_exporting_short, color: theme.colorScheme.tertiary),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;

  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: const BorderRadius.all(Radius.circular(8)),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      child: Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color)),
    ),
  );
}

/// A book drafted for the user ("Suggested for you"): why, and Keep or Discard
class BookDraftCard extends StatelessWidget {
  final BookDraftResponseDto draft;
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback onKeep;
  final VoidCallback onDiscard;

  const BookDraftCard({
    super.key,
    required this.draft,
    required this.busy,
    required this.onOpen,
    required this.onKeep,
    required this.onDiscard,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final book = draft.book;

    return DecoratedBox(
      key: ValueKey('book-draft-${draft.id}'),
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer.withValues(alpha: 0.25),
        borderRadius: const BorderRadius.all(Radius.circular(14)),
        border: Border.all(color: colorScheme.primary.withValues(alpha: 0.35)),
      ),
      child: InkWell(
        borderRadius: const BorderRadius.all(Radius.circular(14)),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 96, child: BookCover(book: book)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(book.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall),
                    const SizedBox(height: 4),
                    Text(
                      draft.reason,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        FilledButton(
                          key: ValueKey('book-draft-keep-${draft.id}'),
                          style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
                          onPressed: busy ? null : onKeep,
                          child: Text(context.t.book_draft_keep),
                        ),
                        OutlinedButton(
                          key: ValueKey('book-draft-discard-${draft.id}'),
                          style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact),
                          onPressed: busy ? null : onDiscard,
                          child: Text(context.t.book_draft_discard),
                        ),
                      ],
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

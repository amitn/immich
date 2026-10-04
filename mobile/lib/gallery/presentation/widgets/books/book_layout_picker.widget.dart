import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/books.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// The layouts a page can take, the closest to its [placedPhotos] first: a map page keeps to the map layouts, a photo
/// page to the others
List<BookLayoutResponseDto> bookLayoutChoices(
  List<BookLayoutResponseDto> layouts, {
  required int placedPhotos,
  bool mapPage = false,
}) {
  final choices = layouts.where((layout) => (layout.mapArea.orElse(null) != null) == mapPage).toList();
  int distance(BookLayoutResponseDto layout) {
    final slots = layout.slots.length;
    // fewer slots than photos drops photos: after every layout that keeps them
    return slots >= placedPhotos ? slots - placedPhotos : 100 + placedPhotos - slots;
  }

  choices.sort((a, b) {
    final byDistance = distance(a).compareTo(distance(b));
    return byDistance != 0 ? byDistance : a.name.compareTo(b.name);
  });
  return choices;
}

/// Picks a page layout in a bottom sheet; null when dismissed
Future<BookLayoutResponseDto?> showBookLayoutPicker(
  BuildContext context, {
  required int placedPhotos,
  String? currentLayout,
  bool mapPage = false,
  double pageRatio = 1,
  String? title,
}) => showModalBottomSheet<BookLayoutResponseDto>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  useSafeArea: true,
  builder: (context) => DraggableScrollableSheet(
    expand: false,
    initialChildSize: 0.7,
    maxChildSize: 0.95,
    builder: (context, scrollController) => _LayoutPicker(
      scrollController: scrollController,
      placedPhotos: placedPhotos,
      currentLayout: currentLayout,
      mapPage: mapPage,
      pageRatio: pageRatio,
      title: title ?? context.t.book_layouts,
    ),
  ),
);

class _LayoutPicker extends ConsumerWidget {
  final ScrollController scrollController;
  final int placedPhotos;
  final String? currentLayout;
  final bool mapPage;
  final double pageRatio;
  final String title;

  const _LayoutPicker({
    required this.scrollController,
    required this.placedPhotos,
    required this.currentLayout,
    required this.mapPage,
    required this.pageRatio,
    required this.title,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final theme = Theme.of(context);
    final layouts = ref.watch(bookLayoutsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Text(title, style: theme.textTheme.titleMedium),
        ),
        Expanded(
          child: layouts.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, _) => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                spacing: 8,
                children: [
                  Text(t.errors.unable_to_load_book_layouts),
                  TextButton(onPressed: () => ref.invalidate(bookLayoutsProvider), child: Text(t.retry)),
                ],
              ),
            ),
            data: (layouts) {
              final choices = bookLayoutChoices(layouts, placedPhotos: placedPhotos, mapPage: mapPage);
              return GridView.builder(
                key: const Key('book-layouts'),
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  maxCrossAxisExtent: 180,
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  childAspectRatio: 0.72,
                ),
                itemCount: choices.length,
                itemBuilder: (context, index) => _LayoutTile(
                  layout: choices[index],
                  placedPhotos: placedPhotos,
                  selected: choices[index].id == currentLayout,
                  pageRatio: pageRatio,
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _LayoutTile extends StatelessWidget {
  final BookLayoutResponseDto layout;
  final int placedPhotos;
  final bool selected;
  final double pageRatio;

  const _LayoutTile({
    required this.layout,
    required this.placedPhotos,
    required this.selected,
    required this.pageRatio,
  });

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final removed = placedPhotos - layout.slots.length;

    return Card(
      key: ValueKey('book-layout-${layout.id}'),
      clipBehavior: Clip.antiAlias,
      elevation: 0,
      color: selected ? colorScheme.primaryContainer : colorScheme.surfaceContainerHigh,
      child: InkWell(
        onTap: () => Navigator.of(context).pop(layout),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 4,
            children: [
              Expanded(
                child: Center(
                  child: AspectRatio(
                    aspectRatio: pageRatio,
                    child: CustomPaint(
                      painter: _LayoutPainter(
                        layout: layout,
                        page: colorScheme.surface,
                        slot: colorScheme.primary.withValues(alpha: 0.55),
                        text: colorScheme.onSurfaceVariant.withValues(alpha: 0.6),
                      ),
                    ),
                  ),
                ),
              ),
              Text(layout.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.labelLarge),
              Text(
                removed > 0
                    ? t.book_layout_removes_photos(count: removed)
                    : t.book_layout_photo_count(count: layout.slots.length),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(color: removed > 0 ? colorScheme.error : null),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A small drawing of a layout: its photo slots, text areas and map on the page
class _LayoutPainter extends CustomPainter {
  final BookLayoutResponseDto layout;
  final Color page;
  final Color slot;
  final Color text;

  const _LayoutPainter({required this.layout, required this.page, required this.slot, required this.text});

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = page);
    final inset = layout.fullBleed ? 0.0 : size.shortestSide * 0.07;
    final inner = Rect.fromLTWH(inset, inset, size.width - 2 * inset, size.height - 2 * inset);
    Rect place(num x, num y, num width, num height) => Rect.fromLTWH(
      inner.left + x * inner.width,
      inner.top + y * inner.height,
      width * inner.width,
      height * inner.height,
    );

    final map = layout.mapArea.orElse(null);
    if (map != null) {
      canvas.drawRect(place(map.x, map.y, map.width, map.height), Paint()..color = slot.withValues(alpha: 0.3));
    }
    for (final area in layout.slots) {
      canvas.drawRect(place(area.x, area.y, area.width, area.height), Paint()..color = slot);
    }
    final line = Paint()
      ..color = text
      ..strokeWidth = 1.5;
    for (final area in layout.textAreas) {
      final rect = place(area.x, area.y, area.width, area.height);
      final y = rect.center.dy;
      canvas.drawLine(Offset(rect.left, y), Offset(rect.left + rect.width * 0.8, y), line);
    }
  }

  @override
  bool shouldRepaint(_LayoutPainter oldDelegate) =>
      oldDelegate.layout.id != layout.id || oldDelegate.page != page || oldDelegate.slot != slot;
}

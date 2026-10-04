import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// The long edge, in pixels, of the page renders for this screen: sharp on the device, never larger than needed
int bookPageRenderSize(BuildContext context) {
  final size = MediaQuery.sizeOf(context);
  final ratio = MediaQuery.devicePixelRatioOf(context);
  return (size.longestSide * ratio).round().clamp(600, 2400);
}

/// The pages of a book, one per screen, turning around the spine as they are swiped. A tap opens the page full
/// screen to zoom in.
class BookPageView extends ConsumerWidget {
  final BookDetailResponseDto book;
  final PageController controller;
  final void Function(int index)? onPageChanged;

  const BookPageView({super.key, required this.book, required this.controller, this.onPageChanged});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final images = ref.watch(galleryImagesProvider);
    final renderSize = bookPageRenderSize(context);
    final ratio = book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1.0;
    final pages = [...book.pages]..sort((a, b) => a.position.compareTo(b.position));

    return PageView.builder(
      key: const Key('book-pages'),
      controller: controller,
      itemCount: pages.length,
      onPageChanged: onPageChanged,
      itemBuilder: (context, index) {
        final page = pages[index];
        final image = images.bookPage(book.id, page.id, size: renderSize, cacheKey: page.updatedAt);
        return AnimatedBuilder(
          animation: controller,
          builder: (context, child) {
            final position = controller.hasClients && controller.position.haveDimensions
                ? controller.page ?? controller.initialPage.toDouble()
                : controller.initialPage.toDouble();
            final delta = (index - position).clamp(-1.0, 1.0);
            // the page turns around its left edge, the spine, and darkens as it turns away
            return Transform(
              alignment: Alignment.centerLeft,
              transform: Matrix4.identity()
                ..setEntry(3, 2, 0.0012)
                ..rotateY(-delta * math.pi / 5),
              child: Opacity(opacity: 1 - delta.abs() * 0.35, child: child),
            );
          },
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: GestureDetector(
                onTap: () => unawaited(
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      fullscreenDialog: true,
                      builder: (_) => _ZoomedPage(
                        image: images.bookPage(book.id, page.id, size: 2400, cacheKey: page.updatedAt),
                        ratio: ratio,
                        title: context.t.book_page_of(page: index + 1, total: pages.length),
                      ),
                    ),
                  ),
                ),
                child: AspectRatio(
                  aspectRatio: ratio,
                  child: _PageImage(
                    key: ValueKey('book-page-${page.id}'),
                    image: image,
                    label: context.t.book_page_image(page: index + 1),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _PageImage extends StatelessWidget {
  final ImageProvider image;
  final String label;

  const _PageImage({super.key, required this.image, required this.label});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        boxShadow: [
          BoxShadow(color: colorScheme.shadow.withValues(alpha: 0.25), blurRadius: 12, offset: const Offset(0, 4)),
        ],
      ),
      child: Image(
        image: image,
        fit: BoxFit.contain,
        semanticLabel: label,
        gaplessPlayback: true,
        // a plain page while it loads: the renders come quickly, and a spinner per page would only flicker
        frameBuilder: (_, child, frame, wasSynchronouslyLoaded) =>
            wasSynchronouslyLoaded || frame != null ? child : const SizedBox.expand(),
        errorBuilder: (_, _, _) =>
            Center(child: Icon(Icons.broken_image_outlined, color: colorScheme.onSurfaceVariant)),
      ),
    );
  }
}

class _ZoomedPage extends StatelessWidget {
  final ImageProvider image;
  final double ratio;
  final String title;

  const _ZoomedPage({required this.image, required this.ratio, required this.title});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(title)),
      body: InteractiveViewer(
        maxScale: 6,
        child: Center(
          child: AspectRatio(
            aspectRatio: ratio,
            child: Image(image: image, fit: BoxFit.contain),
          ),
        ),
      ),
    );
  }
}

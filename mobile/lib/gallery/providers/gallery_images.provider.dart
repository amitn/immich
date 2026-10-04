import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:immich_mobile/gallery/repositories/book_offline_cache.repository.dart';
import 'package:immich_mobile/gallery/utils/book_page_image.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

/// The URL of a page of a photo book rendered as a JPEG, [size] pixels on its long edge (100 to 4000); [cacheKey]
/// changes with the page, so an edited page is fetched again
String bookPageRenderUrl(String bookId, String pageId, {int size = 1200, DateTime? cacheKey}) {
  final base = '${Store.get(StoreKey.serverEndpoint)}/books/$bookId/pages/$pageId/render?size=${size.clamp(100, 4000)}';
  return cacheKey == null ? base : '$base&c=${cacheKey.millisecondsSinceEpoch}';
}

/// The images the assistant screens load from the server, behind a provider so tests can serve them from memory
class GalleryImages {
  /// Where the page renders of the books are kept for offline viewing, and how they are rendered
  final BookOfflineCache? bookCache;
  final BookPageFetcher? fetchBookPage;

  const GalleryImages({this.bookCache, this.fetchBookPage});

  ImageProvider assetThumbnail(String assetId) => RemoteImageProvider(url: getThumbnailUrlForRemoteId(assetId));

  /// A photo at screen size, e.g. a menu or a wall label to read
  ImageProvider assetPreview(String assetId, {String? cacheKey}) => RemoteImageProvider(
    url: getThumbnailUrlForRemoteId(assetId, type: AssetMediaSize.preview, thumbhash: cacheKey),
  );

  /// The photo before and after auto enhance at [strength], side by side, rendered by the server
  ImageProvider enhancePreview(String assetId, EnhanceStrength strength) => RemoteImageProvider(
    url: '${Store.get(StoreKey.serverEndpoint)}/assets/$assetId/enhance/preview.jpg?strength=$strength',
  );

  /// A page of a book; with its [cacheKey] (the page's `updatedAt`) kept on the device, so the book opens offline
  ImageProvider bookPage(String bookId, String pageId, {required int size, DateTime? cacheKey}) {
    final cache = bookCache;
    final fetch = fetchBookPage;
    if (cache != null && fetch != null && cacheKey != null) {
      return BookPageImage(bookId: bookId, pageId: pageId, version: cacheKey, size: size, cache: cache, fetch: fetch);
    }
    return RemoteImageProvider(
      url: bookPageRenderUrl(bookId, pageId, size: size, cacheKey: cacheKey),
    );
  }

  /// Keeps every page of [book] on the device at [size], one after the other, so a book viewed once opens offline;
  /// stops at the first page the server can't render
  Future<void> keepBookOffline(BookDetailResponseDto book, {required int size}) async {
    final cache = bookCache;
    final fetch = fetchBookPage;
    if (cache == null || fetch == null || !await cache.isEnabled) {
      return;
    }
    final pages = [...book.pages]..sort((a, b) => a.position.compareTo(b.position));
    for (final page in pages) {
      if (await cache.hasPage(book.id, page.id, page.updatedAt, size: size)) {
        continue;
      }
      try {
        await cache.writePage(book.id, page.id, page.updatedAt, size, await fetch(book.id, page.id, size));
      } catch (_) {
        return;
      }
    }
  }
}

final galleryImagesProvider = Provider<GalleryImages>(
  (ref) => GalleryImages(
    bookCache: ref.watch(bookOfflineCacheProvider),
    fetchBookPage: (bookId, pageId, size) => ref.read(bookApiRepositoryProvider).renderPage(bookId, pageId, size: size),
  ),
);

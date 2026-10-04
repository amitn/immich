import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:immich_mobile/gallery/repositories/book_offline_cache.repository.dart';

/// Renders a page of a book on the server, as JPEG bytes
typedef BookPageFetcher = Future<Uint8List> Function(String bookId, String pageId, int size);

/// Loads a page render through the offline cache: the kept render of this version of the page, else the server's
/// (kept for next time), else offline the largest kept render of the page at another size
Future<Uint8List> loadBookPageBytes(
  BookOfflineCache cache,
  BookPageFetcher fetch, {
  required String bookId,
  required String pageId,
  required DateTime version,
  required int size,
}) async {
  final kept = await cache.readPage(bookId, pageId, version, size: size);
  if (kept != null) {
    return kept;
  }
  try {
    final bytes = await fetch(bookId, pageId, size);
    await cache.writePage(bookId, pageId, version, size, bytes);
    return bytes;
  } catch (_) {
    final other = await cache.readPage(bookId, pageId, version, size: size, anySize: true);
    if (other != null) {
      return other;
    }
    rethrow;
  }
}

/// A page of a photo book, rendered by the server and kept on the device for offline viewing
@immutable
class BookPageImage extends ImageProvider<BookPageImage> {
  final String bookId;
  final String pageId;

  /// The page's `updatedAt`: an edited page is a new image
  final DateTime version;
  final int size;
  final BookOfflineCache cache;
  final BookPageFetcher fetch;

  const BookPageImage({
    required this.bookId,
    required this.pageId,
    required this.version,
    required this.size,
    required this.cache,
    required this.fetch,
  });

  @override
  Future<BookPageImage> obtainKey(ImageConfiguration configuration) => SynchronousFuture(this);

  @override
  ImageStreamCompleter loadImage(BookPageImage key, ImageDecoderCallback decode) => MultiFrameImageStreamCompleter(
    codec: _load(key, decode),
    scale: 1,
    debugLabel: 'book page $bookId/$pageId@$size',
  );

  Future<ui.Codec> _load(BookPageImage key, ImageDecoderCallback decode) async {
    final bytes = await loadBookPageBytes(
      key.cache,
      key.fetch,
      bookId: key.bookId,
      pageId: key.pageId,
      version: key.version,
      size: key.size,
    );
    return decode(await ui.ImmutableBuffer.fromUint8List(bytes));
  }

  @override
  bool operator ==(Object other) =>
      other is BookPageImage &&
      other.bookId == bookId &&
      other.pageId == pageId &&
      other.version == version &&
      other.size == size;

  @override
  int get hashCode => Object.hash(bookId, pageId, version, size);
}

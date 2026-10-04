import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';
import 'package:path_provider/path_provider.dart';

/// The books the user opened, kept on the device so a book viewed once opens offline: each book's pages and slots
/// (`book.json`) and its page renders, `<pageId>_<page updatedAt>_<size>.jpg`.
///
/// - A page's file name carries the page's `updatedAt`, so an edited page is never served from an old render.
/// - When a newer version of a book is saved (e.g. its `updatedAt` changed after an edit), the renders of the pages
///   that changed or are gone are deleted.
/// - The renders are evicted least recently used (a read touches the file) once they take more than [maxBytes]; a
///   book without any render left is dropped as a whole.
///
/// Every operation is best effort: a device without a cache directory (or a failing disk) only loses the offline
/// copy, never the online book.
class BookOfflineCache {
  static final _log = Logger('BookOfflineCache');
  static const _bookFile = 'book.json';

  final Future<Directory?> Function() directory;
  final int maxBytes;
  final DateTime Function() _now;

  Future<Directory?>? _root;

  BookOfflineCache({required this.directory, this.maxBytes = 200 * 1024 * 1024, DateTime Function()? now})
    : _now = now ?? DateTime.now;

  /// A cache that keeps nothing, e.g. where the device has no cache directory
  BookOfflineCache.disabled() : this(directory: () async => null);

  Future<Directory?> get _base => _root ??= _resolve();

  Future<Directory?> _resolve() async {
    try {
      return await directory();
    } catch (error) {
      _log.fine('No cache directory for offline books', error);
      return null;
    }
  }

  Future<Directory?> _bookDir(String bookId) async {
    final base = await _base;
    // ids come from the server: keep them to a safe file name
    final safe = bookId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '');
    return base == null || safe.isEmpty ? null : Directory('${base.path}/$safe');
  }

  static String _safe(String id) => id.replaceAll(RegExp(r'[^A-Za-z0-9-]'), '');

  static String _pagePrefix(String pageId, DateTime version) => '${_safe(pageId)}_${version.millisecondsSinceEpoch}_';

  /// The book as it was last seen online, or null
  Future<BookDetailResponseDto?> loadBook(String bookId) async {
    try {
      final dir = await _bookDir(bookId);
      final file = dir == null ? null : File('${dir.path}/$_bookFile');
      if (file == null || !file.existsSync()) {
        return null;
      }
      return BookDetailResponseDto.fromJson(jsonDecode(await file.readAsString()));
    } catch (error, stackTrace) {
      _log.warning('Unable to read the offline copy of book $bookId', error, stackTrace);
      return null;
    }
  }

  /// Keeps [book] for offline viewing, and drops the renders of its pages that changed or are gone
  Future<void> saveBook(BookDetailResponseDto book) async {
    try {
      final dir = await _bookDir(book.id);
      if (dir == null) {
        return;
      }
      await dir.create(recursive: true);
      await File('${dir.path}/$_bookFile').writeAsString(jsonEncode(book.toJson()), flush: true);
      final current = {for (final page in book.pages) _pagePrefix(page.id, page.updatedAt)};
      await for (final entity in dir.list()) {
        final name = entity.uri.pathSegments.last;
        if (entity is File && name.endsWith('.jpg') && !current.any(name.startsWith)) {
          await entity.delete();
        }
      }
    } catch (error, stackTrace) {
      _log.warning('Unable to keep book ${book.id} for offline viewing', error, stackTrace);
    }
  }

  /// The render of a page at [size]; with [anySize], the largest render of this version of the page when there is
  /// none at [size] (e.g. offline, the zoomed page shows the render made for the screen)
  Future<Uint8List?> readPage(
    String bookId,
    String pageId,
    DateTime version, {
    required int size,
    bool anySize = false,
  }) async {
    try {
      final dir = await _bookDir(bookId);
      if (dir == null || !dir.existsSync()) {
        return null;
      }
      final prefix = _pagePrefix(pageId, version);
      var file = File('${dir.path}/$prefix$size.jpg');
      if (!file.existsSync()) {
        if (!anySize) {
          return null;
        }
        File? best;
        var bestSize = -1;
        await for (final entity in dir.list()) {
          final name = entity.uri.pathSegments.last;
          if (entity is File && name.startsWith(prefix) && name.endsWith('.jpg')) {
            final candidate = int.tryParse(name.substring(prefix.length, name.length - 4)) ?? 0;
            if (candidate > bestSize) {
              best = entity;
              bestSize = candidate;
            }
          }
        }
        if (best == null) {
          return null;
        }
        file = best;
      }
      final bytes = await file.readAsBytes();
      // a read makes the render the most recently used
      unawaited(file.setLastModified(_now()).catchError((_) {}));
      return bytes;
    } catch (error, stackTrace) {
      _log.warning('Unable to read an offline page of book $bookId', error, stackTrace);
      return null;
    }
  }

  /// Keeps the render of a page, then evicts the least recently used renders over [maxBytes]
  Future<void> writePage(String bookId, String pageId, DateTime version, int size, Uint8List bytes) async {
    try {
      final dir = await _bookDir(bookId);
      if (dir == null) {
        return;
      }
      await dir.create(recursive: true);
      final file = File('${dir.path}/${_pagePrefix(pageId, version)}$size.jpg');
      await file.writeAsBytes(bytes, flush: true);
      await file.setLastModified(_now());
      await evict();
    } catch (error, stackTrace) {
      _log.warning('Unable to keep an offline page of book $bookId', error, stackTrace);
    }
  }

  /// Whether a render of this version of a page is kept at [size]
  Future<bool> hasPage(String bookId, String pageId, DateTime version, {required int size}) async {
    try {
      final dir = await _bookDir(bookId);
      return dir != null && File('${dir.path}/${_pagePrefix(pageId, version)}$size.jpg').existsSync();
    } catch (_) {
      return false;
    }
  }

  /// Deletes the least recently used renders until they take at most [maxBytes], and the books left without any
  Future<void> evict() async {
    final base = await _base;
    if (base == null || !base.existsSync()) {
      return;
    }
    final renders = <(File, int, DateTime)>[];
    final books = <Directory>[];
    await for (final entity in base.list()) {
      if (entity is! Directory) {
        continue;
      }
      books.add(entity);
      await for (final file in entity.list()) {
        if (file is File && file.path.endsWith('.jpg')) {
          final stat = file.statSync();
          renders.add((file, stat.size, stat.modified));
        }
      }
    }

    var total = renders.fold<int>(0, (sum, render) => sum + render.$2);
    if (total > maxBytes) {
      renders.sort((a, b) => a.$3.compareTo(b.$3));
      for (final (file, size, _) in renders) {
        if (total <= maxBytes) {
          break;
        }
        await file.delete();
        total -= size;
      }
    }

    for (final dir in books) {
      final hasRender = await dir.list().any((file) => file.path.endsWith('.jpg'));
      if (!hasRender) {
        await dir.delete(recursive: true);
      }
    }
  }

  /// Whether the device has a place to keep books
  Future<bool> get isEnabled async => await _base != null;

  /// The space the renders take
  Future<int> sizeInBytes() async {
    final base = await _base;
    if (base == null || !base.existsSync()) {
      return 0;
    }
    var total = 0;
    await for (final file in base.list(recursive: true)) {
      if (file is File) {
        total += file.lengthSync();
      }
    }
    return total;
  }
}

final bookOfflineCacheProvider = Provider<BookOfflineCache>(
  (ref) => BookOfflineCache(
    directory: () async => Directory('${(await getApplicationCacheDirectory()).path}/gallery_books'),
  ),
);

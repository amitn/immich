import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/repositories/book_offline_cache.repository.dart';
import 'package:immich_mobile/gallery/utils/book_page_image.dart';
import 'package:openapi/api.dart';

import '../book_fixtures.dart';

BookDetailResponseDto _book({String updatedAt = '2026-09-27T09:58:05.491Z', Map<String, String> pages = const {}}) =>
    BookDetailResponseDto.fromJson({
      ...bookJson('book-1', updatedAt: updatedAt, pageCount: pages.length),
      'pages': [
        for (final (index, entry) in pages.entries.indexed) {...pageJson(entry.key, index), 'updatedAt': entry.value},
      ],
    })!;

void main() {
  late Directory root;
  late DateTime clock;
  late BookOfflineCache cache;

  final v1 = DateTime.parse('2026-09-27T09:58:05.491Z');
  final v2 = DateTime.parse('2026-09-28T10:00:00.000Z');
  Uint8List bytes(int length, [int fill = 1]) => Uint8List.fromList(List.filled(length, fill));

  setUp(() {
    root = Directory.systemTemp.createTempSync('gallery-books-');
    clock = DateTime(2026, 10, 1, 12);
    cache = BookOfflineCache(directory: () async => root, maxBytes: 1000, now: () => clock);
  });

  tearDown(() => root.deleteSync(recursive: true));

  test('keeps a book and its page renders for offline viewing', () async {
    await cache.saveBook(_book(pages: {'page-1': v1.toIso8601String()}));
    await cache.writePage('book-1', 'page-1', v1, 1200, bytes(10, 7));

    final kept = await cache.loadBook('book-1');
    expect(kept?.title, 'Sicily 2009');
    expect(kept?.pages.single.id, 'page-1');
    expect(await cache.readPage('book-1', 'page-1', v1, size: 1200), bytes(10, 7));
    expect(await cache.hasPage('book-1', 'page-1', v1, size: 1200), isTrue);
  });

  test('never serves the render of an older version of a page', () async {
    await cache.writePage('book-1', 'page-1', v1, 1200, bytes(10));
    expect(await cache.readPage('book-1', 'page-1', v2, size: 1200), isNull);
  });

  test('offline, a render at another size of the same version stands in, the largest first', () async {
    await cache.writePage('book-1', 'page-1', v1, 800, bytes(8, 8));
    await cache.writePage('book-1', 'page-1', v1, 1200, bytes(12, 12));
    expect(await cache.readPage('book-1', 'page-1', v1, size: 2400), isNull);
    expect(await cache.readPage('book-1', 'page-1', v1, size: 2400, anySize: true), bytes(12, 12));
  });

  test('a newer version of the book drops the renders of pages that changed or are gone', () async {
    await cache.saveBook(_book(pages: {'page-1': v1.toIso8601String(), 'page-2': v1.toIso8601String()}));
    await cache.writePage('book-1', 'page-1', v1, 1200, bytes(10));
    await cache.writePage('book-1', 'page-2', v1, 1200, bytes(10));

    // page 1 was edited, page 2 removed
    await cache.saveBook(_book(updatedAt: v2.toIso8601String(), pages: {'page-1': v2.toIso8601String()}));

    expect(await cache.hasPage('book-1', 'page-1', v1, size: 1200), isFalse);
    expect(await cache.hasPage('book-1', 'page-2', v1, size: 1200), isFalse);
    expect((await cache.loadBook('book-1'))?.updatedAt, v2);
  });

  test('evicts the least recently used renders over the limit, and books left without any', () async {
    await cache.saveBook(_book(pages: {'page-1': v1.toIso8601String()}));
    await cache.writePage('book-1', 'page-1', v1, 1200, bytes(400));
    clock = clock.add(const Duration(minutes: 1));
    await cache.writePage('book-2', 'page-a', v1, 1200, bytes(400));
    clock = clock.add(const Duration(minutes: 1));
    // reading book 1 makes it the most recently used
    await cache.readPage('book-1', 'page-1', v1, size: 1200);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    clock = clock.add(const Duration(minutes: 1));
    await cache.writePage('book-3', 'page-x', v1, 1200, bytes(400));

    expect(await cache.hasPage('book-1', 'page-1', v1, size: 1200), isTrue);
    expect(await cache.hasPage('book-2', 'page-a', v1, size: 1200), isFalse);
    expect(await cache.hasPage('book-3', 'page-x', v1, size: 1200), isTrue);
    expect(Directory('${root.path}/book-2').existsSync(), isFalse);
  });

  test('a device without a cache directory keeps nothing and fails nothing', () async {
    final disabled = BookOfflineCache(directory: () async => throw const FileSystemException('no cache'));
    await disabled.saveBook(_book());
    await disabled.writePage('book-1', 'page-1', v1, 1200, bytes(10));
    expect(await disabled.loadBook('book-1'), isNull);
    expect(await disabled.readPage('book-1', 'page-1', v1, size: 1200), isNull);
    expect(await disabled.isEnabled, isFalse);
  });

  group('loadBookPageBytes', () {
    test('fetches a page once, then serves it from the device', () async {
      var fetches = 0;
      Future<Uint8List> fetch(String bookId, String pageId, int size) async {
        fetches++;
        return bytes(5, 5);
      }

      for (var i = 0; i < 2; i++) {
        final loaded = await loadBookPageBytes(
          cache,
          fetch,
          bookId: 'book-1',
          pageId: 'page-1',
          version: v1,
          size: 900,
        );
        expect(loaded, bytes(5, 5));
      }
      expect(fetches, 1);
    });

    test('offline, falls back to a kept render at another size, else fails', () async {
      Future<Uint8List> offline(String bookId, String pageId, int size) async => throw const SocketException('offline');
      await cache.writePage('book-1', 'page-1', v1, 900, bytes(9, 9));

      expect(
        await loadBookPageBytes(cache, offline, bookId: 'book-1', pageId: 'page-1', version: v1, size: 2400),
        bytes(9, 9),
      );
      await expectLater(
        loadBookPageBytes(cache, offline, bookId: 'book-1', pageId: 'page-2', version: v1, size: 2400),
        throwsA(isA<SocketException>()),
      );
    });
  });
}

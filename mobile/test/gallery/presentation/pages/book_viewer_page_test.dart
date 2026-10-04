import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/pages/book_viewer.page.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:immich_mobile/gallery/repositories/book_offline_cache.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../book_fixtures.dart';
import '../../gallery_test_helpers.dart';

class _MockBookApiRepository extends Mock implements BookApiRepository {}

/// Keeps the books in memory, like the device would
class _MemoryBookCache extends BookOfflineCache {
  final books = <String, BookDetailResponseDto>{};

  _MemoryBookCache() : super(directory: () async => null);

  @override
  Future<void> saveBook(BookDetailResponseDto book) async => books[book.id] = book;

  @override
  Future<BookDetailResponseDto?> loadBook(String bookId) async => books[bookId];
}

void main() {
  late _MockBookApiRepository repository;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;
  late FakeGalleryImages images;
  late List<(String, int)> savedPdfs;
  late _MemoryBookCache cache;

  setUp(() {
    repository = _MockBookApiRepository();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    images = FakeGalleryImages();
    savedPdfs = [];
    cache = _MemoryBookCache();
  });

  tearDown(() => bus.dispose());

  Future<void> pumpPage(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpConsumerWidget(
      const BookViewerPage(bookId: 'book-1'),
      overrides: [
        ...galleryOverrides(navigator: navigator, toast: toast, images: images, bookCache: cache),
        bookApiRepositoryProvider.overrideWithValue(repository),
        galleryEventBusProvider.overrideWithValue(bus),
        bookPdfSaverProvider.overrideWithValue((title, bytes) async => savedPdfs.add((title, bytes.length))),
      ],
    );
  }

  testWidgets('shows the pages in order, rendered for the screen, and turns them', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    await pumpPage(tester);

    expect(find.text('Sicily 2009'), findsOneWidget);
    expect(find.text('Page 1 of 3'), findsOneWidget);
    expect(find.byKey(const ValueKey('book-page-page-1')), findsOneWidget);
    expect(images.requested.where((image) => image.startsWith('page:book-1/page-1@')), isNotEmpty);

    await tester.drag(find.byKey(const Key('book-pages')), const Offset(-300, 0));
    await tester.pumpAndSettle();
    expect(find.text('Page 2 of 3'), findsOneWidget);
    expect(find.byKey(const ValueKey('book-page-page-2')), findsOneWidget);

    await tester.tap(find.byKey(const Key('book-next-page')));
    await tester.pumpAndSettle();
    expect(find.text('Page 3 of 3'), findsOneWidget);
    expect(tester.widget<IconButton>(find.byKey(const Key('book-next-page'))).onPressed, isNull);

    await tester.tap(find.byKey(const Key('book-previous-page')));
    await tester.pumpAndSettle();
    expect(find.text('Page 2 of 3'), findsOneWidget);
  });

  testWidgets('a page opens full screen to zoom in', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    await pumpPage(tester);

    await tester.tap(find.byKey(const ValueKey('book-page-page-1')));
    await tester.pumpAndSettle();

    expect(find.byType(InteractiveViewer), findsOneWidget);
    expect(images.requested, contains('page:book-1/page-1@2400'));
  });

  testWidgets('the review lists the issues by severity, the people and the photos, read only', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    when(() => repository.getReview('book-1')).thenAnswer((_) async => review());
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-review-button')));
    await tester.pumpAndSettle();

    expect(find.text('Book review'), findsOneWidget);
    expect(find.text('1 must fix, 1 should fix, 0 could be better'), findsOneWidget);
    expect(find.text('Must fix'), findsOneWidget);
    expect(find.text('The photo on page 2 prints at 120 dpi'), findsOneWidget);
    expect(find.text('Pages 1 and 3 use the same layout'), findsOneWidget);
    expect(find.text('Anna'), findsOneWidget);

    // a page of an issue turns the book to it
    await tester.tap(find.widgetWithText(ActionChip, 'Page 2'));
    await tester.pumpAndSettle();
    expect(find.text('Book review'), findsNothing);
    expect(find.text('Page 2 of 3'), findsOneWidget);
  });

  testWidgets('Share opens the link page of the book', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-share-button')));
    await tester.pump();

    expect(navigator.calls, ['share book book-1']);
  });

  testWidgets('Download PDF downloads an up-to-date export right away', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1', exportStatus: 'completed'));
    when(() => repository.downloadPdf('book-1')).thenAnswer((_) async => Uint8List(42));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download PDF'));
    await tester.pumpAndSettle();

    verifyNever(() => repository.exportPdf(any()));
    expect(savedPdfs, [('Sicily 2009', 42)]);
  });

  testWidgets('Download PDF exports an outdated book first, and waits for it', (tester) async {
    var polls = 0;
    when(() => repository.getBook('book-1')).thenAnswer((_) async {
      polls++;
      // an outdated export, then the new one running, then done
      return switch (polls) {
        1 => bookDetail('book-1', exportStatus: 'completed', exportStale: true),
        2 => bookDetail('book-1', exportStatus: 'running'),
        _ => bookDetail('book-1', exportStatus: 'completed'),
      };
    });
    when(() => repository.exportPdf('book-1')).thenAnswer((_) async {});
    when(() => repository.downloadPdf('book-1')).thenAnswer((_) async => Uint8List(7));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download PDF'));
    await tester.pump();

    // the first poll: still running
    expect(find.byKey(const Key('book-exporting')), findsOneWidget);
    expect(find.text('Exporting PDF…'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();

    verify(() => repository.exportPdf('book-1')).called(1);
    expect(savedPdfs, [('Sicily 2009', 7)]);
    expect(find.byKey(const Key('book-exporting')), findsNothing);
  });

  testWidgets('a failed export says so', (tester) async {
    var polls = 0;
    when(() => repository.getBook('book-1')).thenAnswer((_) async {
      polls++;
      return bookDetail('book-1', exportStatus: polls == 1 ? null : 'failed');
    });
    when(() => repository.exportPdf('book-1')).thenAnswer((_) async {});
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download PDF'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();

    expect(toast.errors, ['Export failed']);
    expect(savedPdfs, isEmpty);
  });

  testWidgets('a suggested book can be kept from the viewer', (tester) async {
    var kept = false;
    when(
      () => repository.getBook('book-1'),
    ).thenAnswer((_) async => bookDetail('book-1', status: kept ? 'active' : 'draft'));
    when(() => repository.keepDraft('book-1')).thenAnswer((_) async {
      kept = true;
      return book('book-1');
    });
    await pumpPage(tester);

    expect(find.byKey(const Key('book-draft-banner')), findsOneWidget);
    await tester.tap(find.byKey(const Key('book-draft-banner-keep')));
    await tester.pumpAndSettle();

    verify(() => repository.keepDraft('book-1')).called(1);
    expect(find.byKey(const Key('book-draft-banner')), findsNothing);
  });

  testWidgets('Edit with assistant opens a chat about the book', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit with assistant'));
    await tester.pumpAndSettle();

    expect(navigator.calls.single, contains('"Sicily 2009" (book id: book-1)'));
  });

  testWidgets('a book without pages says so', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1', pages: 0));
    await pumpPage(tester);

    expect(find.text('This photo book has no pages yet.'), findsOneWidget);
    expect(find.byKey(const Key('book-page-indicator')), findsNothing);
  });

  testWidgets('a failed load can be retried', (tester) async {
    var calls = 0;
    when(() => repository.getBook('book-1')).thenAnswer((_) async {
      if (calls++ == 0) {
        throw ApiException(500, 'boom');
      }
      return bookDetail('book-1');
    });
    await pumpPage(tester);

    expect(find.text('Unable to load the photo book'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Page 1 of 3'), findsOneWidget);
  });

  testWidgets('Edit opens the editor on the page shown', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-next-page')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-edit-button')));
    await tester.pump();

    expect(navigator.calls, ['edit book book-1 page page-2']);
  });

  testWidgets('a book without pages offers to add the first one', (tester) async {
    var book = bookDetail('book-1', pages: 0);
    when(() => repository.getBook('book-1')).thenAnswer((_) async => book);
    when(() => repository.getLayouts()).thenAnswer((_) async => [layout('single', 'Single', 1)]);
    when(() => repository.addPage('book-1', 'single', position: 0)).thenAnswer((_) async {
      book = bookDetail('book-1', pages: 1);
      return editablePage('page-1', 0, layout: 'single');
    });
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-add-first-page')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('book-layout-single')));
    await tester.pumpAndSettle();

    verify(() => repository.addPage('book-1', 'single', position: 0)).called(1);
    expect(navigator.calls, ['edit book book-1 page page-1']);
  });

  testWidgets('Open in browser opens the web editor', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-open-on-web')));
    await tester.pumpAndSettle();

    expect(navigator.calls, ['book on web book-1']);
  });

  testWidgets('a book viewed once opens offline, read only', (tester) async {
    when(() => repository.getBook('book-1')).thenAnswer((_) async => bookDetail('book-1'));
    await pumpPage(tester);
    expect(cache.books['book-1']?.pages, hasLength(3));

    // the server can't be reached the next time
    await tester.pumpWidget(const SizedBox());
    when(() => repository.getBook('book-1')).thenThrow(ApiException(503, 'offline'));
    images.requested.clear();
    await pumpPage(tester);

    expect(find.byKey(const Key('book-offline')), findsOneWidget);
    expect(find.text('Page 1 of 3'), findsOneWidget);
    expect(images.requested.where((image) => image.startsWith('page:book-1/page-1@')), isNotEmpty);
    expect(find.byKey(const Key('book-edit-button')), findsNothing);
    expect(find.byKey(const Key('book-share-button')), findsNothing);
  });

  testWidgets('a book that is gone from the server is not shown from the device', (tester) async {
    cache.books['book-1'] = bookDetail('book-1');
    when(() => repository.getBook('book-1')).thenThrow(ApiException(404, 'Not found'));
    await pumpPage(tester);

    expect(find.text('Unable to load the photo book'), findsOneWidget);
    expect(find.byKey(const Key('book-offline')), findsNothing);
  });
}

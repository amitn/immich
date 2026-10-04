import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/pages/books.page.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../book_fixtures.dart';
import '../../gallery_test_helpers.dart';

class _MockBookApiRepository extends Mock implements BookApiRepository {}

void main() {
  late _MockBookApiRepository repository;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;
  late FakeGalleryImages images;

  setUp(() {
    repository = _MockBookApiRepository();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    images = FakeGalleryImages();
  });

  tearDown(() => bus.dispose());

  Future<void> pumpPage(WidgetTester tester, {GalleryFeatures features = const GalleryFeatures(assistant: true)}) =>
      tester.pumpConsumerWidget(
        const BooksPage(),
        overrides: [
          ...galleryOverrides(features: features, navigator: navigator, toast: toast, images: images),
          bookApiRepositoryProvider.overrideWithValue(repository),
          galleryEventBusProvider.overrideWithValue(bus),
        ],
      );

  testWidgets('lists the books with their covers, and opens one', (tester) async {
    when(
      () => repository.getBooks(),
    ).thenAnswer((_) async => [book('book-1', exportStatus: 'completed'), book('book-2', title: 'Crete')]);
    when(() => repository.getDrafts()).thenAnswer((_) async => []);
    await pumpPage(tester);

    expect(find.text('Sicily 2009'), findsOneWidget);
    expect(find.text('Crete'), findsOneWidget);
    expect(find.text('3 pages'), findsNWidgets(2));
    expect(find.text('PDF ready'), findsOneWidget);
    expect(find.text('Suggested for you'), findsNothing);
    expect(images.requested, contains('page:book-1/page-1@600'));

    await tester.tap(find.text('Crete'));
    await tester.pump();
    expect(navigator.calls, ['book book-2']);
  });

  testWidgets('Keep moves a suggested book to the books', (tester) async {
    when(() => repository.getBooks()).thenAnswer((_) async => [book('book-1')]);
    when(() => repository.getDrafts()).thenAnswer((_) async => [draft('draft-1', 'book-9')]);
    when(() => repository.keepDraft('book-9')).thenAnswer((_) async => book('book-9', title: 'Crete, October 2016'));
    await pumpPage(tester);

    expect(find.text('Suggested for you'), findsOneWidget);
    expect(find.text('Your trip to Crete, with 84 photos'), findsOneWidget);
    expect(find.text('Your books'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('book-draft-keep-draft-1')));
    await tester.pumpAndSettle();

    verify(() => repository.keepDraft('book-9')).called(1);
    expect(find.text('Suggested for you'), findsNothing);
    expect(find.byKey(const ValueKey('book-book-9')), findsOneWidget);
    expect(toast.successes, ['"Crete, October 2016" is now one of your books']);
  });

  testWidgets('Discard asks first, then removes the suggestion', (tester) async {
    when(() => repository.getBooks()).thenAnswer((_) async => []);
    when(() => repository.getDrafts()).thenAnswer((_) async => [draft('draft-1', 'book-9')]);
    when(() => repository.discardDraft('book-9')).thenAnswer((_) async {});
    await pumpPage(tester);

    await tester.tap(find.byKey(const ValueKey('book-draft-discard-draft-1')));
    await tester.pumpAndSettle();
    expect(find.textContaining("won't be suggested again"), findsOneWidget);

    await tester.tap(find.byKey(const Key('gallery-confirm')));
    await tester.pumpAndSettle();

    verify(() => repository.discardDraft('book-9')).called(1);
    expect(find.byKey(const ValueKey('book-draft-draft-1')), findsNothing);
    expect(find.text('No photo books yet'), findsOneWidget);
  });

  testWidgets('a failed Keep says so and keeps the suggestion', (tester) async {
    when(() => repository.getBooks()).thenAnswer((_) async => []);
    when(() => repository.getDrafts()).thenAnswer((_) async => [draft('draft-1', 'book-9')]);
    when(() => repository.keepDraft('book-9')).thenThrow(ApiException(500, 'boom'));
    await pumpPage(tester);

    await tester.tap(find.byKey(const ValueKey('book-draft-keep-draft-1')));
    await tester.pumpAndSettle();

    expect(toast.errors, ['Unable to keep the book']);
    expect(find.byKey(const ValueKey('book-draft-draft-1')), findsOneWidget);
  });

  testWidgets('an empty list offers to create a book with the assistant', (tester) async {
    when(() => repository.getBooks()).thenAnswer((_) async => []);
    when(() => repository.getDrafts()).thenAnswer((_) async => []);
    await pumpPage(tester);

    expect(find.text('No photo books yet'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Create with assistant'));
    await tester.pump();

    expect(navigator.calls.single, startsWith('assistant session=null assets= prompt=Make a photo book'));
  });

  testWidgets('a notification about a book reloads the list', (tester) async {
    when(() => repository.getBooks()).thenAnswer((_) async => []);
    when(() => repository.getDrafts()).thenAnswer((_) async => []);
    await pumpPage(tester);

    when(() => repository.getDrafts()).thenAnswer((_) async => [draft('draft-1', 'book-9')]);
    bus.addNotification({
      'id': 'n1',
      'title': 'A new photo book is ready to review: Crete',
      'level': 'info',
      'type': 'Custom',
      'createdAt': '2026-09-27T09:32:30.753Z',
      'data': '{"bookId":"book-9"}',
    });
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('book-draft-draft-1')), findsOneWidget);
  });
}

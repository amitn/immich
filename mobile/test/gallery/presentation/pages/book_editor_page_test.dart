import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/pages/book_editor.page.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../book_fixtures.dart';
import '../../gallery_test_helpers.dart';

class _MockBookApiRepository extends Mock implements BookApiRepository {}

AssetResponseDto _asset(String id) => AssetResponseDto(
  id: id,
  ownerId: 'user-1',
  checksum: 'checksum-$id',
  createdAt: DateTime.utc(2020, 5, 1),
  fileCreatedAt: DateTime.utc(2019, 8, 17),
  fileModifiedAt: DateTime.utc(2019, 8, 17),
  localDateTime: DateTime.utc(2019, 8, 17),
  updatedAt: DateTime.utc(2020, 5, 1),
  duration: null,
  hasMetadata: true,
  height: 1080,
  width: 1920,
  isArchived: false,
  isEdited: false,
  isFavorite: false,
  isOffline: false,
  isTrashed: false,
  originalFileName: '$id.jpg',
  originalPath: '/upload/$id.jpg',
  thumbhash: 'hash-$id',
  type: AssetTypeEnum.IMAGE,
  visibility: AssetVisibility.timeline,
);

void main() {
  late _MockBookApiRepository repository;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;
  late BookDetailResponseDto book;

  final page1 = editablePage('page-1', 0, sectionTitle: 'Day 1');
  final page2 = editablePage(
    'page-2',
    1,
    layout: 'single',
    slots: [slotJson(0, assetId: 'asset-2')],
  );

  setUpAll(() {
    registerFallbackValue(NormalizedRect(x: 0, y: 0, width: 1, height: 1));
    registerFallbackValue(const Optional<String?>.absent());
    registerFallbackValue(const Optional<NormalizedRect?>.absent());
  });

  setUp(() {
    repository = _MockBookApiRepository();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    book = editableBook([page1, page2]);
    when(() => repository.getBook('book-1')).thenAnswer((_) async => book);
    when(() => repository.getLayouts()).thenAnswer(
      (_) async => [
        layout('single', 'Single', 1),
        layout('two-up', 'Two side by side', 2),
        layout('three', 'Three in a row', 3),
        layout('map', 'Map', 0, map: true),
      ],
    );
  });

  Future<void> pumpEditor(WidgetTester tester, {String pageId = 'page-1'}) async {
    await tester.binding.setSurfaceSize(const Size(420, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpConsumerWidget(
      BookEditorPage(bookId: 'book-1', pageId: pageId),
      overrides: [
        ...galleryOverrides(navigator: navigator, toast: toast),
        bookApiRepositoryProvider.overrideWithValue(repository),
      ],
    );
  }

  testWidgets('shows the page: its layout, section title and photo slots', (tester) async {
    await pumpEditor(tester);

    expect(find.text('Page 1 of 2'), findsOneWidget);
    expect(find.byKey(const ValueKey('book-editor-page-page-1')), findsOneWidget);
    expect(find.text('Two side by side'), findsOneWidget);
    expect(find.text('Day 1'), findsOneWidget);
    expect(find.text('Page 1, photo 1'), findsOneWidget);
    expect(find.text('Page 1, empty slot 2'), findsOneWidget);

    await tester.tap(find.byKey(const Key('book-editor-next')));
    await tester.pumpAndSettle();
    expect(find.text('Page 2 of 2'), findsOneWidget);
    expect(find.text('Single'), findsOneWidget);
  });

  testWidgets('changes the layout; one that drops photos says so', (tester) async {
    when(() => repository.updatePage('book-1', 'page-1', layout: 'three')).thenAnswer(
      (_) async => editablePage(
        'page-1',
        0,
        layout: 'three',
        updatedAt: '2026-09-28T10:00:00.000Z',
        slots: [
          slotJson(0, assetId: 'asset-1'),
          slotJson(1),
          slotJson(2),
        ],
      ),
    );
    await pumpEditor(tester);

    await tester.tap(find.byKey(const Key('book-page-layout')));
    await tester.pumpAndSettle();
    // photo layouts only, the closest to the page's one photo first; the map layout is for map pages
    expect(find.byKey(const ValueKey('book-layout-map')), findsNothing);
    expect(find.text('Removes 1 photo'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('book-layout-three')));
    await tester.pumpAndSettle();

    verify(() => repository.updatePage('book-1', 'page-1', layout: 'three')).called(1);
    expect(find.text('Three in a row'), findsOneWidget);
    expect(find.byKey(const ValueKey('book-slot-2')), findsOneWidget);
  });

  testWidgets('edits the section title, and an empty one clears it', (tester) async {
    when(
      () => repository.updatePage('book-1', 'page-1', sectionTitle: any(named: 'sectionTitle')),
    ).thenAnswer((_) async => editablePage('page-1', 0));
    await pumpEditor(tester);

    await tester.tap(find.byKey(const Key('book-page-section-title')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('gallery-text-field')), '  ');
    await tester.tap(find.byKey(const Key('gallery-text-save')));
    await tester.pumpAndSettle();

    verify(
      () => repository.updatePage('book-1', 'page-1', sectionTitle: const Optional<String?>.present(null)),
    ).called(1);
    expect(find.text('Day 1'), findsNothing);
  });

  testWidgets('fills an empty slot with a photo of the album', (tester) async {
    when(() => repository.getAlbumPhotos('album-1')).thenAnswer((_) async => [_asset('asset-1'), _asset('asset-9')]);
    when(() => repository.placePhoto('book-1', 'page-1', 1, 'asset-9')).thenAnswer(
      (_) async => editablePage(
        'page-1',
        0,
        slots: [
          slotJson(0, assetId: 'asset-1'),
          slotJson(1, assetId: 'asset-9'),
        ],
      ),
    );
    await pumpEditor(tester);

    await tester.tap(find.byKey(const ValueKey('book-slot-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-slot-choose')));
    await tester.pumpAndSettle();

    expect(find.text('Only photos of the album'), findsOneWidget);
    // the photo already in the book is marked
    expect(find.bySemanticsLabel('asset-1.jpg, already in the book'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('book-photo-asset-9')));
    await tester.pumpAndSettle();

    verify(() => repository.placePhoto('book-1', 'page-1', 1, 'asset-9')).called(1);
    expect(find.text('Page 1, photo 2'), findsOneWidget);
  });

  testWidgets('replaces a photo with one picked from the timeline', (tester) async {
    navigator.pickedPhoto = 'asset-77';
    when(() => repository.getAlbumPhotos('album-1')).thenAnswer((_) async => []);
    when(() => repository.placePhoto('book-1', 'page-1', 0, 'asset-77')).thenAnswer(
      (_) async => editablePage(
        'page-1',
        0,
        slots: [
          slotJson(0, assetId: 'asset-77'),
          slotJson(1),
        ],
      ),
    );
    await pumpEditor(tester);

    await tester.tap(find.byKey(const ValueKey('book-slot-0')));
    await tester.pumpAndSettle();
    expect(find.text('Replace photo'), findsOneWidget);
    await tester.tap(find.byKey(const Key('book-slot-choose')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-photo-from-timeline')));
    await tester.pumpAndSettle();

    expect(navigator.calls, ['pick photo']);
    verify(() => repository.placePhoto('book-1', 'page-1', 0, 'asset-77')).called(1);
  });

  testWidgets('adjusts the crop of a photo under a frame of the slot shape', (tester) async {
    when(
      () => repository.updateSlot('book-1', 'page-1', 0, crop: any(named: 'crop')),
    ).thenAnswer((_) async => editablePage('page-1', 0));
    await pumpEditor(tester);

    await tester.tap(find.byKey(const ValueKey('book-slot-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-slot-crop')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('book-crop-frame')), findsOneWidget);
    // a 1×1 photo in a 3:2 slot shows its whole width; zoomed in three times, about half of it
    await tester.tap(find.byTooltip('Zoom in'));
    await tester.tap(find.byTooltip('Zoom in'));
    await tester.tap(find.byTooltip('Zoom in'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('book-crop-save')));
    await tester.pumpAndSettle();

    final crop =
        verify(() => repository.updateSlot('book-1', 'page-1', 0, crop: captureAny(named: 'crop'))).captured.single
            as Optional<NormalizedRect?>;
    final rect = crop.value!;
    expect(rect.width, closeTo(1 / 1.953125, 0.001));
    expect(rect.width / rect.height, closeTo(1.5, 0.01));
    expect(rect.x + rect.width / 2, closeTo(0.5, 0.001));
  });

  testWidgets('captions a photo and removes another', (tester) async {
    when(() => repository.updateSlot('book-1', 'page-1', 0, caption: any(named: 'caption'))).thenAnswer(
      (_) async => editablePage(
        'page-1',
        0,
        slots: [slotJson(0, assetId: 'asset-1', caption: 'Etna')],
      ),
    );
    when(
      () => repository.clearSlot('book-1', 'page-1', 0),
    ).thenAnswer((_) async => editablePage('page-1', 0, slots: [slotJson(0)]));
    await pumpEditor(tester);

    await tester.tap(find.byKey(const ValueKey('book-slot-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-slot-caption')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('gallery-text-field')), 'Etna');
    await tester.tap(find.byKey(const Key('gallery-text-save')));
    await tester.pumpAndSettle();
    verify(
      () => repository.updateSlot('book-1', 'page-1', 0, caption: const Optional<String?>.present('Etna')),
    ).called(1);
    expect(find.text('Etna'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('book-slot-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-slot-remove')));
    await tester.pumpAndSettle();
    verify(() => repository.clearSlot('book-1', 'page-1', 0)).called(1);
    expect(find.text('Page 1, empty slot 1'), findsOneWidget);
  });

  testWidgets('moves a page later, and the book is reloaded', (tester) async {
    when(() => repository.movePage('book-1', 'page-1', 1)).thenAnswer((_) async {
      book = editableBook([editablePage('page-2', 0, layout: 'single'), editablePage('page-1', 1)]);
      return editablePage('page-1', 1);
    });
    await pumpEditor(tester);

    await tester.tap(find.byKey(const Key('book-page-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-page-later')));
    await tester.pumpAndSettle();

    verify(() => repository.movePage('book-1', 'page-1', 1)).called(1);
    expect(find.text('Page 2 of 2'), findsOneWidget);
  });

  testWidgets('adds a page after this one and opens it', (tester) async {
    when(() => repository.addPage('book-1', 'single', position: 1)).thenAnswer((_) async {
      book = editableBook([
        page1,
        editablePage('page-new', 1, layout: 'single', slots: [slotJson(0)]),
        page2,
      ]);
      return editablePage('page-new', 1, layout: 'single', slots: [slotJson(0)]);
    });
    await pumpEditor(tester);

    await tester.tap(find.byKey(const Key('book-page-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-page-add')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('book-layout-single')));
    await tester.pumpAndSettle();

    verify(() => repository.addPage('book-1', 'single', position: 1)).called(1);
    expect(find.text('Page 2 of 3'), findsOneWidget);
    expect(find.text('Page 2, empty slot 1'), findsOneWidget);
  });

  testWidgets('deletes a page after asking, and shows the next one', (tester) async {
    when(() => repository.removePage('book-1', 'page-1')).thenAnswer((_) async {
      book = editableBook([
        editablePage(
          'page-2',
          0,
          layout: 'single',
          slots: [slotJson(0, assetId: 'asset-2')],
        ),
      ]);
    });
    await pumpEditor(tester);

    await tester.tap(find.byKey(const Key('book-page-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-page-delete')));
    await tester.pumpAndSettle();
    expect(find.text('Delete page 1? The photos on it stay in your library.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('gallery-confirm')));
    await tester.pumpAndSettle();

    verify(() => repository.removePage('book-1', 'page-1')).called(1);
    expect(find.text('Page 1 of 1'), findsOneWidget);
    expect(find.text('Single'), findsOneWidget);
  });

  testWidgets('a failed edit says so and keeps the page', (tester) async {
    when(() => repository.clearSlot('book-1', 'page-1', 0)).thenThrow(ApiException(500, 'boom'));
    await pumpEditor(tester);

    await tester.tap(find.byKey(const ValueKey('book-slot-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-slot-remove')));
    await tester.pumpAndSettle();

    expect(toast.errors, ['Unable to remove the photo']);
    expect(find.text('Page 1, photo 1'), findsOneWidget);
  });

  testWidgets('heavy edits open the web editor in the browser', (tester) async {
    await pumpEditor(tester);

    await tester.tap(find.byKey(const Key('book-page-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('book-page-web')));
    await tester.pumpAndSettle();

    expect(navigator.calls, ['book on web book-1']);
  });
}

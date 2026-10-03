import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/gallery/presentation/pages/journal_name.page.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_photo_viewer.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/repositories/journal_api.repository.dart';
import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';
import '../../journal_fixtures.dart';

class _MockJournalApiRepository extends Mock implements JournalApiRepository {}

class _FakeTags extends TagNotifier {
  @override
  Future<Set<Tag>> build() async => {};
}

void main() {
  late _MockJournalApiRepository repository;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;
  late FakeGalleryImages images;

  setUpAll(() {
    registerFallbackValue(const JournalTarget.assets('food', []));
    registerFallbackValue(CollectionEntriesDto(place: 'x', photos: []));
  });

  setUp(() {
    repository = _MockJournalApiRepository();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    images = FakeGalleryImages();
    when(
      () => repository.match(
        'food',
        subjectIds: any(named: 'subjectIds'),
        sourceIds: any(named: 'sourceIds'),
      ),
    ).thenAnswer((_) async => menuMatch());
  });

  Future<void> pumpPage(
    WidgetTester tester, {
    String? albumId = 'album-1',
    List<String> assetIds = const [],
    GalleryFeatures features = const GalleryFeatures(assistant: true),
  }) async {
    tester.view.physicalSize = const Size(1080, 6000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpConsumerWidget(
      JournalNamePage(pack: 'food', albumId: albumId, albumName: 'Rome', albumAssetCount: 80, assetIds: assetIds),
      overrides: [
        ...galleryOverrides(features: features, navigator: navigator, toast: toast, images: images),
        journalApiRepositoryProvider.overrideWithValue(repository),
        tagProvider.overrideWith(_FakeTags.new),
      ],
    );
  }

  testWidgets('lists the meals of an album, and names the dishes of one', (tester) async {
    when(() => repository.findVisits(const JournalTarget.album('food', 'album-1'))).thenAnswer(
      (_) async => visits([
        visitJson(),
        visitJson(index: 1, place: 'Dinner in Rome', placeSource: 'fallback', type: 'Dinner', readOnlyIds: []),
      ]),
    );
    CollectionEntriesDto? sent;
    when(() => repository.saveEntries('food', any())).thenAnswer((invocation) async {
      sent = invocation.positionalArguments[1] as CollectionEntriesDto;
      return savedEntries({
        'menu-1': 'Food/Trattoria da Enzo/Menu',
        'dish-1': 'Food/Trattoria da Enzo/Spaghetti alla carbonara',
        'dish-2': 'Food/Trattoria da Enzo/Tiramisù',
      });
    });
    await pumpPage(tester);

    expect(find.text('Name the dishes'), findsOneWidget);
    expect(find.text('2 meals found. Choose one to name its dishes.'), findsOneWidget);
    expect(find.text('Trattoria da Enzo'), findsOneWidget);
    expect(find.text('Dinner in Rome'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('journal-visit-0')));
    await tester.pumpAndSettle();

    // the photos of a friend help to read the menu, but only the user's are named
    expect(find.textContaining('2 photos of this visit belong to someone else'), findsOneWidget);
    expect(find.text('2 items read on the menu'), findsOneWidget);
    expect(find.text('Check this match'), findsOneWidget);
    expect(find.text('Not on the menu'), findsWidgets);
    expect(find.byKey(const ValueKey('journal-row-dish-4')), findsNothing);

    // the menu, full screen
    await tester.tap(find.byKey(const ValueKey('journal-source-menu-2')));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryPhotoViewer), findsOneWidget);
    expect(find.text('Menu · 2 / 2'), findsOneWidget);
    expect(images.requested, contains('preview:menu-2'));
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();

    // the bread is named by hand
    await tester.enterText(find.byKey(const ValueKey('journal-name-dish-3')), 'Bread');
    await tester.pump();

    await tester.tap(find.byKey(const Key('journal-save')));
    await tester.pumpAndSettle();

    expect(sent!.place, 'Trattoria da Enzo');
    expect(sent!.photos.map((photo) => (photo.id, photo.entry.orElse(null), photo.source_.orElse(null))), [
      ('menu-1', null, true),
      ('dish-1', 'Spaghetti alla carbonara', null),
      ('dish-2', 'Tiramisù', null),
      ('dish-3', 'Bread', null),
    ]);
    expect(toast.successes, ['Named 2 dish photos and 1 menu photo at Trattoria da Enzo']);
    expect(find.text('Named'), findsNWidgets(2));

    // a book of the album in the Food style
    await tester.tap(find.byKey(const Key('journal-make-book')));
    await tester.pumpAndSettle();
    expect(navigator.calls, ['export album album-1 as book (food)']);
  });

  testWidgets('a meal whose restaurant could not be read', (tester) async {
    when(() => repository.findVisits(any())).thenAnswer(
      (_) async => visits([
        visitJson(
          place: 'Lunch in Rome',
          placeSource: 'fallback',
          readOnlyIds: [],
          candidates: [
            {'name': 'Da Enzo', 'source': 'receipt', 'confidence': 0.4, 'assetIds': <String>[]},
          ],
        ),
      ]),
    );
    await pumpPage(tester, albumId: null, assetIds: ['menu-1', 'dish-1']);

    // the only meal opens by itself
    expect(find.text("Couldn't read the restaurant's name. Type it in."), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('journal-other-name-Da Enzo')));
    await tester.pump();
    expect(find.widgetWithText(TextField, 'Da Enzo'), findsOneWidget);

    // the place is typed in; a place without a letter cannot be saved
    await tester.enterText(find.byKey(const Key('journal-place')), ' - ');
    await tester.pump();
    expect(tester.widget<FilledButton>(find.byKey(const Key('journal-save'))).onPressed, isNull);

    // the assistant gets the photos of the meal
    await tester.tap(find.byKey(const Key('journal-ask-assistant')));
    await tester.pumpAndSettle();
    expect(
      navigator.calls.single,
      startsWith('assistant session=null assets=menu-1,menu-2,dish-1,dish-2,dish-3,dish-4'),
    );
    expect(navigator.calls.single, contains('Name the dishes of my lunch at - on Saturday, June 14, 2025'));
  });

  testWidgets('chooses a dish on the menu, and takes one off it', (tester) async {
    when(() => repository.findVisits(any())).thenAnswer((_) async => visits([visitJson(readOnlyIds: [])]));
    await pumpPage(tester);

    await tester.tap(find.byKey(const ValueKey('journal-choose-dish-2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('journal-entry-Tiramisù')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('journal-entry-Spaghetti alla carbonara')));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byKey(const ValueKey('journal-name-dish-2'))).controller!.text,
      'Spaghetti alla carbonara',
    );
    expect(find.text('Check this match'), findsNothing);

    // off the menu: the name goes; back on it, the dish gets its match again
    await tester.tap(find.byKey(const ValueKey('journal-off-list-dish-1')));
    await tester.pump();
    expect(tester.widget<TextField>(find.byKey(const ValueKey('journal-name-dish-1'))).controller!.text, '');
    expect(find.byKey(const ValueKey('journal-choose-dish-1')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('journal-off-list-dish-1')));
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byKey(const ValueKey('journal-name-dish-1'))).controller!.text,
      'Spaghetti alla carbonara',
    );
  });

  testWidgets('says so when there are no meals, or they cannot be found', (tester) async {
    when(() => repository.findVisits(any())).thenAnswer((_) async => visits([]));
    await pumpPage(tester);
    expect(find.text('No food photos found in this album'), findsOneWidget);

    when(() => repository.findVisits(any())).thenThrow(ApiException(500, 'boom'));
    await pumpPage(tester, albumId: null, assetIds: ['a']);
    expect(find.text('Unable to find the meals'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('says which photos could not be named', (tester) async {
    when(() => repository.findVisits(any())).thenAnswer((_) async => visits([visitJson(readOnlyIds: [])]));
    when(
      () => repository.saveEntries('food', any()),
    ).thenAnswer((_) async => savedEntries({'menu-1': 'Food/Trattoria da Enzo/Menu', 'dish-1': null}));
    await pumpPage(tester, albumId: null, assetIds: ['menu-1', 'dish-1']);

    await tester.tap(find.byKey(const Key('journal-save')));
    await tester.pumpAndSettle();

    expect(toast.errors, ['1 photo could not be named']);
    // from a selection, the book is made with the assistant
    await tester.tap(find.byKey(const Key('journal-make-book')));
    await tester.pumpAndSettle();
    expect(navigator.calls.single, startsWith('assistant session=null assets=menu-1,dish-1 prompt=Make a photo book'));
  });
}

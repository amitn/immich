import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/pages/book_export.page.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../book_fixtures.dart';
import '../../gallery_test_helpers.dart';

class _MockBookApiRepository extends Mock implements BookApiRepository {}

BookStylePresetResponseDto _preset(BookStylePreset id, String background) => BookStylePresetResponseDto.fromJson({
  'id': id.toJson(),
  'name': id.toJson(),
  'description': '',
  'style': {'background': background, 'textColor': '#222222', 'fontFamily': 'serif', 'marginMm': 12, 'gutterMm': 4},
})!;

BookAutoLayoutResponseDto _laidOut(String id) =>
    BookAutoLayoutResponseDto.fromJson({...bookJson(id), 'pages': <Object?>[], 'warnings': <Object?>[]})!;

void main() {
  late _MockBookApiRepository repository;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;

  setUpAll(() => registerFallbackValue(BookFromAlbumDto(albumId: 'x')));

  setUp(() {
    repository = _MockBookApiRepository();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    when(
      () => repository.getStylePresets(),
    ).thenAnswer((_) async => [_preset(BookStylePreset.soft, '#f6f1e7'), _preset(BookStylePreset.food, '#fbf5e9')]);
    when(() => repository.getUserStyles()).thenAnswer((_) async => [userStyle('style-1', name: 'Sepia')]);
  });

  Future<void> pumpPage(
    WidgetTester tester, {
    int assetCount = 40,
    String? stylePreset,
    GalleryFeatures features = const GalleryFeatures(assistant: true),
  }) async {
    tester.view.physicalSize = const Size(1080, 9000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpConsumerWidget(
      BookExportPage(albumId: 'album-1', albumName: 'Sicily', assetCount: assetCount, stylePreset: stylePreset),
      overrides: [
        ...galleryOverrides(features: features, navigator: navigator, toast: toast),
        bookApiRepositoryProvider.overrideWithValue(repository),
      ],
    );
  }

  testWidgets('creates the book with the chosen options and opens it', (tester) async {
    BookFromAlbumDto? sent;
    when(() => repository.createFromAlbum(any())).thenAnswer((invocation) async {
      sent = invocation.positionalArguments.first as BookFromAlbumDto;
      return _laidOut('book-7');
    });
    await pumpPage(tester);

    expect(find.text('Export album as a photo book'), findsOneWidget);
    expect(find.text('Your styles'), findsOneWidget);
    expect(find.text('Sepia'), findsOneWidget);
    // the description of the default style
    expect(find.text('Warm cream pages, muted brown text, generous margins and a serif font'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('book-export-subtitle')), 'Summer 2025');
    await tester.tap(find.byKey(const Key('book-export-size-a4-landscape')));
    await tester.tap(find.byKey(const Key('book-style-style-1')));
    await tester.pump();
    expect(find.text('Brown ink on old paper'), findsOneWidget);
    await tester.tap(find.byKey(const Key('book-export-map-sketch')));
    await tester.enterText(find.byKey(const Key('book-export-pages')), '30');
    await tester.tap(find.byKey(const Key('book-export-improve')));
    await tester.pump();

    await tester.tap(find.byKey(const Key('book-export-create')));
    await tester.pumpAndSettle();

    final json = sent!.toJson();
    expect(json['albumId'], 'album-1');
    expect(json['title'], 'Sicily');
    expect(json['subtitle'], 'Summer 2025');
    expect(json['pageWidthMm'], 297);
    expect(json['pageHeightMm'], 210);
    expect(json['stylePreset'], isNull);
    expect((json['style'] as BookStyleUpdate).background.orElse(null), '#f1e4c8');
    expect(json['targetPageCount'], 30);
    expect(json['mapStyle'], BookMapStyleOption.sketch);
    expect(json['improvePhotos'], false);
    expect(navigator.calls, ['book book-7']);
  });

  testWidgets('starts with the style of a journal, and offers no Stadia maps without a key', (tester) async {
    when(() => repository.createFromAlbum(any())).thenAnswer((_) async => _laidOut('book-8'));
    await pumpPage(tester, stylePreset: 'food');

    expect(
      find.text(
        'Like a printed menu: warm paper, small-caps headings, thin rules and the name of every dish below its photo',
      ),
      findsOneWidget,
    );
    final watercolor = tester.widget<ChoiceChip>(find.byKey(const Key('book-export-map-watercolor')));
    expect(watercolor.onSelected, isNull);
    // artistic styles are off: no illustrated maps
    final illustrate = tester.widget<SwitchListTile>(find.byKey(const Key('book-export-illustrate')));
    expect(illustrate.onChanged, isNull);

    await tester.tap(find.byKey(const Key('book-export-create')));
    await tester.pumpAndSettle();
    final sent = verify(() => repository.createFromAlbum(captureAny())).captured.single as BookFromAlbumDto;
    expect(sent.toJson()['stylePreset'], BookStylePreset.food);
  });

  testWidgets('says so when the book cannot be made, and stays open', (tester) async {
    when(() => repository.createFromAlbum(any())).thenThrow(ApiException(500, 'boom'));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('book-export-create')));
    await tester.pumpAndSettle();

    expect(toast.errors, ['Unable to create the photo book']);
    expect(navigator.calls, isEmpty);
    expect(tester.widget<FilledButton>(find.byKey(const Key('book-export-create'))).onPressed, isNotNull);
  });

  testWidgets('an empty album cannot be made into a book', (tester) async {
    await pumpPage(tester, assetCount: 0);
    expect(tester.widget<FilledButton>(find.byKey(const Key('book-export-create'))).onPressed, isNull);
  });
}

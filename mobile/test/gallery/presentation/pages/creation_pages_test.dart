import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/pages/artistic_style.page.dart';
import 'package:immich_mobile/gallery/presentation/pages/auto_enhance.page.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_before_after.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/creation_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../creation_fixtures.dart';
import '../../gallery_test_helpers.dart';

class _MockCreationApiRepository extends Mock implements CreationApiRepository {}

void main() {
  late _MockCreationApiRepository repository;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;
  late FakeGalleryImages images;

  setUpAll(() => registerFallbackValue(EnhanceStrength.normal));

  setUp(() {
    repository = _MockCreationApiRepository();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    images = FakeGalleryImages();
  });

  tearDown(() => bus.dispose());

  void tallView(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  List<dynamic> overrides() => [
    ...galleryOverrides(navigator: navigator, toast: toast, images: images),
    creationApiRepositoryProvider.overrideWithValue(repository),
    galleryEventBusProvider.overrideWithValue(bus),
  ];

  group('Artistic style', () {
    setUp(() {
      when(() => repository.getArtStyles()).thenAnswer(
        (_) async => [
          artStyle('watercolor', 'Watercolor'),
          artStyle('postcard', 'Postcard', usesCaption: true),
          artStyle('style-9', 'My ink', owned: true),
        ],
      );
    });

    Future<void> pumpPage(WidgetTester tester) {
      tallView(tester);
      return tester.pumpConsumerWidget(const ArtisticStylePage(assetId: 'photo-1'), overrides: [...overrides().cast()]);
    }

    testWidgets('makes an artwork in a style, follows it, and shows it before and after', (tester) async {
      when(
        () => repository.createArtJob(
          assetId: 'photo-1',
          style: any(named: 'style'),
          prompt: any(named: 'prompt'),
          caption: any(named: 'caption'),
        ),
      ).thenAnswer((_) async => artJob('job-1'));
      await pumpPage(tester);

      expect(find.text('Watercolor'), findsOneWidget);
      expect(find.text('Your styles'), findsOneWidget);
      expect(find.byKey(const Key('art-caption')), findsNothing);

      // a style with a caption asks for it
      await tester.tap(find.text('Postcard'));
      await tester.pump();
      await tester.enterText(find.byKey(const Key('art-caption')), ' Greetings from Rome ');
      await tester.enterText(find.byKey(const Key('art-prompt')), 'warmer');
      await tester.tap(find.byKey(const Key('art-generate')));
      await tester.pump();
      await tester.pump();

      verify(
        () => repository.createArtJob(
          assetId: 'photo-1',
          style: 'postcard',
          prompt: 'warmer',
          caption: 'Greetings from Rome',
        ),
      ).called(1);
      expect(find.text('Waiting for the art agent…'), findsOneWidget);

      // another job's update is not this one's
      bus.addArtJob(artJobJson('job-2', status: 'completed', resultAssetId: 'art-2'));
      await tester.pump();
      expect(find.text('Waiting for the art agent…'), findsOneWidget);

      bus.addArtJob(artJobJson('job-1', status: 'running'));
      await tester.pump();
      expect(find.text('Creating the artwork…'), findsOneWidget);

      bus.addArtJob(artJobJson('job-1', status: 'completed', resultAssetId: 'art-1'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(GalleryBeforeAfter), findsOneWidget);
      expect(images.requested, containsAll(['preview:photo-1', 'preview:art-1']));
      expect(find.text('Before'), findsOneWidget);
      expect(find.text('After'), findsOneWidget);

      await tester.tap(find.byKey(const Key('art-open')));
      await tester.pumpAndSettle();
      expect(navigator.calls, ['assets art-1 at 0']);
    });

    testWidgets('a custom prompt is needed without a style; a failure can be tried again', (tester) async {
      when(
        () => repository.createArtJob(
          assetId: 'photo-1',
          style: any(named: 'style'),
          prompt: any(named: 'prompt'),
          caption: any(named: 'caption'),
        ),
      ).thenAnswer((_) async => artJob('job-1', status: 'failed', error: 'The art agent is offline'));
      await pumpPage(tester);

      await tester.tap(find.text('Custom'));
      await tester.pump();
      expect(tester.widget<FilledButton>(find.byKey(const Key('art-generate'))).onPressed, isNull);
      await tester.enterText(find.byKey(const Key('art-prompt')), 'a linocut');
      await tester.pump();
      await tester.tap(find.byKey(const Key('art-generate')));
      await tester.pumpAndSettle();

      verify(() => repository.createArtJob(assetId: 'photo-1', prompt: 'a linocut')).called(1);
      expect(find.text('The artwork could not be created'), findsOneWidget);
      expect(find.text('The art agent is offline'), findsOneWidget);

      await tester.tap(find.byKey(const Key('art-try-again')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('art-generate')), findsOneWidget);
    });

    testWidgets('deletes a style of the user', (tester) async {
      when(() => repository.deleteArtStyle('style-9')).thenAnswer((_) async {});
      await pumpPage(tester);

      await tester.tap(find.byKey(const ValueKey('art-style-delete-style-9')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete').last);
      await tester.pumpAndSettle();

      verify(() => repository.deleteArtStyle('style-9')).called(1);
      expect(find.text('My ink'), findsNothing);
      expect(toast.successes, ['Deleted the style My ink']);
    });
  });

  group('Auto enhance', () {
    Future<void> pumpPage(WidgetTester tester) {
      tallView(tester);
      return tester.pumpConsumerWidget(const AutoEnhancePage(assetId: 'photo-1'), overrides: [...overrides().cast()]);
    }

    testWidgets('shows what a strength corrects, and saves the enhanced copy to compare', (tester) async {
      when(
        () => repository.analyzeEnhancement('photo-1', any()),
      ).thenAnswer((invocation) async => enhanceAnalysis(strength: '${invocation.positionalArguments[1]}'));
      when(() => repository.enhance('photo-1', EnhanceStrength.strong)).thenAnswer(
        (_) async => EnhanceResponseDto.fromJson({
          'id': 'copy-1',
          'sourceId': 'photo-1',
          'adjustments': ['levels'],
          'duplicate': false,
        })!,
      );
      await pumpPage(tester);

      expect(find.text('Stretched the levels'), findsOneWidget);
      expect(images.requested, contains('enhance:photo-1@normal'));

      await tester.tap(find.text('Strong'));
      await tester.pumpAndSettle();
      expect(images.requested, contains('enhance:photo-1@strong'));

      await tester.tap(find.byKey(const Key('enhance-save')));
      await tester.pumpAndSettle();

      verify(() => repository.enhance('photo-1', EnhanceStrength.strong)).called(1);
      expect(find.text('The enhanced copy was saved as a new photo and stacked with the original.'), findsOneWidget);
      expect(find.byType(GalleryBeforeAfter), findsOneWidget);

      await tester.tap(find.byKey(const Key('enhance-open')));
      await tester.pumpAndSettle();
      expect(navigator.calls, ['assets copy-1 at 0']);
    });

    testWidgets('a photo that needs nothing cannot be saved', (tester) async {
      when(
        () => repository.analyzeEnhancement('photo-1', any()),
      ).thenAnswer((_) async => enhanceAnalysis(needed: false));
      await pumpPage(tester);

      expect(find.text('This photo already looks good, there is nothing to enhance at this strength.'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('enhance-save'))).onPressed, isNull);
    });
  });
}

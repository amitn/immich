import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/pages/highlight_video.page.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/providers/highlight.provider.dart';
import 'package:immich_mobile/gallery/repositories/highlight_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../creation_fixtures.dart';
import '../../gallery_test_helpers.dart';

class _MockHighlightApiRepository extends Mock implements HighlightApiRepository {}

void main() {
  late _MockHighlightApiRepository repository;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;
  late List<(String, int)> shared;

  setUpAll(() => registerFallbackValue(HighlightCreateDto()));

  setUp(() {
    repository = _MockHighlightApiRepository();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    shared = [];
    when(() => repository.getMusic()).thenAnswer(
      (_) async => [
        HighlightMusicResponseDto.fromJson({'id': 'music-1', 'name': 'Summer.mp3', 'durationSeconds': 161.2})!,
      ],
    );
  });

  tearDown(() => bus.dispose());

  Future<void> pumpPage(WidgetTester tester, HighlightVideoPage page) async {
    tester.view.physicalSize = const Size(1080, 4000);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpConsumerWidget(
      page,
      overrides: [
        ...galleryOverrides(navigator: navigator, toast: toast),
        highlightApiRepositoryProvider.overrideWithValue(repository),
        galleryEventBusProvider.overrideWithValue(bus),
        highlightVideoSharerProvider.overrideWithValue((name, bytes) async => shared.add((name, bytes.length))),
      ],
    );
  }

  test('the request names one source, and the file is named after the title', () {
    final json = const HighlightOptions(title: ' Rome ').toDto(const HighlightSource.album('album-1')).toJson();
    expect(json['albumId'], 'album-1');
    expect(json.containsKey('assetIds'), isFalse);
    expect(json.containsKey('memoryId'), isFalse);
    expect(json['title'], 'Rome');
    expect(json.containsKey('music'), isFalse);

    final photos = const HighlightOptions().toDto(const HighlightSource.assets(['a', 'b'])).toJson();
    expect(photos['assetIds'], ['a', 'b']);
    expect(photos.containsKey('albumId'), isFalse);
    expect(photos.containsKey('title'), isFalse);

    expect(highlightFileName('Rome: day 1/2', HighlightFormat.vertical), 'Rome day 1 2-vertical.mp4');
    expect(highlightFileName('  ', HighlightFormat.landscape), 'Highlights.mp4');
  });

  testWidgets('makes a vertical video of an album, follows it, and shares it', (tester) async {
    HighlightCreateDto? sent;
    when(() => repository.create(any())).thenAnswer((invocation) async {
      sent = invocation.positionalArguments.first as HighlightCreateDto;
      return highlightJob('job-1', format: 'vertical');
    });
    when(() => repository.downloadVideo('video-1')).thenAnswer((_) async => Uint8List(42));
    await pumpPage(tester, const HighlightVideoPage(albumId: 'album-1', title: 'Sicily'));

    expect(find.widgetWithText(TextField, 'Sicily'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('highlight-length-90')));
    await tester.tap(find.text('Vertical 9:16'));
    await tester.tap(find.byKey(const Key('highlight-captions')));
    await tester.tap(find.byKey(const Key('highlight-music')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Summer.mp3 (2:41)').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('highlight-create')));
    await tester.pump();
    await tester.pump();

    final json = sent!.toJson();
    expect(json['albumId'], 'album-1');
    expect(json.containsKey('assetIds'), isFalse);
    expect(json['durationSeconds'], 90);
    expect(json['format'], HighlightFormat.vertical);
    expect(json['captions'], false);
    expect(json['includeMaps'], true);
    expect(json['music'], 'music-1');
    expect(json['style'], HighlightStyle.auto);
    expect(find.text('Waiting to start…'), findsOneWidget);

    // the update arrives in one frame, and shows in the next
    bus.addHighlight(highlightJson('job-1', status: 'running', progress: 0.42, format: 'vertical'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Rendering… 42%'), findsOneWidget);
    expect(tester.widget<LinearProgressIndicator>(find.byKey(const Key('highlight-progress'))).value, 0.42);

    bus.addHighlight(
      highlightJson('job-1', status: 'completed', progress: 1, resultAssetId: 'video-1', format: 'vertical'),
    );
    await tester.pump();
    await tester.pump();
    expect(find.text('Your highlight video is ready'), findsOneWidget);

    await tester.tap(find.byKey(const Key('highlight-share')));
    await tester.pumpAndSettle();
    expect(shared, [('Sicily-vertical.mp4', 42)]);

    await tester.tap(find.byKey(const Key('highlight-open')));
    await tester.pumpAndSettle();
    expect(navigator.calls, ['assets video-1 at 0']);
  });

  testWidgets('a video of a memory can be cancelled', (tester) async {
    when(
      () => repository.create(any()),
    ).thenAnswer((_) async => highlightJob('job-2', status: 'running', progress: 0.1));
    when(
      () => repository.cancel('job-2'),
    ).thenAnswer((_) async => HighlightJobResponseDto.fromJson(highlightJson('job-2', status: 'cancelled'))!);
    await pumpPage(tester, const HighlightVideoPage(memoryId: 'memory-1', vertical: true));

    await tester.tap(find.byKey(const Key('highlight-create')));
    await tester.pump();
    await tester.pump();
    final sent = verify(() => repository.create(captureAny())).captured.single as HighlightCreateDto;
    expect(sent.toJson()['memoryId'], 'memory-1');
    expect(sent.toJson()['format'], HighlightFormat.vertical);

    await tester.tap(find.byKey(const Key('highlight-cancel')));
    await tester.pumpAndSettle();
    verify(() => repository.cancel('job-2')).called(1);
  });

  testWidgets('says so when the video cannot be made or shared', (tester) async {
    when(() => repository.create(any())).thenThrow(ApiException(400, 'nope'));
    await pumpPage(tester, const HighlightVideoPage(assetIds: ['a']));

    await tester.tap(find.byKey(const Key('highlight-create')));
    await tester.pumpAndSettle();
    expect(toast.errors, ['Unable to make the highlight video']);

    when(
      () => repository.create(any()),
    ).thenAnswer((_) async => highlightJob('job-3', status: 'completed', progress: 1, resultAssetId: 'video-3'));
    when(() => repository.downloadVideo('video-3')).thenThrow(ApiException(500, 'gone'));
    await tester.tap(find.byKey(const Key('highlight-create')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('highlight-share')));
    await tester.pumpAndSettle();
    expect(toast.errors.last, 'Unable to share the video');
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/memory/gallery_memory_video_button.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';

import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';

Memory _memory() => Memory(
  id: 'memory-1',
  createdAt: DateTime(2026),
  updatedAt: DateTime(2026),
  ownerId: 'user-1',
  type: MemoryTypeEnum.onThisDay,
  data: const MemoryData({'year': 2016}),
  isSaved: false,
  memoryAt: DateTime(2016, 10, 3),
  assets: const [],
);

void main() {
  late FakeGalleryNavigator navigator;

  setUp(() => navigator = FakeGalleryNavigator());

  Future<void> pumpButton(WidgetTester tester, {GalleryFeatures features = const GalleryFeatures(assistant: true)}) =>
      tester.pumpConsumerWidget(
        SizedBox(
          width: 400,
          height: 400,
          child: Stack(
            children: [GalleryMemoryVideoButton(memory: _memory(), title: '10 years ago')],
          ),
        ),
        overrides: galleryOverrides(features: features, navigator: navigator),
      );

  testWidgets('makes a video of the memory, landscape or vertical', (tester) async {
    await pumpButton(tester);

    await tester.tap(find.byKey(const ValueKey('memory-video-memory-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vertical video'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('memory-video-memory-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Make a video'));
    await tester.pumpAndSettle();

    expect(navigator.calls, [
      'highlight memory=memory-1 "10 years ago" vertical',
      'highlight memory=memory-1 "10 years ago"',
    ]);
  });

  testWidgets('is hidden on a server without highlight videos', (tester) async {
    await pumpButton(tester, features: const GalleryFeatures());
    expect(find.byKey(const ValueKey('memory-video-memory-1')), findsNothing);
  });
}

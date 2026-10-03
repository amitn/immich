import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/gallery/presentation/actions/viewer_actions.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/utils/asset_filter.dart';

import '../../../unit/factories/remote_asset_factory.dart';
import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';

void main() {
  late FakeGalleryNavigator navigator;

  setUp(() => navigator = FakeGalleryNavigator());

  Future<void> pumpMenu(
    WidgetTester tester,
    RemoteAsset asset, {
    bool owned = true,
    GalleryFeatures features = const GalleryFeatures(assistant: true, artisticStyles: true),
  }) => tester.pumpConsumerWidget(
    const Column(children: galleryViewerMenuItems),
    overrides: [
      ...galleryOverrides(features: features, navigator: navigator),
      assetsActionProvider.overrideWith((ref, source) => AssetFilter({asset})),
      ownedAssetsActionProvider.overrideWith((ref, source) => AssetFilter(owned ? {asset} : <RemoteAsset>{})),
    ],
  );

  testWidgets('offers the assistant, an artistic style and auto enhance for a photo of the user', (tester) async {
    await pumpMenu(tester, RemoteAssetFactory.create(id: 'photo-1'));

    expect(find.text('Ask assistant'), findsOneWidget);
    await tester.tap(find.text('Artistic style…'));
    await tester.tap(find.text('Auto enhance'));
    await tester.pump();

    expect(navigator.calls, ['art photo-1', 'enhance photo-1']);
  });

  testWidgets("a photo of someone else's is only asked about", (tester) async {
    await pumpMenu(tester, RemoteAssetFactory.create(id: 'photo-1'), owned: false);

    expect(find.text('Ask assistant'), findsOneWidget);
    expect(find.text('Artistic style…'), findsNothing);
    expect(find.text('Auto enhance'), findsNothing);
  });

  testWidgets('a video offers neither', (tester) async {
    await pumpMenu(tester, RemoteAssetFactory.create(id: 'video-1', type: AssetType.video));
    expect(find.text('Artistic style…'), findsNothing);
    expect(find.text('Auto enhance'), findsNothing);
  });

  testWidgets('a trashed photo offers neither', (tester) async {
    await pumpMenu(tester, RemoteAssetFactory.create(id: 'trashed-1', deletedAt: DateTime(2026)));
    expect(find.text('Artistic style…'), findsNothing);
    expect(find.text('Auto enhance'), findsNothing);
  });

  testWidgets('artistic styles need their flag', (tester) async {
    await pumpMenu(tester, RemoteAssetFactory.create(id: 'photo-1'), features: const GalleryFeatures(assistant: true));
    expect(find.text('Artistic style…'), findsNothing);
    expect(find.text('Auto enhance'), findsOneWidget);
  });

  testWidgets('a server without the assistant work offers none of them', (tester) async {
    await pumpMenu(tester, RemoteAssetFactory.create(id: 'photo-1'), features: const GalleryFeatures());
    expect(find.text('Ask assistant'), findsNothing);
    expect(find.text('Auto enhance'), findsNothing);
  });
}

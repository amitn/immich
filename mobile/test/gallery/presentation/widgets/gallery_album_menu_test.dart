import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/album/gallery_album_menu.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';

import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';

RemoteAlbum album({int assetCount = 12}) => RemoteAlbum(
  id: 'album-1',
  name: 'Sicily',
  ownerId: 'user-1',
  description: '',
  createdAt: DateTime(2026),
  updatedAt: DateTime(2026),
  isActivityEnabled: false,
  order: AlbumAssetOrder.desc,
  assetCount: assetCount,
  ownerName: 'Anna',
  isShared: false,
);

void main() {
  late FakeGalleryNavigator navigator;

  setUp(() => navigator = FakeGalleryNavigator());

  Future<void> pumpMenu(WidgetTester tester, RemoteAlbum album, {GalleryFeatures? features}) =>
      tester.pumpConsumerWidget(
        Consumer(builder: (context, ref, _) => Column(children: galleryAlbumMenuItems(context, ref, album))),
        overrides: galleryOverrides(features: features ?? const GalleryFeatures(assistant: true), navigator: navigator),
      );

  testWidgets('Export as book… opens the export page of the album', (tester) async {
    await pumpMenu(tester, album());

    await tester.tap(find.text('Export as book…'));
    await tester.pump();

    expect(navigator.calls, ['export album album-1 as book']);
  });

  testWidgets('offers nothing for an empty album, or on a server without photo books', (tester) async {
    await pumpMenu(tester, album(assetCount: 0));
    expect(find.text('Export as book…'), findsNothing);

    await pumpMenu(tester, album(), features: const GalleryFeatures());
    expect(find.text('Export as book…'), findsNothing);
  });
}

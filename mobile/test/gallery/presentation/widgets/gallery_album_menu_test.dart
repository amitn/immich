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

  testWidgets('Make a highlight video… opens the video page of the album', (tester) async {
    await pumpMenu(tester, album());

    await tester.tap(find.text('Make a highlight video…'));
    await tester.pump();

    expect(navigator.calls, ['highlight album=album-1 "Sicily"']);
  });

  testWidgets('Name in a journal… lists the journals, and opens the one chosen on the album', (tester) async {
    await pumpMenu(tester, album());

    await tester.tap(find.text('Name in a journal…'));
    await tester.pumpAndSettle();
    expect(find.text('Name the dishes…'), findsOneWidget);
    expect(find.text('Name the artworks…'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('journal-pack-museum')));
    await tester.pumpAndSettle();
    expect(navigator.calls, ['journal museum album=album-1']);
  });

  testWidgets('offers nothing for an empty album, or on a server without them', (tester) async {
    await pumpMenu(tester, album(assetCount: 0));
    expect(find.text('Export as book…'), findsNothing);
    expect(find.text('Name in a journal…'), findsNothing);

    await pumpMenu(tester, album(), features: const GalleryFeatures());
    expect(find.text('Export as book…'), findsNothing);
    expect(find.text('Name in a journal…'), findsNothing);
    expect(find.text('Make a highlight video…'), findsNothing);
  });
}

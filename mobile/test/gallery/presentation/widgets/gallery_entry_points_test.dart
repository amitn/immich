import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/gallery/presentation/actions/ask_assistant.action.dart';
import 'package:immich_mobile/gallery/presentation/actions/name_journal.action.dart';
import 'package:immich_mobile/gallery/presentation/widgets/library/gallery_library_entries.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/utils/asset_filter.dart';

import '../../../unit/factories/remote_asset_factory.dart';
import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';

void main() {
  late FakeGalleryNavigator navigator;

  setUp(() => navigator = FakeGalleryNavigator());

  group('Library', () {
    Future<void> pumpEntries(WidgetTester tester, GalleryFeatures features) => tester.pumpConsumerWidget(
      const CustomScrollView(slivers: [GalleryLibraryEntries()]),
      overrides: galleryOverrides(features: features, navigator: navigator),
    );

    testWidgets('shows the assistant and the photo books on a server that has them', (tester) async {
      await pumpEntries(tester, const GalleryFeatures(assistant: true));

      expect(find.text('Assistant'), findsOneWidget);
      expect(find.text('Photo books'), findsOneWidget);

      await tester.tap(find.text('Assistant'));
      await tester.tap(find.text('Photo books'));
      await tester.pump();
      expect(navigator.calls, ['assistant session=null assets= prompt=null', 'books']);
    });

    testWidgets('hides them on an older server or with the assistant off', (tester) async {
      await pumpEntries(tester, const GalleryFeatures());

      expect(find.text('Assistant'), findsNothing);
      expect(find.text('Photo books'), findsNothing);
    });
  });

  group('Albums: Create with assistant', () {
    testWidgets('opens the assistant with the album prompt', (tester) async {
      await tester.pumpConsumerWidget(
        const GalleryCreateAlbumWithAssistantButton(),
        overrides: galleryOverrides(navigator: navigator),
      );

      await tester.tap(find.byKey(const Key('albums-create-with-assistant')));
      await tester.pump();

      expect(navigator.calls.single, startsWith('assistant session=null assets= prompt=Create an album of my best'));
    });

    testWidgets('is hidden without the assistant', (tester) async {
      await tester.pumpConsumerWidget(
        const GalleryCreateAlbumWithAssistantButton(),
        overrides: galleryOverrides(features: const GalleryFeatures(), navigator: navigator),
      );

      expect(find.byKey(const Key('albums-create-with-assistant')), findsNothing);
    });
  });

  group('Ask assistant on selected photos', () {
    late List<String> cleared;

    setUp(() => cleared = []);

    Future<void> pumpAction(WidgetTester tester, Set<BaseAsset> selection, {GalleryFeatures? features}) =>
        tester.pumpConsumerWidget(
          const ActionColumnButton(action: AskAssistantAction(source: ActionSource.timeline)),
          overrides: [
            ...galleryOverrides(features: features ?? const GalleryFeatures(assistant: true), navigator: navigator),
            assetsActionProvider.overrideWith((ref, source) => AssetFilter(selection)),
            clearSelectionProvider.overrideWith(
              (ref, source) =>
                  () => cleared.add('$source'),
            ),
          ],
        );

    testWidgets('opens a chat with the photos the assistant can use, and clears the selection', (tester) async {
      final photo = RemoteAssetFactory.create(id: 'photo-1');
      final locked = RemoteAssetFactory.create(id: 'locked-1', visibility: AssetVisibility.locked);
      final trashed = RemoteAssetFactory.create(id: 'trashed-1', deletedAt: DateTime(2026));
      await pumpAction(tester, {photo, locked, trashed});

      expect(find.text('Ask assistant'), findsOneWidget);
      await tester.tap(find.text('Ask assistant'));
      await tester.pump();

      expect(navigator.calls, ['assistant session=null assets=${photo.id} prompt=null']);
      expect(cleared, ['ActionSource.timeline']);
    });

    testWidgets('is not offered without the assistant, or for photos it cannot use', (tester) async {
      await pumpAction(tester, {RemoteAssetFactory.create(id: 'photo-1')}, features: const GalleryFeatures());
      expect(find.text('Ask assistant'), findsNothing);

      await pumpAction(tester, {RemoteAssetFactory.create(id: 'locked-1', visibility: AssetVisibility.locked)});
      expect(find.text('Ask assistant'), findsNothing);
    });
  });

  group('Name in a journal on selected photos', () {
    late List<String> cleared;

    setUp(() => cleared = []);

    Future<void> pumpAction(WidgetTester tester, Set<RemoteAsset> selection, {required Set<RemoteAsset> owned}) =>
        tester.pumpConsumerWidget(
          const ActionColumnButton(action: NameJournalAction(source: ActionSource.timeline)),
          overrides: [
            ...galleryOverrides(navigator: navigator),
            assetsActionProvider.overrideWith((ref, source) => AssetFilter(selection)),
            ownedAssetsActionProvider.overrideWith((ref, source) => AssetFilter(owned)),
            clearSelectionProvider.overrideWith(
              (ref, source) =>
                  () => cleared.add('$source'),
            ),
          ],
        );

    testWidgets("looks in every selected photo, a friend's too, once a journal is chosen", (tester) async {
      final mine = RemoteAssetFactory.create(id: 'mine-1');
      final friends = RemoteAssetFactory.create(id: 'friend-1');
      final trashed = RemoteAssetFactory.create(id: 'trashed-1', deletedAt: DateTime(2026));
      await pumpAction(tester, {mine, friends, trashed}, owned: {mine});

      await tester.tap(find.text('Name in a journal…'));
      // the action runs until a journal is chosen
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(cleared, isEmpty);
      await tester.tap(find.text('Name the wines…'));
      await tester.pumpAndSettle();

      expect(navigator.calls, ['journal wine assets=${mine.id},${friends.id}']);
      expect(cleared, ['ActionSource.timeline']);
    });

    testWidgets("is not offered when no photo is the user's: only their owner names them (#21)", (tester) async {
      await pumpAction(tester, {RemoteAssetFactory.create(id: 'friend-1')}, owned: {});
      expect(find.text('Name in a journal…'), findsNothing);
    });
  });
}

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/shared_link/shared_link.model.dart';
import 'package:immich_mobile/pages/library/shared_link/shared_link_edit.page.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:immich_mobile/services/shared_link.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

const _bookLink = SharedLink(
  id: 'link-1',
  title: 'MUSEUM VISITS',
  allowDownload: false,
  allowUpload: false,
  thumbAssetId: null,
  description: null,
  password: null,
  expiresAt: null,
  key: 'key',
  showMetadata: true,
  type: SharedLinkSource.book,
  slug: null,
);

class _MockServerInfoService extends Mock implements ServerInfoService {}

class _MockSharedLinkService extends Mock implements SharedLinkService {}

void main() {
  late _MockServerInfoService serverInfo;
  late _MockSharedLinkService links;

  // the page reads the server URL from the local store
  setUpAll(() async {
    TestUtils.init();
    await StoreService.init(
      storeRepository: StoreRepository(
        Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true)),
      ),
    );
  });

  setUp(() {
    serverInfo = _MockServerInfoService();
    links = _MockSharedLinkService();
    when(() => serverInfo.getServerConfig()).thenAnswer((_) async => null);
  });

  Future<void> pumpEditor(WidgetTester tester, {String? bookId, SharedLink? existingLink}) async {
    await tester.binding.setSurfaceSize(const Size(600, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpConsumerWidget(
      SharedLinkEditPage(bookId: bookId, existingLink: existingLink),
      overrides: [
        serverInfoProvider.overrideWith((ref) => ServerInfoNotifier(serverInfo)),
        sharedLinkServiceProvider.overrideWithValue(links),
      ],
    );
    await tester.pump();
  }

  testWidgets('a link to a book offers the PDF and the photo details, and no upload', (tester) async {
    await pumpEditor(tester, bookId: 'book-1');

    expect(find.textContaining('read this photo book as a web book'), findsOneWidget);
    expect(find.text('Allow downloading the PDF'), findsOneWidget);
    expect(find.text('Show photo dates and file names'), findsOneWidget);
    expect(find.text('Allow public user to upload'), findsNothing);
    expect(find.text('Show metadata'), findsNothing);
  });

  testWidgets('creates a link to the book with its password', (tester) async {
    when(
      () => links.createSharedLink(
        showMeta: any(named: 'showMeta'),
        allowDownload: any(named: 'allowDownload'),
        allowUpload: any(named: 'allowUpload'),
        description: any(named: 'description'),
        password: any(named: 'password'),
        slug: any(named: 'slug'),
        albumId: any(named: 'albumId'),
        assetIds: any(named: 'assetIds'),
        expiresAt: any(named: 'expiresAt'),
        spaceId: any(named: 'spaceId'),
        bookId: any(named: 'bookId'),
      ),
    ).thenAnswer((_) async => _bookLink);
    await pumpEditor(tester, bookId: 'book-1');

    await tester.enterText(find.widgetWithText(TextField, 'Password'), 'secret');
    await tester.tap(find.text('Create link'));
    await tester.pumpAndSettle();
    // the "copied" snackbar
    await tester.pump(const Duration(seconds: 5));

    verify(
      () => links.createSharedLink(
        showMeta: true,
        allowDownload: true,
        allowUpload: false,
        description: null,
        password: 'secret',
        slug: null,
        albumId: null,
        assetIds: null,
        expiresAt: null,
        spaceId: null,
        bookId: 'book-1',
      ),
    ).called(1);
  });

  testWidgets('an existing book link is titled as a photo book', (tester) async {
    await pumpEditor(tester, existingLink: _bookLink);

    expect(find.text('Photo book'), findsOneWidget);
    expect(find.text('MUSEUM VISITS'), findsOneWidget);
    expect(find.text('Allow public user to upload'), findsNothing);
  });
}

import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/memory.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/url_helper.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';
import 'package:url_launcher/url_launcher.dart';

/// Where the assistant screens lead: behind a provider, so widget tests can follow the navigation without a router
abstract interface class GalleryNavigator {
  /// The assistant: an earlier chat, or a new one with photos attached and a prompt to edit before sending
  Future<void> openAssistant({String? sessionId, List<String> assetIds, String? prompt});

  Future<void> openBooks();

  Future<void> openBook(String bookId);

  Future<void> openNotifications();

  /// "Export as book…" of an album, with [stylePreset] chosen (e.g. the preset of a journal)
  Future<void> exportAlbumAsBook({
    required String albumId,
    required String albumName,
    required int assetCount,
    BookStylePreset? stylePreset,
  });

  /// "Name the …" of a journal, in an album or in photos
  Future<void> nameInJournal({
    required String pack,
    String? albumId,
    String? albumName,
    int albumAssetCount = 0,
    List<String> assetIds = const [],
  });

  /// "Artistic style…" of a photo of the user's
  Future<void> openArtisticStyle(String assetId);

  /// "Auto enhance" of a photo of the user's
  Future<void> openAutoEnhance(String assetId);

  /// "Make a highlight video…" of an album, photos or a memory
  Future<void> makeHighlightVideo({
    String? albumId,
    List<String> assetIds,
    String? memoryId,
    String? title,
    bool vertical = false,
  });

  /// The tree of the tags, at [path] (e.g. Holidays/Italy)
  Future<void> openTags({String path = ''});

  /// The photos of a tag, in the timeline filtered by it (the web's `/photos?tags=<id>`)
  void openTagPhotos(String tagId);

  /// The link page of a photo book, to create a link with a password and an expiry date
  Future<void> shareBook(String bookId);

  /// The editor of a page of a photo book
  Future<void> editBookPage(String bookId, String pageId);

  /// The web app's editor of a photo book, in the browser, for edits a phone does poorly (dragging photos between
  /// pages, the style, the maps)
  Future<void> openBookOnWeb(String bookId);

  /// One photo chosen from the timeline (e.g. for a slot of a book), or null; only photos on the server count
  Future<String?> pickPhoto();

  /// The Routines inbox: the changes of routine runs that wait for approval
  Future<void> openRoutinesInbox();

  /// A routine run: its summary, its changes and its transcript
  Future<void> openRoutineRun(String runId);

  /// The asset viewer on [assetIds], at [index]; false when the photo is not on this device (yet)
  Future<bool> openAssets(List<String> assetIds, {int index = 0});

  /// false when the album is not on this device (yet)
  Future<bool> openAlbum(String albumId);

  /// false when the memory is not on this device
  Future<bool> openMemory(String memoryId);

  /// What a notification is about; false when it is not on this device (yet)
  Future<bool> openTarget(NotificationTarget target);
}

/// Navigates with the app's router
class RouterGalleryNavigator implements GalleryNavigator {
  static final _log = Logger('GalleryNavigator');

  final Ref _ref;

  const RouterGalleryNavigator(this._ref);

  AppRouter get _router => _ref.read(appRouterProvider);

  @override
  Future<void> openAssistant({String? sessionId, List<String> assetIds = const [], String? prompt}) =>
      _router.push(AssistantRoute(sessionId: sessionId, assetIds: assetIds, prompt: prompt));

  @override
  Future<void> openBooks() => _router.push(const BooksRoute());

  @override
  Future<void> openBook(String bookId) => _router.push(BookViewerRoute(bookId: bookId));

  @override
  Future<void> openNotifications() => _router.push(const GalleryNotificationsRoute());

  @override
  Future<void> exportAlbumAsBook({
    required String albumId,
    required String albumName,
    required int assetCount,
    BookStylePreset? stylePreset,
  }) => _router.push(
    BookExportRoute(albumId: albumId, albumName: albumName, assetCount: assetCount, stylePreset: stylePreset?.toJson()),
  );

  @override
  Future<void> nameInJournal({
    required String pack,
    String? albumId,
    String? albumName,
    int albumAssetCount = 0,
    List<String> assetIds = const [],
  }) => _router.push(
    JournalNameRoute(
      pack: pack,
      albumId: albumId,
      albumName: albumName,
      albumAssetCount: albumAssetCount,
      assetIds: assetIds,
    ),
  );

  @override
  Future<void> openArtisticStyle(String assetId) => _router.push(ArtisticStyleRoute(assetId: assetId));

  @override
  Future<void> openAutoEnhance(String assetId) => _router.push(AutoEnhanceRoute(assetId: assetId));

  @override
  Future<void> makeHighlightVideo({
    String? albumId,
    List<String> assetIds = const [],
    String? memoryId,
    String? title,
    bool vertical = false,
  }) => _router.push(
    HighlightVideoRoute(albumId: albumId, assetIds: assetIds, memoryId: memoryId, title: title, vertical: vertical),
  );

  @override
  Future<void> openTags({String path = ''}) => _router.push(TagsRoute(path: path));

  @override
  void openTagPhotos(String tagId) {
    // set before navigating, or the timeline opens unfiltered
    _ref.read(photosFilterProvider.notifier)
      ..reset()
      ..toggleTag(tagId);
    unawaited(_router.navigate(const MainTimelineRoute()));
  }

  @override
  Future<void> shareBook(String bookId) => _router.push(SharedLinkEditRoute(bookId: bookId));

  @override
  Future<void> editBookPage(String bookId, String pageId) =>
      _router.push(BookEditorRoute(bookId: bookId, pageId: pageId));

  @override
  Future<void> openBookOnWeb(String bookId) async {
    // the web app is where the API is, without its /api (a server may sit under a path)
    final endpoint = Store.tryGet(StoreKey.serverEndpoint);
    final web = endpoint == null || endpoint.isEmpty ? getServerUrl() : endpoint.replaceFirst(RegExp(r'/api/?$'), '');
    if (web != null && web.isNotEmpty) {
      await launchUrl(Uri.parse('$web/books/$bookId'), mode: LaunchMode.externalApplication);
    }
  }

  @override
  Future<String?> pickPhoto() async {
    final picked = await _router.push<Set<BaseAsset>>(AssetSelectionTimelineRoute());
    return picked?.map((asset) => asset.remoteId).nonNulls.firstOrNull;
  }

  @override
  Future<void> openRoutinesInbox() => _router.push(const RoutinesInboxRoute());

  @override
  Future<void> openRoutineRun(String runId) => _router.push(RoutineRunRoute(runId: runId));

  @override
  Future<bool> openAssets(List<String> assetIds, {int index = 0}) async {
    if (assetIds.isEmpty) {
      return false;
    }
    final tapped = assetIds[index.clamp(0, assetIds.length - 1)];
    var assets = await _resolve(assetIds);
    if (!assets.any((asset) => asset.id == tapped)) {
      // a photo the assistant just made (a crop, an artwork, a video) may not be synced yet
      await _ref.read(backgroundSyncProvider).syncRemote();
      assets = await _resolve(assetIds);
    }
    final initialIndex = assets.indexWhere((asset) => asset.id == tapped);
    if (initialIndex == -1) {
      return false;
    }

    final asset = assets[initialIndex];
    final viewer = _ref.read(assetViewerProvider.notifier);
    viewer.reset();
    if (asset.isVideo) {
      viewer.setControls(false);
    }
    viewer.setAsset(asset);
    unawaited(
      _router.push(
        AssetViewerRoute(
          initialIndex: initialIndex,
          timelineService: _ref.read(timelineFactoryProvider).fromAssets(assets, TimelineOrigin.deepLink),
        ),
      ),
    );
    return true;
  }

  Future<List<RemoteAsset>> _resolve(List<String> assetIds) async {
    final service = _ref.read(assetServiceProvider);
    final assets = <RemoteAsset>[];
    for (final id in assetIds) {
      try {
        final asset = await service.getRemoteAsset(id);
        if (asset != null) {
          assets.add(asset);
        }
      } catch (error, stackTrace) {
        _log.warning('Unable to look up asset $id', error, stackTrace);
      }
    }
    return assets;
  }

  @override
  Future<bool> openAlbum(String albumId) async {
    var album = await _ref.read(remoteAlbumServiceProvider).get(albumId);
    if (album == null) {
      await _ref.read(backgroundSyncProvider).syncRemote();
      album = await _ref.read(remoteAlbumServiceProvider).get(albumId);
    }
    if (album == null) {
      return false;
    }
    unawaited(_router.push(RemoteAlbumRoute(album: album)));
    return true;
  }

  @override
  Future<bool> openMemory(String memoryId) async {
    final service = MemoryService(_ref.read(driftProvider).memoryRepository, _ref.read(memoryApiRepositoryProvider));
    final memory = await service.get(memoryId);
    if (memory == null) {
      return false;
    }
    unawaited(_router.push(MemoryRoute(memories: [memory], memoryIndex: 0)));
    return true;
  }

  @override
  Future<bool> openTarget(NotificationTarget target) async {
    switch (target) {
      case BookNotificationTarget(:final bookId):
        unawaited(openBook(bookId));
        return true;
      case AssetNotificationTarget(:final assetId):
        return openAssets([assetId]);
      case AlbumNotificationTarget(:final albumId):
        return openAlbum(albumId);
      case MemoryNotificationTarget(:final memoryId):
        return openMemory(memoryId);
      case JournalNotificationTarget(:final pack, :final assetIds):
        unawaited(nameInJournal(pack: pack, assetIds: assetIds));
        return true;
      case RoutineRunNotificationTarget(:final runId):
        unawaited(openRoutineRun(runId));
        return true;
    }
  }
}

final galleryNavigatorProvider = Provider<GalleryNavigator>((ref) => RouterGalleryNavigator(ref));

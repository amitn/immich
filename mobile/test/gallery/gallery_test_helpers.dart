import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/services/toast.service.dart';
import 'package:openapi/api.dart';

/// A 1×1 transparent PNG
final kTransparentPng = Uint8List.fromList(const [
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, //
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, //
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, //
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, //
  0x42, 0x60, 0x82,
]);

/// Serves every image from memory, and records which were asked for
class FakeGalleryImages extends GalleryImages {
  final requested = <String>[];

  FakeGalleryImages();

  @override
  ImageProvider assetThumbnail(String assetId) {
    requested.add('asset:$assetId');
    return MemoryImage(kTransparentPng);
  }

  @override
  ImageProvider bookPage(String bookId, String pageId, {required int size, DateTime? cacheKey}) {
    requested.add('page:$bookId/$pageId@$size');
    return MemoryImage(kTransparentPng);
  }
}

/// Records where the screens lead
class FakeGalleryNavigator implements GalleryNavigator {
  final calls = <String>[];

  /// What openAssets, openAlbum, openMemory and openTarget answer
  bool available = true;

  @override
  Future<void> openAssistant({String? sessionId, List<String> assetIds = const [], String? prompt}) async =>
      calls.add('assistant session=$sessionId assets=${assetIds.join(',')} prompt=$prompt');

  @override
  Future<void> openBooks() async => calls.add('books');

  @override
  Future<void> openBook(String bookId) async => calls.add('book $bookId');

  @override
  Future<void> openNotifications() async => calls.add('notifications');

  @override
  Future<void> exportAlbumAsBook({
    required String albumId,
    required String albumName,
    required int assetCount,
    BookStylePreset? stylePreset,
  }) async => calls.add('export album $albumId as book${stylePreset == null ? '' : ' ($stylePreset)'}');

  @override
  Future<void> shareBook(String bookId) async => calls.add('share book $bookId');

  @override
  Future<bool> openAssets(List<String> assetIds, {int index = 0}) async {
    calls.add('assets ${assetIds.join(',')} at $index');
    return available;
  }

  @override
  Future<bool> openAlbum(String albumId) async {
    calls.add('album $albumId');
    return available;
  }

  @override
  Future<bool> openMemory(String memoryId) async {
    calls.add('memory $memoryId');
    return available;
  }

  @override
  Future<bool> openTarget(NotificationTarget target) async {
    switch (target) {
      case BookNotificationTarget(:final bookId):
        await openBook(bookId);
        return true;
      case AssetNotificationTarget(:final assetId):
        return openAssets([assetId]);
      case AlbumNotificationTarget(:final albumId):
        return openAlbum(albumId);
      case MemoryNotificationTarget(:final memoryId):
        return openMemory(memoryId);
    }
  }
}

/// Records the toasts
class FakeToastService extends ToastService {
  final successes = <String>[];
  final errors = <String>[];

  FakeToastService();

  @override
  FutureOr<void> success(String message, {ToastOption? toast}) {
    successes.add(message);
  }

  @override
  FutureOr<void> error(String message, {ToastOption? toast}) {
    errors.add(message);
  }
}

/// The overrides every assistant screen needs: the features, images, navigation and toasts
List<Override> galleryOverrides({
  GalleryFeatures features = const GalleryFeatures(assistant: true, artisticStyles: true),
  FakeGalleryImages? images,
  FakeGalleryNavigator? navigator,
  FakeToastService? toast,
}) => [
  galleryFeaturesProvider.overrideWithValue(features),
  galleryImagesProvider.overrideWithValue(images ?? FakeGalleryImages()),
  galleryNavigatorProvider.overrideWithValue(navigator ?? FakeGalleryNavigator()),
  toastServiceProvider.overrideWithValue(toast ?? FakeToastService()),
];

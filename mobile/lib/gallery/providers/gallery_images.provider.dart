import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

/// The URL of a page of a photo book rendered as a JPEG, [size] pixels on its long edge (100 to 4000); [cacheKey]
/// changes with the page, so an edited page is fetched again
String bookPageRenderUrl(String bookId, String pageId, {int size = 1200, DateTime? cacheKey}) {
  final base = '${Store.get(StoreKey.serverEndpoint)}/books/$bookId/pages/$pageId/render?size=${size.clamp(100, 4000)}';
  return cacheKey == null ? base : '$base&c=${cacheKey.millisecondsSinceEpoch}';
}

/// The images the assistant screens load from the server, behind a provider so tests can serve them from memory
class GalleryImages {
  const GalleryImages();

  ImageProvider assetThumbnail(String assetId) => RemoteImageProvider(url: getThumbnailUrlForRemoteId(assetId));

  /// A photo at screen size, e.g. a menu or a wall label to read
  ImageProvider assetPreview(String assetId, {String? cacheKey}) => RemoteImageProvider(
    url: getThumbnailUrlForRemoteId(assetId, type: AssetMediaSize.preview, thumbhash: cacheKey),
  );

  ImageProvider bookPage(String bookId, String pageId, {required int size, DateTime? cacheKey}) => RemoteImageProvider(
    url: bookPageRenderUrl(bookId, pageId, size: size, cacheKey: cacheKey),
  );
}

final galleryImagesProvider = Provider<GalleryImages>((ref) => const GalleryImages());

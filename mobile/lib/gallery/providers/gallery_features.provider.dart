import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:openapi/api.dart';

/// The server features of the assistant work (#3): the assistant, photo books, artistic styles and the rest.
///
/// A server without them (upstream Immich, or an older Gallery) reports none of these keys; the OpenAPI patches
/// default them to false, so every screen gated on them stays hidden there.
class GalleryFeatures {
  /// The AI assistant: chats, "Ask assistant" and "Create with assistant"
  final bool assistant;

  /// AI artistic style transforms of a photo
  final bool artisticStyles;

  /// The Stadia Maps styles of book maps
  final bool bookStadiaMaps;

  /// Restaurant names from OpenStreetMap, with the user's approval
  final bool restaurantLookup;

  const GalleryFeatures({
    this.assistant = false,
    this.artisticStyles = false,
    this.bookStadiaMaps = false,
    this.restaurantLookup = false,
  });

  factory GalleryFeatures.fromDto(ServerFeaturesDto dto) => GalleryFeatures(
    assistant: dto.assistant,
    artisticStyles: dto.artisticStyles,
    bookStadiaMaps: dto.bookStadiaMaps,
    restaurantLookup: dto.restaurantLookup,
  );

  /// Photo books come with the assistant, like on the web: the assistant designs them, and a server without it has
  /// no book endpoints
  bool get books => assistant;

  /// A Gallery server: the features with no flag of their own (journals, highlight videos, auto enhance) come with
  /// it. Upstream Immich reports none of these flags; a Gallery server with every one of them off is taken for it
  bool get gallery => assistant || artisticStyles || bookStadiaMaps || restaurantLookup;

  /// The highlight videos (`/highlights`)
  bool get highlights => gallery;

  /// Auto enhance (`/assets/{id}/enhance`): local image processing, no AI
  bool get autoEnhance => gallery;

  @override
  bool operator ==(Object other) =>
      other is GalleryFeatures &&
      other.assistant == assistant &&
      other.artisticStyles == artisticStyles &&
      other.bookStadiaMaps == bookStadiaMaps &&
      other.restaurantLookup == restaurantLookup;

  @override
  int get hashCode => Object.hash(assistant, artisticStyles, bookStadiaMaps, restaurantLookup);

  @override
  String toString() =>
      'GalleryFeatures(assistant: $assistant, artisticStyles: $artisticStyles, bookStadiaMaps: $bookStadiaMaps, '
      'restaurantLookup: $restaurantLookup)';
}

/// The assistant features of the connected server; refreshed with the server features (on connect and on a config
/// update over the websocket)
final galleryFeaturesProvider = Provider<GalleryFeatures>(
  (ref) => ref.watch(serverInfoProvider.select((info) => info.serverFeatures.gallery)),
);

/// The journals ("Name the dishes…"): on a Gallery server with smart search, which finds the photos of the subjects,
/// like the web's `isAvailable`
final galleryJournalsProvider = Provider<bool>(
  (ref) =>
      ref.watch(galleryFeaturesProvider.select((features) => features.gallery)) &&
      ref.watch(serverInfoProvider.select((info) => info.serverFeatures.smartSearch)),
);

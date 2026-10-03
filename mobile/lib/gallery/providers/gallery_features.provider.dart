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

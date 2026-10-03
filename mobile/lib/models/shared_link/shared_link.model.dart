import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:immich_mobile/gallery/shared_links/book_shared_link.dart';
import 'package:openapi/api.dart';

part 'shared_link.model.freezed.dart';

// book: Gallery photo books (#3)
enum SharedLinkSource { album, individual, book }

@freezed
abstract class SharedLink with _$SharedLink {
  const factory SharedLink({
    required String id,
    required String title,
    required bool allowDownload,
    required bool allowUpload,
    required String? thumbAssetId,
    required String? description,
    required String? password,
    required DateTime? expiresAt,
    required String key,
    required bool showMetadata,
    required SharedLinkSource type,
    required String? slug,
  }) = _SharedLink;

  factory SharedLink.fromDto(SharedLinkResponseDto dto) {
    if (dto.type == SharedLinkType.BOOK) {
      return bookSharedLinkFromDto(dto);
    }
    final isAlbum = dto.type == SharedLinkType.ALBUM;
    return SharedLink(
      id: dto.id,
      allowDownload: dto.allowDownload,
      allowUpload: dto.allowUpload,
      description: dto.description,
      password: dto.password,
      expiresAt: dto.expiresAt,
      key: dto.key,
      showMetadata: dto.showMetadata,
      slug: dto.slug,
      type: isAlbum ? SharedLinkSource.album : SharedLinkSource.individual,
      title: isAlbum ? dto.album.orElse(null)?.albumName.toUpperCase() ?? "UNKNOWN SHARE" : "INDIVIDUAL SHARE",
      thumbAssetId: isAlbum
          ? dto.album.orElse(null)?.albumThumbnailAssetId
          : dto.assets.isNotEmpty
          ? dto.assets[0].id
          : null,
    );
  }
}

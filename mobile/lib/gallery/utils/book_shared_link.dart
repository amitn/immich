import 'package:immich_mobile/models/shared_link/shared_link.model.dart';
import 'package:openapi/api.dart';

/// A shared link to a photo book (`SharedLinkType.BOOK`): titled after its book, without photos of its own, since a
/// book link shares the web book rather than the photos one by one
SharedLink bookSharedLinkFromDto(SharedLinkResponseDto dto) {
  final book = dto.book.orElse(null);
  return SharedLink(
    id: dto.id,
    title: book?.title.toUpperCase() ?? 'PHOTO BOOK',
    allowDownload: dto.allowDownload,
    // nobody uploads to a book
    allowUpload: false,
    thumbAssetId: null,
    description: dto.description,
    password: dto.password,
    expiresAt: dto.expiresAt,
    key: dto.key,
    showMetadata: dto.showMetadata,
    type: SharedLinkSource.book,
    slug: dto.slug,
  );
}

/// The body that creates a link to a photo book: no upload, and not tied to a space
SharedLinkCreateDto bookSharedLinkCreateDto({
  required String bookId,
  required bool showMetadata,
  required bool allowDownload,
  String? description,
  String? password,
  String? slug,
  DateTime? expiresAt,
}) => SharedLinkCreateDto(
  type: SharedLinkType.BOOK,
  bookId: Optional.present(bookId),
  assetIds: const Optional.absent(),
  showMetadata: Optional.present(showMetadata),
  allowDownload: Optional.present(allowDownload),
  allowUpload: const Optional.present(false),
  expiresAt: expiresAt == null ? const Optional.absent() : Optional.present(expiresAt),
  description: description == null ? const Optional.absent() : Optional.present(description),
  password: password == null ? const Optional.absent() : Optional.present(password),
  slug: slug == null ? const Optional.absent() : Optional.present(slug),
);

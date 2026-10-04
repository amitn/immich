import 'dart:typed_data';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// Photo books (`/books`)
class BookApiRepository extends ApiRepository {
  final ApiService _apiService;

  BookApiRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  BooksApi get _api => BooksApi(_apiService.serverInfoApi.apiClient);

  SearchApi get _search => SearchApi(_apiService.serverInfoApi.apiClient);

  /// The user's books (not the drafts), the most recently changed first
  Future<List<BookResponseDto>> getBooks() async {
    final books = await checkNull(_api.getBooks());
    return [...books]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  /// The books drafted for the user ("Suggested for you"), waiting to be kept or discarded
  Future<List<BookDraftResponseDto>> getDrafts() => checkNull(_api.getBookDrafts());

  /// Makes a draft one of the user's books
  Future<BookResponseDto> keepDraft(String bookId) => checkNull(_api.keepBookDraft(bookId));

  /// Deletes a draft; it is not suggested again
  Future<void> discardDraft(String bookId) => _api.discardBookDraft(bookId);

  Future<BookDetailResponseDto> getBook(String id) => checkNull(_api.getBook(id));

  /// The review of a book: what to fix, the people in it, good photos not used
  Future<BookReviewResponseDto> getReview(String id) => checkNull(_api.getBookReview(id));

  /// The style presets, with the style each stands for
  Future<List<BookStylePresetResponseDto>> getStylePresets() => checkNull(_api.getBookStylePresets());

  /// The styles of the user's own (e.g. designed with the assistant), oldest first like the presets
  Future<List<BookUserStyleResponseDto>> getUserStyles() async {
    final styles = await checkNull(_api.getBookUserStyles());
    return [...styles]..sort((a, b) {
      final byDate = a.createdAt.compareTo(b.createdAt);
      return byDate != 0 ? byDate : a.name.compareTo(b.name);
    });
  }

  /// Lays out a new book from the photos of an album
  Future<BookAutoLayoutResponseDto> createFromAlbum(BookFromAlbumDto dto) => checkNull(_api.createBookFromAlbum(dto));

  /// Queues the export of the print-ready PDF; poll [getBook] until `exportStatus` is completed
  Future<void> exportPdf(String id) =>
      _api.exportBook(id, bookExportDto: BookExportDto(format: const Optional.present(BookExportFormat.pdf)));

  /// The page layouts a page can take (`GET /books/layouts`)
  Future<List<BookLayoutResponseDto>> getLayouts() => checkNull(_api.getBookLayouts());

  /// Inserts a page with [layout] at [position] (appended without one)
  Future<BookPageResponseDto> addPage(String bookId, String layout, {int? position}) => checkNull(
    _api.addBookPage(
      bookId,
      BookPageCreateDto(
        layout: layout,
        position: position == null ? const Optional.absent() : Optional.present(position),
      ),
    ),
  );

  /// Changes the layout, section title or caption of a page; a null text clears it. Photos in slots the new layout
  /// lacks are removed by the server.
  Future<BookPageResponseDto> updatePage(
    String bookId,
    String pageId, {
    String? layout,
    Optional<String?> sectionTitle = const Optional.absent(),
    Optional<String?> caption = const Optional.absent(),
  }) => checkNull(
    _api.updateBookPage(
      bookId,
      pageId,
      BookPageUpdateDto(
        layout: layout == null ? const Optional.absent() : Optional.present(layout),
        sectionTitle: sectionTitle,
        caption: caption,
      ),
    ),
  );

  Future<void> removePage(String bookId, String pageId) => _api.removeBookPage(bookId, pageId);

  /// Moves a page to [position] (zero based); the other pages shift
  Future<BookPageResponseDto> movePage(String bookId, String pageId, int position) =>
      checkNull(_api.moveBookPage(bookId, pageId, BookPageMoveDto(position: position)));

  /// Places a photo in a slot; the server chooses a crop that fits the slot
  Future<BookPageResponseDto> placePhoto(String bookId, String pageId, int slot, String assetId) =>
      checkNull(_api.setBookSlot(bookId, pageId, slot, BookSlotUpdateDto(assetId: assetId)));

  /// Changes the crop (null: back to the default crop) or the caption (null clears it) of a placed photo
  Future<BookPageResponseDto> updateSlot(
    String bookId,
    String pageId,
    int slot, {
    Optional<NormalizedRect?> crop = const Optional.absent(),
    Optional<String?> caption = const Optional.absent(),
  }) => checkNull(_api.updateBookSlot(bookId, pageId, slot, BookSlotPatchDto(crop: crop, caption: caption)));

  /// Takes the photo out of a slot
  Future<BookPageResponseDto> clearSlot(String bookId, String pageId, int slot) =>
      checkNull(_api.clearBookSlot(bookId, pageId, slot));

  /// A page rendered as a JPEG, [size] pixels on its long edge
  Future<Uint8List> renderPage(String bookId, String pageId, {required int size}) async {
    final response = await _api.renderBookPageWithHttpInfo(bookId, pageId, size: size.clamp(100, 4000));
    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, response.body);
    }
    return response.bodyBytes;
  }

  /// The photos of an album to choose from for a slot, oldest first like the book
  Future<List<AssetResponseDto>> getAlbumPhotos(String albumId, {int limit = 500}) async {
    final response = await checkNull(
      _search.searchAssets(
        MetadataSearchDto(
          albumIds: Optional.present([albumId]),
          type: const Optional.present(AssetTypeEnum.IMAGE),
          order: const Optional.present(AssetOrder.asc),
          size: Optional.present(limit),
        ),
      ),
    );
    return response.assets.items;
  }

  /// The exported PDF
  Future<Uint8List> downloadPdf(String id) async {
    final response = await _api.downloadBookPdfWithHttpInfo(id);
    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, response.body);
    }
    return response.bodyBytes;
  }
}

final bookApiRepositoryProvider = Provider<BookApiRepository>(
  (ref) => BookApiRepository(ref.watch(apiServiceProvider)),
);

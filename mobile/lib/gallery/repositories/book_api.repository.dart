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

  /// Queues the export of the print-ready PDF; poll [getBook] until `exportStatus` is completed
  Future<void> exportPdf(String id) =>
      _api.exportBook(id, bookExportDto: BookExportDto(format: const Optional.present(BookExportFormat.pdf)));

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

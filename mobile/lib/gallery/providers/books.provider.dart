import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:immich_mobile/gallery/repositories/book_offline_cache.repository.dart';
import 'package:openapi/api.dart';

/// The photo books page: the user's books, and the books drafted for them
class BooksState {
  final List<BookResponseDto> books;
  final List<BookDraftResponseDto> drafts;

  /// The draft whose Keep or Discard is in progress
  final String? busyDraftId;

  const BooksState({required this.books, required this.drafts, this.busyDraftId});

  BooksState copyWith({
    List<BookResponseDto>? books,
    List<BookDraftResponseDto>? drafts,
    String? Function()? busyDraftId,
  }) => BooksState(
    books: books ?? this.books,
    drafts: drafts ?? this.drafts,
    busyDraftId: busyDraftId == null ? this.busyDraftId : busyDraftId(),
  );
}

/// A server-backed list: loaded from the server, changed in place by Keep and Discard, and reloaded when a
/// notification brings a new book (a draft, a finished export)
class BooksNotifier extends StateNotifier<AsyncValue<BooksState>> {
  final BookApiRepository _repository;
  StreamSubscription<GalleryNotification>? _notifications;

  BooksNotifier(this._repository, GalleryEventBus bus) : super(const AsyncValue.loading()) {
    _notifications = bus.notifications.listen((notification) {
      if (notification.target is BookNotificationTarget) {
        unawaited(load());
      }
    });
    unawaited(load());
  }

  @override
  void dispose() {
    unawaited(_notifications?.cancel());
    super.dispose();
  }

  Future<void> load() async {
    try {
      final results = await Future.wait([_repository.getBooks(), _repository.getDrafts()]);
      if (mounted) {
        state = AsyncValue.data(
          BooksState(books: results[0] as List<BookResponseDto>, drafts: results[1] as List<BookDraftResponseDto>),
        );
      }
    } catch (error, stackTrace) {
      if (mounted && !state.hasValue) {
        state = AsyncValue.error(error, stackTrace);
      }
    }
  }

  BooksState? get _current => state.valueOrNull;

  void _setBusy(String? draftId) {
    final current = _current;
    if (current != null) {
      state = AsyncValue.data(current.copyWith(busyDraftId: () => draftId));
    }
  }

  /// Makes a draft one of the user's books; it moves from the suggestions to the books
  Future<BookResponseDto> keep(BookDraftResponseDto draft) async {
    _setBusy(draft.id);
    try {
      final book = await _repository.keepDraft(draft.book.id);
      final current = _current;
      if (current != null) {
        state = AsyncValue.data(
          BooksState(
            books: [book, ...current.books.where((other) => other.id != book.id)],
            drafts: current.drafts.where((other) => other.id != draft.id).toList(),
          ),
        );
      }
      return book;
    } finally {
      if (_current?.busyDraftId == draft.id) {
        _setBusy(null);
      }
    }
  }

  /// Deletes a draft; it is not suggested again
  Future<void> discard(BookDraftResponseDto draft) async {
    _setBusy(draft.id);
    try {
      await _repository.discardDraft(draft.book.id);
      final current = _current;
      if (current != null) {
        state = AsyncValue.data(
          BooksState(books: current.books, drafts: current.drafts.where((other) => other.id != draft.id).toList()),
        );
      }
    } finally {
      if (_current?.busyDraftId == draft.id) {
        _setBusy(null);
      }
    }
  }
}

final booksProvider = StateNotifierProvider.autoDispose<BooksNotifier, AsyncValue<BooksState>>(
  (ref) => BooksNotifier(ref.watch(bookApiRepositoryProvider), ref.watch(galleryEventBusProvider)),
);

/// A book as the viewer shows it: from the server, or the copy kept on the device when the server can't be reached
class BookView {
  final BookDetailResponseDto book;

  /// Shown from the copy kept on the device: read only
  final bool offline;

  const BookView(this.book, {this.offline = false});

  /// The pages in book order
  List<BookPageResponseDto> get pages => [...book.pages]..sort((a, b) => a.position.compareTo(b.position));
}

/// A book with its pages, kept on the device for offline viewing, and the page edits of the phone: each edit goes to
/// the server and the page it answers replaces the one shown (a move, an added or a removed page reloads the book,
/// since the other pages shift)
class BookDetailNotifier extends AutoDisposeFamilyAsyncNotifier<BookView, String> {
  BookApiRepository get _repository => ref.read(bookApiRepositoryProvider);

  BookOfflineCache get _cache => ref.read(bookOfflineCacheProvider);

  @override
  Future<BookView> build(String arg) async {
    final repository = ref.watch(bookApiRepositoryProvider);
    final cache = ref.watch(bookOfflineCacheProvider);
    try {
      final book = await repository.getBook(arg);
      unawaited(cache.saveBook(book));
      return BookView(book);
    } on ApiException catch (error, stackTrace) {
      // the book is gone or no longer the user's: no offline copy stands in for it
      if (_answeredByServer.contains(error.code)) {
        rethrow;
      }
      return _offline(cache, arg, error, stackTrace);
    } catch (error, stackTrace) {
      return _offline(cache, arg, error, stackTrace);
    }
  }

  static const _answeredByServer = {401, 403, 404};

  Future<BookView> _offline(BookOfflineCache cache, String id, Object error, StackTrace stackTrace) async {
    final kept = await cache.loadBook(id);
    if (kept == null) {
      Error.throwWithStackTrace(error, stackTrace);
    }
    return BookView(kept, offline: true);
  }

  BookDetailResponseDto? get _book => state.valueOrNull?.book;

  void _set(BookDetailResponseDto book) {
    state = AsyncValue.data(BookView(book));
    unawaited(_cache.saveBook(book));
  }

  /// Shows the page the server answered for an edit
  void _apply(BookPageResponseDto page) {
    final book = _book;
    if (book == null) {
      return;
    }
    final json = book.toJson()
      ..['pages'] = [for (final other in book.pages) other.id == page.id ? page.toJson() : other.toJson()];
    final updated = BookDetailResponseDto.fromJson(jsonDecode(jsonEncode(json)));
    if (updated != null) {
      _set(updated);
    }
  }

  /// Loads the book again, without showing a spinner in between
  Future<void> refresh() async => _set(await _repository.getBook(arg));

  Future<void> setLayout(String pageId, String layout) async =>
      _apply(await _repository.updatePage(arg, pageId, layout: layout));

  /// Sets the section title of a page; empty clears it
  Future<void> setSectionTitle(String pageId, String text) async =>
      _apply(await _repository.updatePage(arg, pageId, sectionTitle: Optional.present(_text(text))));

  /// Sets the caption of a page; empty clears it
  Future<void> setPageCaption(String pageId, String text) async =>
      _apply(await _repository.updatePage(arg, pageId, caption: Optional.present(_text(text))));

  Future<void> placePhoto(String pageId, int slot, String assetId) async =>
      _apply(await _repository.placePhoto(arg, pageId, slot, assetId));

  /// Sets the crop of a placed photo; null goes back to the crop the server chooses
  Future<void> setCrop(String pageId, int slot, NormalizedRect? crop) async =>
      _apply(await _repository.updateSlot(arg, pageId, slot, crop: Optional.present(crop)));

  /// Sets the caption of a placed photo; empty clears it
  Future<void> setPhotoCaption(String pageId, int slot, String text) async =>
      _apply(await _repository.updateSlot(arg, pageId, slot, caption: Optional.present(_text(text))));

  Future<void> removePhoto(String pageId, int slot) async => _apply(await _repository.clearSlot(arg, pageId, slot));

  /// Moves a page to [position] (zero based)
  Future<void> movePage(String pageId, int position) async {
    await _repository.movePage(arg, pageId, position);
    await refresh();
  }

  /// Adds a page with [layout] at [position]; answers the new page's id
  Future<String> addPage(String layout, {required int position}) async {
    final page = await _repository.addPage(arg, layout, position: position);
    await refresh();
    return page.id;
  }

  Future<void> removePage(String pageId) async {
    await _repository.removePage(arg, pageId);
    await refresh();
  }

  static String? _text(String text) => text.trim().isEmpty ? null : text.trim();
}

final bookDetailProvider = AsyncNotifierProvider.autoDispose.family<BookDetailNotifier, BookView, String>(
  BookDetailNotifier.new,
);

/// The page layouts (the same for every book)
final bookLayoutsProvider = FutureProvider.autoDispose<List<BookLayoutResponseDto>>(
  (ref) => ref.watch(bookApiRepositoryProvider).getLayouts(),
);

/// The photos of an album to choose from for a slot of a book
final bookAlbumPhotosProvider = FutureProvider.autoDispose.family<List<AssetResponseDto>, String>(
  (ref, albumId) => ref.watch(bookApiRepositoryProvider).getAlbumPhotos(albumId),
);

/// The review of a book (read only in the app: the fixes go through the assistant or the web)
final bookReviewProvider = FutureProvider.autoDispose.family<BookReviewResponseDto, String>(
  (ref, id) => ref.watch(bookApiRepositoryProvider).getReview(id),
);

/// The PDF export failed on the server
class BookExportFailedException implements Exception {
  const BookExportFailedException();
}

/// The print-ready PDF of a book: the exported one when it is up to date, else a new export, polled until done
Future<Uint8List> fetchBookPdf(
  BookApiRepository repository,
  String bookId, {
  required BookExportStatus? exportStatus,
  required bool exportStale,
  Duration interval = const Duration(seconds: 2),
  Duration timeout = const Duration(minutes: 15),
  void Function()? onExporting,
}) async {
  if (exportStatus == BookExportStatus.completed && !exportStale) {
    return repository.downloadPdf(bookId);
  }

  final running = exportStatus == BookExportStatus.pending || exportStatus == BookExportStatus.running;
  if (!running) {
    await repository.exportPdf(bookId);
  }
  onExporting?.call();

  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(interval);
    final current = await repository.getBook(bookId);
    switch (current.exportStatus) {
      case BookExportStatus.completed:
        return repository.downloadPdf(bookId);
      case BookExportStatus.failed:
        throw const BookExportFailedException();
      default:
        continue;
    }
  }
  throw TimeoutException('The PDF export of book $bookId did not finish', timeout);
}

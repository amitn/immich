import 'dart:async';
import 'dart:typed_data';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
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

/// A book with its pages
final bookDetailProvider = FutureProvider.autoDispose.family<BookDetailResponseDto, String>(
  (ref, id) => ref.watch(bookApiRepositoryProvider).getBook(id),
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

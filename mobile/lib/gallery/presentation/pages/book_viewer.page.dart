import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_page_view.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_review_sheet.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_confirm_dialog.widget.dart';
import 'package:immich_mobile/gallery/providers/books.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Hands a downloaded PDF to the user: saved to a file and offered to the system share sheet (save to files, print,
/// send). Behind a provider so tests can catch it.
typedef BookPdfSaver = Future<void> Function(String title, Uint8List bytes);

final bookPdfSaverProvider = Provider<BookPdfSaver>(
  (ref) => (title, bytes) async {
    final directory = await getTemporaryDirectory();
    final name = title.replaceAll(RegExp(r'[^\p{L}\p{N} _-]+', unicode: true), '').trim();
    final file = File('${directory.path}/${name.isEmpty ? 'book' : name}.pdf');
    await file.writeAsBytes(bytes, flush: true);
    await Share.shareXFiles([XFile(file.path, mimeType: 'application/pdf')], subject: title);
  },
);

/// A photo book, page by page: its review, a link to share it, its PDF, and Keep or Discard for a draft
@RoutePage()
class BookViewerPage extends HookConsumerWidget {
  final String bookId;

  const BookViewerPage({super.key, required this.bookId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final bookAsync = ref.watch(bookDetailProvider(bookId));
    final assistant = ref.watch(galleryFeaturesProvider.select((features) => features.assistant));
    final controller = usePageController();
    final pageIndex = useState(0);
    final exporting = useState(false);
    final draftBusy = useState(false);
    final navigator = ref.read(galleryNavigatorProvider);
    final book = bookAsync.valueOrNull;
    final pageCount = book?.pages.length ?? 0;

    Future<void> goToPage(int index) async {
      if (!controller.hasClients) {
        return;
      }
      await controller.animateToPage(index, duration: const Duration(milliseconds: 350), curve: Curves.easeOutCubic);
    }

    Future<void> downloadPdf(BookDetailResponseDto book) async {
      if (exporting.value) {
        return;
      }
      exporting.value = true;
      final toast = ref.read(toastServiceProvider);
      try {
        final bytes = await fetchBookPdf(
          ref.read(bookApiRepositoryProvider),
          book.id,
          exportStatus: book.exportStatus,
          exportStale: book.exportStale,
        );
        await ref.read(bookPdfSaverProvider)(book.title, bytes);
      } on BookExportFailedException {
        await toast.error(t.book_export_status_failed);
      } catch (_) {
        await toast.error(t.errors.unable_to_export_book);
      } finally {
        if (context.mounted) {
          exporting.value = false;
        }
      }
    }

    Future<void> keepDraft(BookDetailResponseDto book) async {
      draftBusy.value = true;
      try {
        await ref.read(bookApiRepositoryProvider).keepDraft(book.id);
        ref.invalidate(bookDetailProvider(bookId));
        await ref.read(toastServiceProvider).success(t.book_draft_kept(title: book.title));
      } catch (_) {
        await ref.read(toastServiceProvider).error(t.errors.unable_to_keep_book_draft);
      } finally {
        if (context.mounted) {
          draftBusy.value = false;
        }
      }
    }

    Future<void> discardDraft(BookDetailResponseDto book) async {
      final confirmed = await showGalleryConfirmDialog(
        context,
        title: t.book_draft_discard,
        content: t.book_draft_discard_prompt(title: book.title),
        confirmText: t.book_draft_discard,
      );
      if (!confirmed) {
        return;
      }
      draftBusy.value = true;
      try {
        await ref.read(bookApiRepositoryProvider).discardDraft(book.id);
        await ref.read(toastServiceProvider).success(t.book_draft_discarded(title: book.title));
        if (context.mounted) {
          await Navigator.of(context).maybePop();
        }
      } catch (_) {
        await ref.read(toastServiceProvider).error(t.errors.unable_to_discard_book_draft);
      } finally {
        if (context.mounted) {
          draftBusy.value = false;
        }
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(book?.title ?? t.photo_books, maxLines: 1, overflow: TextOverflow.ellipsis),
        bottom: exporting.value
            ? PreferredSize(
                preferredSize: const Size.fromHeight(28),
                child: Column(
                  children: [
                    Text(t.book_exporting, style: Theme.of(context).textTheme.labelSmall),
                    const SizedBox(height: 4),
                    const LinearProgressIndicator(key: Key('book-exporting')),
                  ],
                ),
              )
            : null,
        actions: book == null
            ? null
            : [
                IconButton(
                  key: const Key('book-review-button'),
                  tooltip: t.book_review,
                  onPressed: () => unawaited(
                    showBookReviewSheet(context, book.id, onGoToPage: (page) => unawaited(goToPage(page - 1))),
                  ),
                  icon: const Icon(Icons.fact_check_outlined),
                ),
                IconButton(
                  key: const Key('book-share-button'),
                  tooltip: t.share_link,
                  onPressed: () => unawaited(navigator.shareBook(book.id)),
                  icon: const Icon(Icons.link),
                ),
                PopupMenuButton<String>(
                  key: const Key('book-menu'),
                  onSelected: (value) {
                    switch (value) {
                      case 'pdf':
                        unawaited(downloadPdf(book));
                      case 'assistant':
                        unawaited(
                          navigator.openAssistant(
                            prompt: t.book_edit_prompt(title: book.title, id: book.id),
                          ),
                        );
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      key: const Key('book-download-pdf'),
                      value: 'pdf',
                      enabled: !exporting.value,
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.picture_as_pdf_outlined),
                        title: Text(t.book_download_pdf),
                      ),
                    ),
                    if (assistant)
                      PopupMenuItem(
                        key: const Key('book-edit-with-assistant'),
                        value: 'assistant',
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.auto_awesome_outlined),
                          title: Text(t.book_edit_with_assistant),
                        ),
                      ),
                  ],
                ),
              ],
      ),
      body: bookAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            spacing: 8,
            children: [
              Text(t.errors.unable_to_load_book),
              TextButton(onPressed: () => ref.invalidate(bookDetailProvider(bookId)), child: Text(t.retry)),
            ],
          ),
        ),
        data: (book) => Column(
          children: [
            if (book.status == BookStatus.draft)
              MaterialBanner(
                key: const Key('book-draft-banner'),
                leading: const Icon(Icons.auto_awesome_outlined),
                content: Text(t.book_draft_banner),
                actions: [
                  TextButton(
                    onPressed: draftBusy.value ? null : () => unawaited(discardDraft(book)),
                    child: Text(t.book_draft_discard),
                  ),
                  FilledButton(
                    key: const Key('book-draft-banner-keep'),
                    onPressed: draftBusy.value ? null : () => unawaited(keepDraft(book)),
                    child: Text(t.book_draft_keep),
                  ),
                ],
              ),
            Expanded(
              child: book.pages.isEmpty
                  ? Center(child: Text(t.book_no_pages))
                  : BookPageView(book: book, controller: controller, onPageChanged: (index) => pageIndex.value = index),
            ),
            if (pageCount > 0)
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                  child: Row(
                    children: [
                      IconButton(
                        key: const Key('book-previous-page'),
                        onPressed: pageIndex.value == 0 ? null : () => unawaited(goToPage(pageIndex.value - 1)),
                        icon: const Icon(Icons.chevron_left),
                      ),
                      Expanded(
                        child: pageCount > 2
                            ? Slider(
                                value: pageIndex.value.toDouble(),
                                max: (pageCount - 1).toDouble(),
                                divisions: pageCount - 1,
                                label: '${pageIndex.value + 1}',
                                onChanged: (value) => controller.jumpToPage(value.round()),
                              )
                            : const SizedBox.shrink(),
                      ),
                      Text(
                        t.book_page_of(page: pageIndex.value + 1, total: pageCount),
                        key: const Key('book-page-indicator'),
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                      IconButton(
                        key: const Key('book-next-page'),
                        onPressed: pageIndex.value >= pageCount - 1
                            ? null
                            : () => unawaited(goToPage(pageIndex.value + 1)),
                        icon: const Icon(Icons.chevron_right),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

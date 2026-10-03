import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_card.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_confirm_dialog.widget.dart';
import 'package:immich_mobile/gallery/providers/books.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';

/// The user's photo books, and the books drafted for them ("Suggested for you")
@RoutePage()
class BooksPage extends ConsumerWidget {
  const BooksPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final assistant = ref.watch(galleryFeaturesProvider.select((features) => features.assistant));
    final booksAsync = ref.watch(booksProvider);
    final notifier = ref.read(booksProvider.notifier);
    final navigator = ref.read(galleryNavigatorProvider);

    Future<void> createWithAssistant() => navigator.openAssistant(prompt: t.book_create_prompt);

    Future<void> keep(BookDraftResponseDto draft) async {
      try {
        await notifier.keep(draft);
        await ref.read(toastServiceProvider).success(t.book_draft_kept(title: draft.book.title));
      } catch (_) {
        await ref.read(toastServiceProvider).error(t.errors.unable_to_keep_book_draft);
      }
    }

    Future<void> discard(BookDraftResponseDto draft) async {
      final confirmed = await showGalleryConfirmDialog(
        context,
        title: t.book_draft_discard,
        content: t.book_draft_discard_prompt(title: draft.book.title),
        confirmText: t.book_draft_discard,
      );
      if (!confirmed) {
        return;
      }
      try {
        await notifier.discard(draft);
        await ref.read(toastServiceProvider).success(t.book_draft_discarded(title: draft.book.title));
      } catch (_) {
        await ref.read(toastServiceProvider).error(t.errors.unable_to_discard_book_draft);
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(t.photo_books),
        actions: [
          if (assistant)
            IconButton(
              key: const Key('books-create-with-assistant'),
              tooltip: t.book_create_with_assistant,
              onPressed: () => unawaited(createWithAssistant()),
              icon: const Icon(Icons.auto_awesome_outlined),
            ),
        ],
      ),
      body: booksAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => _Message(
          icon: Icons.error_outline,
          title: t.errors.unable_to_load_books,
          action: TextButton(onPressed: () => unawaited(notifier.load()), child: Text(t.retry)),
        ),
        data: (state) {
          if (state.books.isEmpty && state.drafts.isEmpty) {
            return _Message(
              icon: Icons.menu_book_outlined,
              title: t.book_empty_title,
              description: t.book_empty_description,
              action: assistant
                  ? FilledButton.icon(
                      onPressed: () => unawaited(createWithAssistant()),
                      icon: const Icon(Icons.auto_awesome_outlined),
                      label: Text(t.book_create_with_assistant),
                    )
                  : null,
            );
          }

          final rows = <List<BookResponseDto>>[
            for (var i = 0; i < state.books.length; i += 2) state.books.skip(i).take(2).toList(),
          ];
          final theme = Theme.of(context);
          return RefreshIndicator(
            onRefresh: notifier.load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 32),
              children: [
                if (state.drafts.isNotEmpty) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
                    child: Text(t.book_drafts_title, style: theme.textTheme.titleMedium),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 2, 4, 8),
                    child: Text(
                      t.book_drafts_description,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ),
                  for (final draft in state.drafts)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: BookDraftCard(
                        draft: draft,
                        busy: state.busyDraftId == draft.id,
                        onOpen: () => unawaited(navigator.openBook(draft.book.id)),
                        onKeep: () => unawaited(keep(draft)),
                        onDiscard: () => unawaited(discard(draft)),
                      ),
                    ),
                  if (state.books.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 16, 4, 4),
                      child: Text(t.book_your_books, style: theme.textTheme.titleMedium),
                    ),
                ],
                for (final row in rows)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final book in row)
                        Expanded(
                          child: BookCard(book: book, onTap: () => unawaited(navigator.openBook(book.id))),
                        ),
                      if (row.length == 1) const Expanded(child: SizedBox.shrink()),
                    ],
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? description;
  final Widget? action;

  const _Message({required this.icon, required this.title, this.description, this.action});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 12,
          children: [
            Icon(icon, size: 48, color: theme.colorScheme.onSurfaceVariant),
            Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            if (description != null)
              Text(
                description!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ?action,
          ],
        ),
      ),
    );
  }
}

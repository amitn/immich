import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_asset_strip.widget.dart';
import 'package:immich_mobile/gallery/providers/books.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// The label of a kind of review issue
String bookReviewIssueLabel(BuildContext context, BookReviewIssueType type) {
  final t = context.t;
  return switch (type) {
    BookReviewIssueType.duplicateStack => t.book_review_issue_duplicate_stack,
    BookReviewIssueType.lowDpi => t.book_review_issue_low_dpi,
    BookReviewIssueType.emptySlot => t.book_review_issue_empty_slot,
    BookReviewIssueType.tooMuchArtwork => t.book_review_issue_too_much_artwork,
    BookReviewIssueType.artworkBackToBack => t.book_review_issue_artwork_back_to_back,
    BookReviewIssueType.singlesInARow => t.book_review_issue_singles_in_a_row,
    BookReviewIssueType.similarNeighbours => t.book_review_issue_similar_neighbours,
    BookReviewIssueType.mapStyleFallback => t.book_review_issue_map_style_fallback,
    BookReviewIssueType.personUnderrepresented => t.book_review_issue_person_underrepresented,
    BookReviewIssueType.tooManyPairs => t.book_review_issue_too_many_pairs,
    BookReviewIssueType.repeatedLayout => t.book_review_issue_repeated_layout,
    BookReviewIssueType.missingCaptions => t.book_review_issue_missing_captions,
    BookReviewIssueType.couldLookBetter => t.book_review_issue_could_look_better,
    BookReviewIssueType.missingDishName => t.book_review_issue_missing_dish_name,
    BookReviewIssueType.missingMenuPage => t.book_review_issue_missing_menu_page,
    BookReviewIssueType.privacy => t.book_review_issue_privacy,
  };
}

/// Opens the review of a book in a sheet
Future<void> showBookReviewSheet(BuildContext context, String bookId, {void Function(int page)? onGoToPage}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.95,
        builder: (context, controller) => BookReviewPanel(
          bookId: bookId,
          scrollController: controller,
          onGoToPage: onGoToPage == null
              ? null
              : (page) {
                  Navigator.of(context).pop();
                  onGoToPage(page);
                },
        ),
      ),
    );

/// What the review found in a book, read only: the issues by severity, the people, good photos not used and the
/// weakest ones in the book. Fixing goes through the assistant or the web.
class BookReviewPanel extends ConsumerWidget {
  final String bookId;
  final ScrollController? scrollController;
  final void Function(int page)? onGoToPage;

  const BookReviewPanel({super.key, required this.bookId, this.scrollController, this.onGoToPage});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final review = ref.watch(bookReviewProvider(bookId));

    return review.when(
      loading: () => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 12,
          children: [const CircularProgressIndicator(), Text(t.book_review_loading)],
        ),
      ),
      error: (_, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 8,
          children: [
            Text(t.errors.unable_to_load_book_review),
            TextButton(onPressed: () => ref.invalidate(bookReviewProvider(bookId)), child: Text(t.retry)),
          ],
        ),
      ),
      data: (review) {
        final severities = [
          (BookReviewIssueDtoSeverityEnum.high, t.book_review_severity_high, colorScheme.error),
          (BookReviewIssueDtoSeverityEnum.medium, t.book_review_severity_medium, colorScheme.tertiary),
          (BookReviewIssueDtoSeverityEnum.low, t.book_review_severity_low, colorScheme.onSurfaceVariant),
        ];
        final unused = review.unusedPhotos.map((photo) => photo.assetId).toList();
        final weakest = review.weakestPlaced.map((photo) => photo.assetId).toList();

        Widget heading(String title, [String? description]) => Padding(
          padding: const EdgeInsets.only(top: 20, bottom: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: theme.textTheme.titleSmall),
              if (description != null)
                Text(description, style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant)),
            ],
          ),
        );

        return ListView(
          key: const Key('book-review'),
          controller: scrollController,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          children: [
            Text(t.book_review_title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              t.book_review_summary(high: review.counts.high, medium: review.counts.medium, low: review.counts.low),
              style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.onSurfaceVariant),
            ),
            if (review.issues.isEmpty) ...[
              const SizedBox(height: 24),
              Icon(Icons.verified_outlined, size: 40, color: colorScheme.primary),
              const SizedBox(height: 8),
              Text(t.book_review_no_issues, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
              Text(
                t.book_review_no_issues_description,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
              ),
            ],
            for (final (severity, label, color) in severities)
              if (review.issues.any((issue) => issue.severity == severity)) ...[
                heading(label),
                for (final issue in review.issues.where((issue) => issue.severity == severity))
                  _Issue(issue: issue, color: color, onGoToPage: onGoToPage),
              ],
            if (review.people.isNotEmpty) ...[
              heading(t.book_review_people, t.book_review_people_description),
              for (final person in review.people)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.person_outline),
                  title: Text(person.name.orElse(null) ?? '—'),
                  subtitle: Text(t.book_review_person_count(placed: person.placed, photos: person.photos)),
                ),
            ],
            if (unused.isNotEmpty) ...[
              heading(t.book_review_unused_photos, t.book_review_unused_photos_description),
              AssistantAssetStrip(assetIds: unused, size: 64),
            ],
            if (weakest.isNotEmpty) ...[
              heading(t.book_review_weakest_photos, t.book_review_weakest_photos_description),
              AssistantAssetStrip(assetIds: weakest, size: 64),
            ],
          ],
        );
      },
    );
  }
}

class _Issue extends StatelessWidget {
  final BookReviewIssueDto issue;
  final Color color;
  final void Function(int page)? onGoToPage;

  const _Issue({required this.issue, required this.color, required this.onGoToPage});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final assetIds = issue.assetIds.orElse(null) ?? const <String>[];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Icon(Icons.circle, size: 10, color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 4,
              children: [
                Text(bookReviewIssueLabel(context, issue.type), style: theme.textTheme.labelLarge),
                Text(issue.message, style: theme.textTheme.bodySmall),
                if (issue.pages.isNotEmpty)
                  Wrap(
                    spacing: 6,
                    children: [
                      for (final page in issue.pages)
                        ActionChip(
                          visualDensity: VisualDensity.compact,
                          label: Text(context.t.book_page_image(page: page)),
                          onPressed: onGoToPage == null ? null : () => onGoToPage!(page),
                        ),
                    ],
                  ),
                if (assetIds.isNotEmpty) AssistantAssetStrip(assetIds: assetIds, size: 44),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

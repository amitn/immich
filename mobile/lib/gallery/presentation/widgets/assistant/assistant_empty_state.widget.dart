import 'package:flutter/material.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// A new chat: what the assistant does, and example prompts to start from
class AssistantEmptyState extends StatelessWidget {
  final bool hasPhotos;
  final void Function(String prompt) onExample;

  const AssistantEmptyState({super.key, required this.hasPhotos, required this.onExample});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final examples = hasPhotos
        ? [
            context.t.assistant_example_album_from_selection,
            context.t.assistant_example_crop_square,
            context.t.assistant_example_describe,
          ]
        : [
            context.t.assistant_example_beach_album,
            context.t.assistant_example_best_of_year,
            context.t.assistant_example_italy_book,
            context.t.assistant_example_book_with_maps,
          ];

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
      children: [
        Center(
          child: CircleAvatar(
            radius: 32,
            backgroundColor: colorScheme.primaryContainer,
            child: Icon(Icons.auto_awesome, size: 32, color: colorScheme.onPrimaryContainer),
          ),
        ),
        const SizedBox(height: 16),
        Text(context.t.assistant_empty_title, textAlign: TextAlign.center, style: theme.textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(
          hasPhotos ? context.t.assistant_empty_description_with_photos : context.t.assistant_empty_description,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 24),
        Text(context.t.assistant_example_prompts, style: theme.textTheme.labelLarge),
        const SizedBox(height: 8),
        for (final example in examples)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                alignment: Alignment.centerLeft,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
              onPressed: () => onExample(example),
              child: Text(example),
            ),
          ),
      ],
    );
  }
}

/// The server has the assistant turned off (or does not have it)
class AssistantDisabledState extends StatelessWidget {
  const AssistantDisabledState({super.key});

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
            Icon(Icons.auto_awesome_outlined, size: 48, color: theme.colorScheme.onSurfaceVariant),
            Text(context.t.assistant_disabled_title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            Text(
              context.t.assistant_disabled_description,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

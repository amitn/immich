import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_asset_strip.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_links.widget.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// The compact input of a tool call or permission request, for its details
String? formatToolInput(Object? input) {
  if (input == null) {
    return null;
  }
  if (input is String) {
    return input;
  }
  try {
    return const JsonEncoder.withIndent('  ').convert(input);
  } catch (_) {
    return input.toString();
  }
}

/// A tool the assistant ran: its status, the photos it found or made, and its input and output on demand
class AssistantToolCallCard extends StatelessWidget {
  final AssistantMessage message;

  const AssistantToolCallCard({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final status = message.status ?? AssistantToolStatus.pending;
    final title = message.title ?? message.shortToolName ?? context.t.assistant_tool_call;
    final input = formatToolInput(message.input);
    final output = message.output;

    final statusLabel = switch (status) {
      AssistantToolStatus.inProgress => context.t.assistant_tool_status_in_progress,
      AssistantToolStatus.completed => context.t.assistant_tool_status_completed,
      AssistantToolStatus.failed => context.t.assistant_tool_status_failed,
      _ => context.t.assistant_tool_status_pending,
    };
    final Widget statusIcon = switch (status) {
      AssistantToolStatus.inProgress => const SizedBox.square(
        dimension: 16,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
      AssistantToolStatus.completed => Icon(Icons.check_circle_outline, size: 18, color: colorScheme.primary),
      AssistantToolStatus.failed => Icon(Icons.error_outline, size: 18, color: colorScheme.error),
      _ => Icon(Icons.schedule, size: 18, color: colorScheme.onSurfaceVariant),
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLow,
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        border: Border.all(
          color: status == AssistantToolStatus.failed
              ? colorScheme.error.withValues(alpha: 0.4)
              : colorScheme.outlineVariant,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 8,
          children: [
            Row(
              children: [
                Tooltip(
                  message: statusLabel,
                  child: Semantics(label: statusLabel, child: statusIcon),
                ),
                const SizedBox(width: 8),
                Icon(Icons.build_outlined, size: 14, color: colorScheme.onSurfaceVariant),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
            if (message.assetIds.isNotEmpty) AssistantAssetStrip(assetIds: message.assetIds, size: 48),
            if (message.albumIds.isNotEmpty || message.bookIds.isNotEmpty)
              AssistantLinks(albumIds: message.albumIds, bookIds: message.bookIds),
            if (input != null || (output != null && output.isNotEmpty)) _Details(input: input, output: output),
          ],
        ),
      ),
    );
  }
}

class _Details extends StatelessWidget {
  final String? input;
  final String? output;

  const _Details({required this.input, required this.output});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget section(String label, String text) => ExpansionTile(
      dense: true,
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: 4),
      visualDensity: VisualDensity.compact,
      shape: const Border(),
      collapsedShape: const Border(),
      title: Text(label, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 240),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: const BorderRadius.all(Radius.circular(8)),
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(8),
              child: SelectableText(text, style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace')),
            ),
          ),
        ),
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (input != null) section(context.t.assistant_tool_input, input!),
        if (output != null && output!.isNotEmpty) section(context.t.assistant_tool_output, output!),
      ],
    );
  }
}

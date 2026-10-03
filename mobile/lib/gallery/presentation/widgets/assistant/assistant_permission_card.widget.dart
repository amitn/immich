import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_asset_strip.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_links.widget.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// An answer to a permission request: one of its options, or a plain allow or deny when it has none
typedef AssistantPermissionAnswer = ({AssistantPermissionOption? option, bool approved});

/// A change the assistant asks to make: what it would do, the photos it would touch, and Allow / Allow all in this
/// chat / Deny
class AssistantPermissionCard extends HookWidget {
  final AssistantMessage message;
  final Future<void> Function(AssistantPermissionAnswer answer) onRespond;

  const AssistantPermissionCard({super.key, required this.message, required this.onRespond});

  @override
  Widget build(BuildContext context) {
    final busy = useState(false);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final status = message.status ?? AssistantPermissionStatus.pending;
    final isPending = status == AssistantPermissionStatus.pending;
    final title = message.title ?? message.shortToolName;
    final description = message.summary ?? message.text;

    Future<void> respond(AssistantPermissionAnswer answer) async {
      if (busy.value) {
        return;
      }
      busy.value = true;
      try {
        await onRespond(answer);
      } finally {
        if (context.mounted) {
          busy.value = false;
        }
      }
    }

    String label(AssistantPermissionOption option) => switch (option.choice) {
      AssistantPermissionChoice.allow => context.t.assistant_allow,
      AssistantPermissionChoice.allowAll => context.t.assistant_allow_all_in_chat,
      AssistantPermissionChoice.deny => context.t.assistant_deny,
    };

    Widget optionButton(AssistantPermissionOption option) {
      final onPressed = busy.value ? null : () => respond((option: option, approved: option.choice.approves));
      final key = ValueKey('assistant-permission-${option.choice.name}');
      return switch (option.choice) {
        AssistantPermissionChoice.allow => FilledButton(key: key, onPressed: onPressed, child: Text(label(option))),
        AssistantPermissionChoice.allowAll => OutlinedButton(
          key: key,
          onPressed: onPressed,
          child: Text(label(option)),
        ),
        AssistantPermissionChoice.deny => OutlinedButton(
          key: key,
          onPressed: onPressed,
          style: OutlinedButton.styleFrom(foregroundColor: colorScheme.error),
          child: Text(label(option)),
        ),
      };
    }

    final resolved = switch (status) {
      AssistantPermissionStatus.approved => (Icons.check, context.t.assistant_permission_approved, colorScheme.primary),
      AssistantPermissionStatus.denied => (Icons.block, context.t.assistant_permission_denied, colorScheme.error),
      AssistantPermissionStatus.expired => (Icons.timer_off_outlined, context.t.expired, colorScheme.onSurfaceVariant),
      _ => null,
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: isPending ? colorScheme.tertiaryContainer.withValues(alpha: 0.35) : colorScheme.surfaceContainerLow,
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        border: Border.all(
          color: isPending ? colorScheme.tertiary.withValues(alpha: 0.6) : colorScheme.outlineVariant,
          width: isPending ? 1.5 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 10,
          children: [
            Row(
              children: [
                Icon(Icons.shield_outlined, size: 20, color: colorScheme.tertiary),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    context.t.assistant_permission_request,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                if (title != null) ...[
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      '· $title',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
                    ),
                  ),
                ],
              ],
            ),
            if (description != null && description.isNotEmpty) Text(description, style: theme.textTheme.bodyMedium),
            if (message.assetIds.isNotEmpty) AssistantAssetStrip(assetIds: message.assetIds, size: 48),
            if (message.albumIds.isNotEmpty || message.bookIds.isNotEmpty)
              AssistantLinks(albumIds: message.albumIds, bookIds: message.bookIds),
            if (isPending)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: message.options.isNotEmpty
                    ? [for (final option in message.options) optionButton(option)]
                    : [
                        FilledButton.icon(
                          key: const ValueKey('assistant-permission-approve'),
                          onPressed: busy.value ? null : () => respond((option: null, approved: true)),
                          icon: const Icon(Icons.check, size: 18),
                          label: Text(context.t.assistant_approve),
                        ),
                        OutlinedButton.icon(
                          key: const ValueKey('assistant-permission-deny'),
                          onPressed: busy.value ? null : () => respond((option: null, approved: false)),
                          style: OutlinedButton.styleFrom(foregroundColor: colorScheme.error),
                          icon: const Icon(Icons.block, size: 18),
                          label: Text(context.t.assistant_deny),
                        ),
                      ],
              )
            else if (resolved != null)
              Align(
                alignment: Alignment.centerLeft,
                child: Chip(
                  key: const ValueKey('assistant-permission-resolved'),
                  visualDensity: VisualDensity.compact,
                  avatar: Icon(resolved.$1, size: 16, color: resolved.$3),
                  label: Text(resolved.$2),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

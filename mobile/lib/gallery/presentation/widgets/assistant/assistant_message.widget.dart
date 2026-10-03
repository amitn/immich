import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_asset_strip.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_links.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_markdown.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_permission_card.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_tool_call_card.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/utils/assistant_links.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:openapi/api.dart';
import 'package:url_launcher/url_launcher.dart';

/// Follows a link of the assistant's reply: in the app for a photo, album or book of the server, else in the browser
Future<void> openAssistantLink(BuildContext context, WidgetRef ref, String href) async {
  final hosts = <String>{};
  final endpoint = Store.tryGet(StoreKey.serverEndpoint);
  final externalDomain = ref.read(serverInfoProvider).serverConfig.externalDomain;
  for (final url in [endpoint, externalDomain]) {
    final host = url == null || url.isEmpty ? null : Uri.tryParse(url)?.host;
    if (host != null && host.isNotEmpty) {
      hosts.add(host);
    }
  }

  final navigator = ref.read(galleryNavigatorProvider);
  final unavailable = context.t.not_on_device_yet;
  switch (assistantLinkTarget(href, serverHosts: hosts)) {
    case AssistantPhotoLink(:final assetId):
      if (!await navigator.openAssets([assetId])) {
        await ref.read(toastServiceProvider).error(unavailable);
      }
    case AssistantAlbumLink(:final albumId):
      if (!await navigator.openAlbum(albumId)) {
        await ref.read(toastServiceProvider).error(unavailable);
      }
    case AssistantBookLink(:final bookId):
      await navigator.openBook(bookId);
    case AssistantExternalLink(:final uri):
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    case null:
      break;
  }
}

/// One message of an assistant chat
class AssistantMessageView extends ConsumerWidget {
  final AssistantMessage message;

  /// The photos of the chat (lower case ids), whose ids the replies may print
  final Set<String> chatAssetIds;
  final Future<void> Function(AssistantMessage message, AssistantPermissionAnswer answer) onPermission;

  const AssistantMessageView({
    super.key,
    required this.message,
    required this.onPermission,
    this.chatAssetIds = const {},
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    Widget markdown(String? text, {TextStyle? style}) => AssistantMarkdown(
      text: text,
      assetIds: chatAssetIds,
      style: style,
      onAsset: (id) => unawaited(openGalleryAssets(context, ref, [id], 0)),
      onLink: (href) => unawaited(openAssistantLink(context, ref, href)),
    );

    if (message.role == AgentMessageRole.user) {
      return Opacity(
        opacity: message.pending ? 0.6 : 1,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          spacing: 6,
          children: [
            if (message.assetIds.isNotEmpty)
              Align(
                alignment: Alignment.centerRight,
                child: AssistantAssetStrip(assetIds: message.assetIds, size: 48),
              ),
            if (message.text?.isNotEmpty ?? false)
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.85),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: colorScheme.primary,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(18),
                      topRight: Radius.circular(18),
                      bottomLeft: Radius.circular(18),
                      bottomRight: Radius.circular(4),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    child: Text(
                      message.text!,
                      style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.onPrimary),
                    ),
                  ),
                ),
              ),
            if (message.pending) Text(context.t.assistant_sending, style: theme.textTheme.labelSmall),
          ],
        ),
      );
    }

    switch (message.kind) {
      case AgentMessageKind.text:
        return GestureDetector(
          onLongPress: message.text == null
              ? null
              : () async {
                  final copied = context.t.copied_to_clipboard;
                  await Clipboard.setData(ClipboardData(text: message.text!));
                  await ref.read(toastServiceProvider).success(copied);
                },
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: 8,
            children: [
              markdown(message.text),
              if (message.assetIds.isNotEmpty) AssistantAssetStrip(assetIds: message.assetIds),
              if (message.albumIds.isNotEmpty || message.bookIds.isNotEmpty)
                AssistantLinks(albumIds: message.albumIds, bookIds: message.bookIds),
            ],
          ),
        );
      case AgentMessageKind.thought:
        return ExpansionTile(
          dense: true,
          tilePadding: EdgeInsets.zero,
          shape: const Border(),
          collapsedShape: const Border(),
          leading: Icon(Icons.psychology_outlined, size: 18, color: colorScheme.onSurfaceVariant),
          title: Text(
            context.t.assistant_thinking,
            style: theme.textTheme.labelMedium?.copyWith(color: colorScheme.onSurfaceVariant),
          ),
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 12, bottom: 8),
              child: markdown(
                message.text,
                style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
              ),
            ),
          ],
        );
      case AgentMessageKind.toolCall:
        return AssistantToolCallCard(message: message);
      case AgentMessageKind.permission:
        return AssistantPermissionCard(message: message, onRespond: (answer) => onPermission(message, answer));
      case AgentMessageKind.plan:
        return message.entries.isEmpty ? const SizedBox.shrink() : _Plan(entries: message.entries);
      case AgentMessageKind.error:
        return DecoratedBox(
          decoration: BoxDecoration(
            color: colorScheme.errorContainer.withValues(alpha: 0.5),
            borderRadius: const BorderRadius.all(Radius.circular(12)),
            border: Border.all(color: colorScheme.error.withValues(alpha: 0.4)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.error_outline, size: 18, color: colorScheme.error),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    message.text?.isNotEmpty ?? false ? message.text! : context.t.errors.something_went_wrong,
                    style: theme.textTheme.bodyMedium?.copyWith(color: colorScheme.onErrorContainer),
                  ),
                ),
              ],
            ),
          ),
        );
    }
  }
}

class _Plan extends StatelessWidget {
  final List<AssistantPlanEntry> entries;

  const _Plan({required this.entries});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final completed = entries.where((entry) => entry.isCompleted).length;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLow,
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 6,
          children: [
            Row(
              children: [
                Icon(Icons.checklist, size: 18, color: colorScheme.primary),
                const SizedBox(width: 8),
                Text(context.t.assistant_plan, style: theme.textTheme.titleSmall),
                const Spacer(),
                Text(
                  context.t.assistant_plan_progress(completed: completed, total: entries.length),
                  style: theme.textTheme.labelSmall?.copyWith(color: colorScheme.onSurfaceVariant),
                ),
              ],
            ),
            for (final entry in entries)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: entry.isCompleted
                        ? Icon(Icons.check_circle, size: 16, color: colorScheme.primary)
                        : entry.isInProgress
                        ? const SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2))
                        : Icon(Icons.radio_button_unchecked, size: 16, color: colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      entry.content,
                      style: theme.textTheme.bodySmall?.copyWith(
                        decoration: entry.isCompleted ? TextDecoration.lineThrough : null,
                        color: entry.isCompleted ? colorScheme.onSurfaceVariant : null,
                        fontWeight: entry.priority == 'high' && !entry.isCompleted ? FontWeight.w600 : null,
                      ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

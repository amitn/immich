import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/presentation/widgets/assistant/assistant_asset_strip.widget.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// The message box of the assistant: the attached photos, the text, and Send or Stop
class AssistantComposer extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode? focusNode;
  final List<String> attachedAssetIds;
  final bool isRunning;
  final bool isSending;
  final bool autoApprove;
  final VoidCallback onSend;
  final VoidCallback onStop;
  final void Function(String assetId) onRemoveAsset;

  const AssistantComposer({
    super.key,
    required this.controller,
    required this.attachedAssetIds,
    required this.isRunning,
    required this.isSending,
    required this.autoApprove,
    required this.onSend,
    required this.onStop,
    required this.onRemoveAsset,
    this.focusNode,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Material(
      color: colorScheme.surfaceContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: 8,
            children: [
              if (attachedAssetIds.isNotEmpty)
                Semantics(
                  label: context.t.assistant_attached_photos,
                  child: AssistantAssetStrip(assetIds: attachedAssetIds, size: 52, onRemove: onRemoveAsset),
                ),
              if (autoApprove)
                Row(
                  children: [
                    Icon(Icons.bolt, size: 16, color: colorScheme.tertiary),
                    const SizedBox(width: 4),
                    Text(
                      context.t.assistant_auto_approve,
                      key: const Key('assistant-auto-approve-on'),
                      style: theme.textTheme.labelSmall?.copyWith(color: colorScheme.tertiary),
                    ),
                  ],
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('assistant-input'),
                      controller: controller,
                      focusNode: focusNode,
                      minLines: 1,
                      maxLines: 6,
                      textCapitalization: TextCapitalization.sentences,
                      textInputAction: TextInputAction.newline,
                      decoration: InputDecoration(
                        hintText: context.t.assistant_input_placeholder,
                        filled: true,
                        fillColor: colorScheme.surface,
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        border: const OutlineInputBorder(
                          borderRadius: BorderRadius.all(Radius.circular(20)),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  if (isRunning)
                    IconButton.filledTonal(
                      key: const Key('assistant-stop'),
                      tooltip: context.t.assistant_stop,
                      onPressed: onStop,
                      icon: const Icon(Icons.stop_rounded),
                    )
                  else
                    ValueListenableBuilder(
                      valueListenable: controller,
                      builder: (context, value, _) => IconButton.filled(
                        key: const Key('assistant-send'),
                        tooltip: context.t.assistant_message_input,
                        onPressed: isSending || value.text.trim().isEmpty ? null : onSend,
                        icon: isSending
                            ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.arrow_upward_rounded),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

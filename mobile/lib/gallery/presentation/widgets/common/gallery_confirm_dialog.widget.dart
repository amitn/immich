import 'package:flutter/material.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// Asks to confirm a destructive action; true when confirmed
Future<bool> showGalleryConfirmDialog(
  BuildContext context, {
  required String title,
  required String content,
  required String confirmText,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(content),
      actions: [
        TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(dialogContext.t.cancel)),
        TextButton(
          key: const Key('gallery-confirm'),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          style: TextButton.styleFrom(foregroundColor: Theme.of(dialogContext).colorScheme.error),
          child: Text(confirmText),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

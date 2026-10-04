import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// Asks for a short text, e.g. a caption; the text (possibly empty, to clear it) when saved, null when cancelled
Future<String?> showGalleryTextDialog(
  BuildContext context, {
  required String title,
  String initialValue = '',
  int maxLength = 200,
  bool multiline = false,
}) => showDialog<String>(
  context: context,
  builder: (_) => _TextDialog(title: title, initialValue: initialValue, maxLength: maxLength, multiline: multiline),
);

class _TextDialog extends HookWidget {
  final String title;
  final String initialValue;
  final int maxLength;
  final bool multiline;

  const _TextDialog({
    required this.title,
    required this.initialValue,
    required this.maxLength,
    required this.multiline,
  });

  @override
  Widget build(BuildContext context) {
    final controller = useTextEditingController(text: initialValue);
    void save() => Navigator.of(context).pop(controller.text.trim());

    return AlertDialog(
      title: Text(title),
      content: TextField(
        key: const Key('gallery-text-field'),
        controller: controller,
        autofocus: true,
        maxLength: maxLength,
        minLines: 1,
        maxLines: multiline ? 5 : 1,
        textCapitalization: TextCapitalization.sentences,
        textInputAction: multiline ? TextInputAction.newline : TextInputAction.done,
        onSubmitted: multiline ? null : (_) => save(),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(context.t.cancel)),
        TextButton(key: const Key('gallery-text-save'), onPressed: save, child: Text(context.t.save)),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/providers/book_export.provider.dart';
import 'package:immich_mobile/gallery/utils/book_export.dart';
import 'package:immich_mobile/gallery/utils/gallery_i18n.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// A colour of a book style, e.g. "#f6f1e7" or "#abc"; null when it is not a hex colour
Color? parseBookColor(String? hex) {
  if (hex == null) {
    return null;
  }
  var digits = hex.trim().replaceFirst('#', '');
  if (digits.length == 3 || digits.length == 4) {
    digits = digits.split('').map((digit) => '$digit$digit').join();
  }
  final value = int.tryParse(digits, radix: 16);
  return switch (digits.length) {
    6 when value != null => Color(0xFF000000 | value),
    // #rrggbbaa
    8 when value != null => Color(((value & 0xFF) << 24) | (value >> 8)),
    _ => null,
  };
}

/// The style presets and the user's own styles, as swatches of a page in the style: its paper, its ink and its
/// margins
class BookStylePicker extends StatelessWidget {
  final BookStyleChoice value;
  final BookStyleOptions options;
  final ValueChanged<BookStyleChoice> onChanged;

  const BookStylePicker({super.key, required this.value, required this.options, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final value = this.value;
    final description = switch (value) {
      PresetBookStyle(:final preset) => galleryTr(context, bookStylePresetLabelKeys(preset).description),
      UserBookStyle(:final style) => style.description,
    };

    Widget grid(List<Widget> children) => GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 0.8,
      children: children,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 8,
      children: [
        grid([
          for (final preset in bookStylePresetOrder)
            _StyleTile(
              key: Key('book-style-$preset'),
              label: galleryTr(context, bookStylePresetLabelKeys(preset).name, fallback: preset.toString()),
              style: options.presetStyles[preset],
              selected: value == PresetBookStyle(preset),
              onTap: () => onChanged(PresetBookStyle(preset)),
            ),
        ]),
        if (options.userStyles.isNotEmpty) ...[
          Text(context.t.book_style_yours, style: theme.textTheme.labelLarge),
          grid([
            for (final style in options.userStyles)
              _StyleTile(
                key: Key('book-style-${style.id}'),
                label: style.name,
                style: style.style,
                selected: value == UserBookStyle(style),
                onTap: () => onChanged(UserBookStyle(style)),
              ),
          ]),
        ],
        Text(description, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ],
    );
  }
}

class _StyleTile extends StatelessWidget {
  final String label;
  final BookStyle? style;
  final bool selected;
  final VoidCallback onTap;

  const _StyleTile({super.key, required this.label, required this.style, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final style = this.style;
    final paper = parseBookColor(style?.background) ?? colorScheme.surfaceContainerHighest;
    final ink = parseBookColor(style?.textColor) ?? colorScheme.onSurfaceVariant;
    final accent = parseBookColor(style?.accentColor.orElse(null)) ?? ink;
    // the margins to scale of a 210 mm page on a 64 px swatch
    final margin = ((style?.marginMm ?? 12) / 210 * 64).clamp(2.0, 14.0);

    return Semantics(
      selected: selected,
      button: true,
      label: label,
      child: InkWell(
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        onTap: onTap,
        child: Ink(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            borderRadius: const BorderRadius.all(Radius.circular(12)),
            border: Border.all(
              color: selected ? colorScheme.primary : colorScheme.outlineVariant,
              width: selected ? 2 : 1,
            ),
            color: selected ? colorScheme.primary.withAlpha(16) : null,
          ),
          child: Column(
            spacing: 6,
            children: [
              Expanded(
                child: AspectRatio(
                  aspectRatio: 1,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: paper,
                      border: Border.all(color: colorScheme.outlineVariant),
                      borderRadius: const BorderRadius.all(Radius.circular(3)),
                    ),
                    child: Padding(
                      padding: EdgeInsets.all(margin),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        spacing: 3,
                        children: [
                          Expanded(child: ColoredBox(color: ink.withAlpha(60))),
                          Container(height: 3, color: accent),
                          FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: 0.6,
                            child: Container(height: 3, color: ink),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                spacing: 2,
                children: [
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                  ),
                  if (selected) Icon(Icons.check_circle, size: 14, color: colorScheme.primary),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

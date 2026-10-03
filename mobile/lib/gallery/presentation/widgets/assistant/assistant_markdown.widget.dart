import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_asset_thumbnail.widget.dart';
import 'package:immich_mobile/gallery/utils/markdown.dart';

/// The assistant's markdown, rendered with the app's text theme. Ids of the chat's photos show as small thumbnails
/// that open the photo.
class AssistantMarkdown extends StatefulWidget {
  final String? text;

  /// The photos of the chat (lower case ids): only their ids become thumbnails
  final Set<String> assetIds;
  final TextStyle? style;
  final void Function(String assetId)? onAsset;
  final void Function(String href)? onLink;

  const AssistantMarkdown({
    super.key,
    required this.text,
    this.assetIds = const {},
    this.style,
    this.onAsset,
    this.onLink,
  });

  @override
  State<AssistantMarkdown> createState() => _AssistantMarkdownState();
}

class _AssistantMarkdownState extends State<AssistantMarkdown> {
  final _recognizers = <TapGestureRecognizer>[];

  void _disposeRecognizers() {
    for (final recognizer in _recognizers) {
      recognizer.dispose();
    }
    _recognizers.clear();
  }

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _disposeRecognizers();
    final base = widget.style ?? Theme.of(context).textTheme.bodyMedium ?? const TextStyle();
    final blocks = parseMarkdown(widget.text, assetIds: widget.assetIds);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: _blocks(context, blocks, base));
  }

  List<Widget> _blocks(BuildContext context, List<MdBlock> blocks, TextStyle base) {
    final widgets = <Widget>[];
    for (final (index, block) in blocks.indexed) {
      if (index > 0) {
        widgets.add(SizedBox(height: (base.fontSize ?? 14) * 0.6));
      }
      widgets.add(_block(context, block, base));
    }
    return widgets;
  }

  Widget _block(BuildContext context, MdBlock block, TextStyle base) {
    final colorScheme = Theme.of(context).colorScheme;
    switch (block) {
      case MdParagraph(:final spans):
        return _rich(context, spans, base);
      case MdHeading(:final level, :final spans):
        final scale = switch (level) {
          1 => 1.35,
          2 => 1.2,
          _ => 1.05,
        };
        return _rich(
          context,
          spans,
          base.copyWith(fontWeight: FontWeight.w600, fontSize: (base.fontSize ?? 14) * scale, height: 1.3),
        );
      case MdCodeBlock(:final code):
        return DecoratedBox(
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainerHighest,
            borderRadius: const BorderRadius.all(Radius.circular(8)),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(10),
            child: Text(
              code,
              style: base.copyWith(fontFamily: 'monospace', fontSize: (base.fontSize ?? 14) * 0.9),
            ),
          ),
        );
      case MdQuote(:final blocks):
        return DecoratedBox(
          decoration: BoxDecoration(
            border: Border(left: BorderSide(color: colorScheme.outlineVariant, width: 3)),
          ),
          child: Padding(
            padding: const EdgeInsets.only(left: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: _blocks(context, blocks, base.copyWith(color: colorScheme.onSurfaceVariant)),
            ),
          ),
        );
      case MdList(:final ordered, :final start, :final items):
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (index, item) in items.indexed)
              Padding(
                padding: EdgeInsets.only(top: index == 0 ? 0 : 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: ordered ? 26 : 18,
                      child: Text(ordered ? '${start + index}.' : '•', style: base),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: _blocks(context, item, base),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        );
      case MdTable(:final header, :final rows):
        final border = BorderSide(color: colorScheme.outlineVariant);
        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Table(
            defaultColumnWidth: const IntrinsicColumnWidth(),
            border: TableBorder(horizontalInside: border, bottom: border, top: border),
            children: [
              TableRow(
                children: [
                  for (final cell in header)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                      child: _rich(context, cell, base.copyWith(fontWeight: FontWeight.w600)),
                    ),
                ],
              ),
              for (final row in rows)
                TableRow(
                  children: [
                    for (final cell in row)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                        child: _rich(context, cell, base),
                      ),
                  ],
                ),
            ],
          ),
        );
      case MdRule():
        return const Divider(height: 1);
    }
  }

  Widget _rich(BuildContext context, List<MdSpan> spans, TextStyle base) {
    final colorScheme = Theme.of(context).colorScheme;
    return Text.rich(
      TextSpan(
        style: base,
        children: [
          for (final span in spans)
            if (span.assetId != null)
              WidgetSpan(
                alignment: PlaceholderAlignment.middle,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: GalleryAssetThumbnail(
                    key: ValueKey('markdown-asset-${span.assetId}'),
                    assetId: span.assetId!,
                    size: 32,
                    borderRadius: const BorderRadius.all(Radius.circular(6)),
                    onTap: widget.onAsset == null ? null : () => widget.onAsset!(span.assetId!),
                  ),
                ),
              )
            else
              TextSpan(
                text: span.text,
                style: TextStyle(
                  fontWeight: span.bold ? FontWeight.w600 : null,
                  fontStyle: span.italic ? FontStyle.italic : null,
                  decoration: span.href != null
                      ? TextDecoration.underline
                      : span.strike
                      ? TextDecoration.lineThrough
                      : null,
                  color: span.href != null ? colorScheme.primary : null,
                  fontFamily: span.code ? 'monospace' : null,
                  backgroundColor: span.code ? colorScheme.surfaceContainerHighest : null,
                ),
                recognizer: span.href == null || widget.onLink == null ? null : _recognizer(span.href!),
              ),
        ],
      ),
    );
  }

  TapGestureRecognizer _recognizer(String href) {
    final recognizer = TapGestureRecognizer()..onTap = () => widget.onLink?.call(href);
    _recognizers.add(recognizer);
    return recognizer;
  }
}

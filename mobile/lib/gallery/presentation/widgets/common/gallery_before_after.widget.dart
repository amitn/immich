import 'package:flutter/material.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// A photo before and after a change (an artwork, an enhanced copy), one over the other: drag across it to move the
/// line between them
class GalleryBeforeAfter extends StatefulWidget {
  final ImageProvider before;
  final ImageProvider after;

  /// The share of the width that shows the photo before, at first
  final double initialSplit;

  /// The photo after could not be loaded, e.g. its preview is still being made
  final VoidCallback? onAfterError;

  const GalleryBeforeAfter({
    super.key,
    required this.before,
    required this.after,
    this.initialSplit = 0.5,
    this.onAfterError,
  });

  @override
  State<GalleryBeforeAfter> createState() => _GalleryBeforeAfterState();
}

class _GalleryBeforeAfterState extends State<GalleryBeforeAfter> {
  late double _split = widget.initialSplit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget image(ImageProvider provider, {VoidCallback? onError}) => Image(
      image: provider,
      fit: BoxFit.contain,
      gaplessPlayback: true,
      errorBuilder: (_, _, _) {
        if (onError != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) => onError());
        }
        return const Center(child: Icon(Icons.broken_image_outlined, color: Colors.white54));
      },
    );
    Widget tag(String text) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: const BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.all(Radius.circular(10))),
      child: Text(text, style: theme.textTheme.labelSmall?.copyWith(color: Colors.white)),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        void move(Offset position) => setState(() => _split = (position.dx / width).clamp(0.0, 1.0));

        String percent(double split) => '${(split.clamp(0.0, 1.0) * 100).round()}%';
        return Semantics(
          slider: true,
          value: percent(_split),
          increasedValue: percent(_split + 0.1),
          decreasedValue: percent(_split - 0.1),
          label: '${context.t.compare_before} / ${context.t.compare_after}',
          onIncrease: () => setState(() => _split = (_split + 0.1).clamp(0.0, 1.0)),
          onDecrease: () => setState(() => _split = (_split - 0.1).clamp(0.0, 1.0)),
          child: GestureDetector(
            key: const Key('gallery-before-after'),
            behavior: HitTestBehavior.opaque,
            onHorizontalDragUpdate: (details) => move(details.localPosition),
            onTapDown: (details) => move(details.localPosition),
            child: ColoredBox(
              color: Colors.black,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  image(widget.after, onError: widget.onAfterError),
                  ClipRect(clipper: _LeftClipper(_split), child: image(widget.before)),
                  Positioned(
                    left: (width * _split - 1).clamp(0.0, width - 2),
                    top: 0,
                    bottom: 0,
                    child: const IgnorePointer(
                      child: SizedBox(width: 2, child: ColoredBox(color: Colors.white)),
                    ),
                  ),
                  Positioned(
                    left: (width * _split - 18).clamp(0.0, width - 36),
                    top: 0,
                    bottom: 0,
                    child: const IgnorePointer(
                      child: Center(
                        child: CircleAvatar(
                          radius: 18,
                          backgroundColor: Colors.white,
                          child: Icon(Icons.compare_arrows, color: Colors.black87, size: 20),
                        ),
                      ),
                    ),
                  ),
                  Positioned(left: 8, top: 8, child: tag(context.t.compare_before)),
                  Positioned(right: 8, top: 8, child: tag(context.t.compare_after)),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _LeftClipper extends CustomClipper<Rect> {
  final double split;

  const _LeftClipper(this.split);

  @override
  Rect getClip(Size size) => Rect.fromLTWH(0, 0, size.width * split, size.height);

  @override
  bool shouldReclip(_LeftClipper oldClipper) => oldClipper.split != split;
}

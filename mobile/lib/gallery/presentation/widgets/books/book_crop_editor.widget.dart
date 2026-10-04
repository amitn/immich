import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:immich_mobile/gallery/utils/book_crop.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// Opens the crop of a placed photo full screen; the new crop when saved, null when cancelled
Future<NormalizedRect?> showBookCropEditor(
  BuildContext context, {
  required ImageProvider image,
  required double slotRatio,
  NormalizedRect? crop,
}) => Navigator.of(context).push<NormalizedRect>(
  MaterialPageRoute(
    fullscreenDialog: true,
    builder: (_) => BookCropEditor(image: image, slotRatio: slotRatio, crop: crop),
  ),
);

/// The crop of a photo in a slot: the frame has the slot's shape, the photo is dragged and pinched (or zoomed with
/// the slider) under it
class BookCropEditor extends HookWidget {
  final ImageProvider image;
  final double slotRatio;
  final NormalizedRect? crop;

  const BookCropEditor({super.key, required this.image, required this.slotRatio, this.crop});

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final state = useState<BookCrop?>(null);
    final baseZoom = useRef(1.0);

    final configuration = createLocalImageConfiguration(context);

    // the shape of the photo, from the image itself
    useEffect(() {
      final stream = image.resolve(configuration);
      final listener = ImageStreamListener((info, _) {
        final ratio = info.image.height == 0 ? 1.0 : info.image.width / info.image.height;
        state.value ??= BookCrop(imageRatio: ratio, slotRatio: slotRatio, crop: crop);
      }, onError: (_, _) => state.value ??= BookCrop(imageRatio: 1, slotRatio: slotRatio, crop: crop));
      stream.addListener(listener);
      return () => stream.removeListener(listener);
    }, [image]);

    final current = state.value;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(t.book_crop_photo),
        actions: [
          TextButton(
            key: const Key('book-crop-save'),
            onPressed: current == null ? null : () => Navigator.of(context).pop(state.value!.rect),
            child: Text(t.save),
          ),
        ],
      ),
      body: current == null
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: Column(
                children: [
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Center(
                        child: AspectRatio(
                          aspectRatio: slotRatio > 0 ? slotRatio : 1,
                          child: LayoutBuilder(
                            builder: (context, constraints) {
                              final frame = constraints.biggest;
                              final rect = current.rect;
                              final width = frame.width / rect.width;
                              final height = frame.height / rect.height;
                              return GestureDetector(
                                key: const Key('book-crop-frame'),
                                onScaleStart: (_) => baseZoom.value = state.value!.zoom,
                                onScaleUpdate: (details) {
                                  final crop = state.value!;
                                  state.value = crop
                                      .withZoom(details.pointerCount > 1 ? baseZoom.value * details.scale : crop.zoom)
                                      .panBy(
                                        details.focalPointDelta.dx / frame.width,
                                        details.focalPointDelta.dy / frame.height,
                                      );
                                },
                                child: DecoratedBox(
                                  position: DecorationPosition.foreground,
                                  decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 2)),
                                  child: ClipRect(
                                    child: Stack(
                                      children: [
                                        Positioned(
                                          left: -rect.x * width,
                                          top: -rect.y * height,
                                          width: width,
                                          height: height,
                                          child: Image(
                                            image: image,
                                            fit: BoxFit.fill,
                                            gaplessPlayback: true,
                                            semanticLabel: t.book_crop_preview,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
                    child: Row(
                      children: [
                        IconButton(
                          color: Colors.white,
                          tooltip: t.book_crop_zoom_out,
                          onPressed: () => state.value = state.value!.withZoom(state.value!.zoom / 1.25),
                          icon: const Icon(Icons.zoom_out),
                        ),
                        Expanded(
                          child: Slider(
                            key: const Key('book-crop-zoom'),
                            value: current.zoom,
                            min: 1,
                            max: BookCrop.maxZoom,
                            label: t.book_crop_zoom,
                            onChanged: (value) => state.value = state.value!.withZoom(value),
                          ),
                        ),
                        IconButton(
                          color: Colors.white,
                          tooltip: t.book_crop_zoom_in,
                          onPressed: () => state.value = state.value!.withZoom(state.value!.zoom * 1.25),
                          icon: const Icon(Icons.zoom_in),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

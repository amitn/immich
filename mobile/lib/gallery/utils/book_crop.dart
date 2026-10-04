import 'dart:math' as math;

import 'package:openapi/api.dart';

/// The crop of a photo in a slot of a book page, as the phone edits it: the frame keeps the slot's shape, and the
/// photo is moved and zoomed under it. The crop is the part of the photo in the frame, normalized to the photo
/// (`NormalizedRect`, 0..1 of its width and height), like the server and the web store it.
class BookCrop {
  static const maxZoom = 6.0;

  /// Width / height of the photo and of the slot
  final double imageRatio;
  final double slotRatio;

  /// 1 shows the most of the photo the slot's shape allows
  final double zoom;

  /// The middle of the crop, in 0..1 of the photo
  final double centerX;
  final double centerY;

  const BookCrop._(this.imageRatio, this.slotRatio, this.zoom, this.centerX, this.centerY);

  /// The crop the slot shows: [crop] when the photo has one, else the whole height or width of the photo, centered
  factory BookCrop({required double imageRatio, required double slotRatio, NormalizedRect? crop}) {
    final image = imageRatio > 0 ? imageRatio : 1.0;
    final slot = slotRatio > 0 ? slotRatio : 1.0;
    final full = _full(image, slot);
    if (crop == null) {
      return BookCrop._(image, slot, 1, 0.5, 0.5);
    }
    final zoom = math.max(full.width / crop.width, full.height / crop.height);
    return BookCrop._(
      image,
      slot,
      1,
      crop.x + crop.width / 2,
      crop.y + crop.height / 2,
    ).withZoom(zoom.isFinite ? zoom : 1);
  }

  /// The largest part of the photo with the slot's shape, in 0..1 of the photo
  static ({double width, double height}) _full(double imageRatio, double slotRatio) => imageRatio > slotRatio
      // a photo wider than the slot: its whole height, part of its width
      ? (width: slotRatio / imageRatio, height: 1)
      : (width: 1, height: imageRatio / slotRatio);

  double get width => _full(imageRatio, slotRatio).width / zoom;

  double get height => _full(imageRatio, slotRatio).height / zoom;

  /// The crop, kept inside the photo
  NormalizedRect get rect {
    final w = width;
    final h = height;
    double clampEdge(double start, double size) => start.clamp(0.0, math.max(0.0, 1 - size));
    return NormalizedRect(
      x: _round(clampEdge(centerX - w / 2, w)),
      y: _round(clampEdge(centerY - h / 2, h)),
      width: _round(w),
      height: _round(h),
    );
  }

  static double _round(double value) => (value * 10000).roundToDouble() / 10000;

  BookCrop _at(double zoom, double centerX, double centerY) {
    final z = zoom.clamp(1.0, maxZoom);
    final full = _full(imageRatio, slotRatio);
    final halfW = full.width / z / 2;
    final halfH = full.height / z / 2;
    return BookCrop._(
      imageRatio,
      slotRatio,
      z,
      centerX.clamp(halfW, math.max(halfW, 1 - halfW)),
      centerY.clamp(halfH, math.max(halfH, 1 - halfH)),
    );
  }

  BookCrop withZoom(double zoom) => _at(zoom, centerX, centerY);

  /// Moves the photo under the frame by [dx], [dy] in fractions of the frame (dragging right shows more of the left)
  BookCrop panBy(double dx, double dy) => _at(zoom, centerX - dx * width, centerY - dy * height);
}

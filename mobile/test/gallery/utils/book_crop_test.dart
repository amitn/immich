import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/utils/book_crop.dart';
import 'package:openapi/api.dart';

void main() {
  Map<String, double> rect(BookCrop crop) {
    final r = crop.rect;
    return {'x': r.x, 'y': r.y, 'width': r.width, 'height': r.height};
  }

  group('BookCrop', () {
    test('without a crop, shows the whole height of a photo wider than the slot, centered', () {
      // a 3:2 photo in a square slot: two thirds of its width
      final crop = BookCrop(imageRatio: 1.5, slotRatio: 1);
      expect(rect(crop), {'x': 0.1667, 'y': 0.0, 'width': 0.6667, 'height': 1.0});
    });

    test('without a crop, shows the whole width of a photo taller than the slot', () {
      // a 2:3 photo in a 3:2 slot
      final crop = BookCrop(imageRatio: 2 / 3, slotRatio: 1.5);
      expect(rect(crop), {'x': 0.0, 'y': 0.2778, 'width': 1.0, 'height': 0.4444});
    });

    test('starts from the crop the photo has', () {
      final crop = BookCrop(
        imageRatio: 1.5,
        slotRatio: 1,
        crop: NormalizedRect(x: 0.5, y: 0.25, width: 1 / 3, height: 0.5),
      );
      expect(crop.zoom, closeTo(2, 0.001));
      expect(rect(crop), {'x': 0.5, 'y': 0.25, 'width': 0.3333, 'height': 0.5});
    });

    test('zooms around the middle, between 1 and the most zoom', () {
      final crop = BookCrop(imageRatio: 1, slotRatio: 1).withZoom(2);
      expect(rect(crop), {'x': 0.25, 'y': 0.25, 'width': 0.5, 'height': 0.5});
      expect(crop.withZoom(0.2).zoom, 1);
      expect(crop.withZoom(100).zoom, BookCrop.maxZoom);
    });

    test('dragging the photo right shows more of its left, and never leaves the photo', () {
      final crop = BookCrop(imageRatio: 1, slotRatio: 1).withZoom(2);
      // half a frame to the right: a quarter of the photo
      expect(rect(crop.panBy(0.5, 0)), {'x': 0.0, 'y': 0.25, 'width': 0.5, 'height': 0.5});
      expect(rect(crop.panBy(-0.25, 0.25)), {'x': 0.375, 'y': 0.125, 'width': 0.5, 'height': 0.5});
      expect(rect(crop.panBy(-10, -10)), {'x': 0.5, 'y': 0.5, 'width': 0.5, 'height': 0.5});
    });

    test('zooming out keeps the crop inside the photo', () {
      final crop = BookCrop(imageRatio: 1, slotRatio: 1).withZoom(4).panBy(-10, -10).withZoom(1);
      expect(rect(crop), {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0});
    });

    test('a crop keeps the shape of the slot', () {
      final crop = BookCrop(imageRatio: 4 / 3, slotRatio: 0.75).withZoom(1.7).panBy(0.1, -0.3);
      final r = crop.rect;
      expect(r.width * 4 / 3 / r.height, closeTo(0.75, 0.01));
    });
  });
}

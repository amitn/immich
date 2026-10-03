import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_style_picker.widget.dart';
import 'package:immich_mobile/gallery/utils/book_export.dart';
import 'package:openapi/api.dart';

import '../book_fixtures.dart';

void main() {
  group('page count', () {
    test('about three photos a page plus a cover, an even number within the limits', () {
      expect(defaultBookPageCount(0), 2);
      expect(defaultBookPageCount(1), 2);
      expect(defaultBookPageCount(10), 6);
      expect(defaultBookPageCount(12), 6);
      expect(defaultBookPageCount(5000), 200);
    });

    test('an empty or invalid value lets the server decide', () {
      expect(normalizeBookPageCount(''), isNull);
      expect(normalizeBookPageCount('0'), isNull);
      expect(normalizeBookPageCount('abc'), isNull);
      expect(normalizeBookPageCount(' 24 '), 24);
      expect(normalizeBookPageCount('999'), 200);
    });
  });

  test('page sizes in centimetres', () {
    expect(formatBookCm(210), '21');
    expect(formatBookCm(297), '29.7');
    expect(bookPageSizeOf('a4-landscape').widthMm, 297);
    expect(bookPageSizeOf('unknown').id, 'square-21');
  });

  test('the labels of the presets: their own keys, or those of their journal', () {
    expect(bookStylePresetLabelKeys(BookStylePreset.soft).name, 'book_style_preset_soft');
    expect(bookStylePresetLabelKeys(BookStylePreset.food).description, 'book_style_preset_food_description');
    expect(bookStylePresetLabelKeys(BookStylePreset.kidsArt).name, 'journals.kids-art.book_style_name');
    expect(bookStylePresetOfPack('kids-art'), BookStylePreset.kidsArt);
    expect(bookStylePresetOfPack('unknown'), isNull);
  });

  group('the request', () {
    test('with a preset, styled maps in a look and improved photos', () {
      const options = BookExportOptions(
        title: '  ',
        subtitle: ' Summer 2025 ',
        pageSize: 'a4-portrait',
        style: PresetBookStyle(BookStylePreset.food),
        targetPageCount: 24,
        map: BookMapChoice('styled-vintage', BookMapStyleOption.styled, look: BookMapLookOption.vintage),
        illustratedMaps: true,
      );
      expect(options.toDto(albumId: 'album-1', albumName: 'Sicily').toJson(), {
        'albumId': 'album-1',
        'illustratedMaps': true,
        'improvePhotos': true,
        'includeMaps': true,
        'mapLook': BookMapLookOption.vintage,
        'mapStyle': BookMapStyleOption.styled,
        'pageHeightMm': 297,
        'pageWidthMm': 210,
        'stylePreset': BookStylePreset.food,
        'subtitle': 'Summer 2025',
        'targetPageCount': 24,
        'title': 'Sicily',
      });
    });

    test('with a style of the user, copied into the book, and no maps', () {
      final options = BookExportOptions(
        title: 'Our trip',
        style: UserBookStyle(userStyle('style-1')),
        includeMaps: false,
        illustratedMaps: true,
        improvePhotos: false,
      );
      final json = options.toDto(albumId: 'album-1', albumName: 'Sicily').toJson();
      expect(json['stylePreset'], isNull);
      expect(json['mapStyle'], isNull);
      expect(json['mapLook'], isNull);
      expect(json['illustratedMaps'], false);
      expect(json['improvePhotos'], false);
      expect(json['includeMaps'], false);
      final style = json['style'] as BookStyleUpdate;
      expect(style.background.orElse(null), '#f1e4c8');
      expect(style.marginMm.orElse(null), 14);
      expect(style.theme.orElse(null), BookStyleTheme.plain);
    });

    test('a sketch map has no look', () {
      const options = BookExportOptions(title: 'x', map: BookMapChoice('sketch', BookMapStyleOption.sketch));
      final json = options.toDto(albumId: 'a', albumName: 'x').toJson();
      expect(json['mapStyle'], BookMapStyleOption.sketch);
      expect(json.containsKey('mapLook'), isFalse);
    });
  });

  test('the colours of a style', () {
    expect(parseBookColor('#f6f1e7'), const Color(0xFFF6F1E7));
    expect(parseBookColor('#abc'), const Color(0xFFAABBCC));
    expect(parseBookColor('#11223380'), const Color(0x80112233));
    expect(parseBookColor('red'), isNull);
    expect(parseBookColor(null), isNull);
  });
}

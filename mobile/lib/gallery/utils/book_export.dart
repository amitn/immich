import 'dart:convert';
import 'dart:math' as math;

import 'package:openapi/api.dart';

/// A page size of the export dialog, like the web's `BOOK_PAGE_SIZE_PRESETS`
class BookPageSize {
  final String id;
  final int widthMm;
  final int heightMm;

  const BookPageSize(this.id, this.widthMm, this.heightMm);

  bool get isSquare => widthMm == heightMm;

  bool get isPortrait => heightMm > widthMm;
}

const bookPageSizes = [
  BookPageSize('square-21', 210, 210),
  BookPageSize('a4-portrait', 210, 297),
  BookPageSize('a4-landscape', 297, 210),
  BookPageSize('square-30', 300, 300),
];

const defaultBookPageSize = 'square-21';

BookPageSize bookPageSizeOf(String id) =>
    bookPageSizes.firstWhere((size) => size.id == id, orElse: () => bookPageSizes.first);

/// "21", "29.7": a length in millimetres, in centimetres
String formatBookCm(int mm) => mm % 10 == 0 ? '${mm ~/ 10}' : (mm / 10).toStringAsFixed(1);

const bookMinPages = 2;
const bookMaxPages = 200;

/// About three photos per page plus a cover, rounded up to an even number (printed books have facing pages), like the
/// web's `getDefaultBookPageCount`
int defaultBookPageCount(int assetCount) {
  if (assetCount <= 0) {
    return bookMinPages;
  }
  final pages = (assetCount / 3).ceil() + 1;
  final even = pages + pages % 2;
  return math.min(bookMaxPages, math.max(bookMinPages, even));
}

/// null for an empty or invalid value, so the server picks the page count
int? normalizeBookPageCount(String text) {
  final value = int.tryParse(text.trim());
  if (value == null || value <= 0) {
    return null;
  }
  return math.min(bookMaxPages, value);
}

/// The built-in presets first, then the preset of each journal, in the order of the web's picker
const bookStylePresetOrder = [
  BookStylePreset.soft,
  BookStylePreset.classic,
  BookStylePreset.bold,
  BookStylePreset.food,
  BookStylePreset.museum,
  BookStylePreset.wine,
  BookStylePreset.cookbook,
  BookStylePreset.travel,
  BookStylePreset.concerts,
  BookStylePreset.nature,
  BookStylePreset.reading,
  BookStylePreset.kidsArt,
  BookStylePreset.garden,
];

const defaultBookStylePreset = BookStylePreset.soft;

/// The i18n keys of the name and description of a preset: the built-in ones and food have their own, the other
/// journals keep theirs with their labels (`journals.<pack>.book_style_name`)
({String name, String description}) bookStylePresetLabelKeys(BookStylePreset preset) => switch (preset) {
  BookStylePreset.soft ||
  BookStylePreset.classic ||
  BookStylePreset.bold ||
  BookStylePreset.food => (name: 'book_style_preset_$preset', description: 'book_style_preset_${preset}_description'),
  _ => (name: 'journals.$preset.book_style_name', description: 'journals.$preset.book_style_description'),
};

/// The preset of a journal (a collection pack), e.g. food for the food journal
BookStylePreset? bookStylePresetOfPack(String pack) => BookStylePreset.fromJson(pack);

/// A style of the picker: a preset, or one of the user's own styles (designed with the assistant)
sealed class BookStyleChoice {
  const BookStyleChoice();
}

class PresetBookStyle extends BookStyleChoice {
  final BookStylePreset preset;

  const PresetBookStyle(this.preset);

  @override
  bool operator ==(Object other) => other is PresetBookStyle && other.preset == preset;

  @override
  int get hashCode => preset.hashCode;
}

class UserBookStyle extends BookStyleChoice {
  final BookUserStyleResponseDto style;

  const UserBookStyle(this.style);

  @override
  bool operator ==(Object other) => other is UserBookStyle && other.style.id == style.id;

  @override
  int get hashCode => style.id.hashCode;
}

/// A map style of the picker: the styled map in a look, the offline sketch, or a Stadia Maps style
class BookMapChoice {
  final String id;
  final BookMapStyleOption style;
  final BookMapLookOption look;

  /// Drawn from Stadia Maps tiles, which need an API key on the server
  final bool needsStadia;

  const BookMapChoice(this.id, this.style, {this.look = BookMapLookOption.auto, this.needsStadia = false});

  /// The i18n key of its name
  String get labelKey => switch (style) {
    BookMapStyleOption.styled when look == BookMapLookOption.auto => 'book_map_style_styled',
    BookMapStyleOption.styled => 'book_map_look_$look',
    _ => 'book_map_style_$style',
  };
}

/// The styles of the picker, the recommended styled map first, like the web's `BOOK_MAP_PICKER_OPTIONS`
const bookMapChoices = [
  BookMapChoice('styled', BookMapStyleOption.styled),
  BookMapChoice('styled-wash', BookMapStyleOption.styled, look: BookMapLookOption.wash),
  BookMapChoice('styled-engraved', BookMapStyleOption.styled, look: BookMapLookOption.engraved),
  BookMapChoice('styled-minimal', BookMapStyleOption.styled, look: BookMapLookOption.minimal),
  BookMapChoice('styled-vintage', BookMapStyleOption.styled, look: BookMapLookOption.vintage),
  BookMapChoice('sketch', BookMapStyleOption.sketch),
  BookMapChoice('watercolor', BookMapStyleOption.watercolor, needsStadia: true),
  BookMapChoice('toner', BookMapStyleOption.toner, needsStadia: true),
  BookMapChoice('terrain', BookMapStyleOption.terrain, needsStadia: true),
];

/// The options of the export dialog
class BookExportOptions {
  final String title;
  final String subtitle;
  final String pageSize;
  final BookStyleChoice style;
  final int? targetPageCount;
  final bool includeMaps;
  final BookMapChoice map;
  final bool illustratedMaps;
  final bool improvePhotos;

  const BookExportOptions({
    required this.title,
    this.subtitle = '',
    this.pageSize = defaultBookPageSize,
    this.style = const PresetBookStyle(defaultBookStylePreset),
    this.targetPageCount,
    this.includeMaps = true,
    this.map = const BookMapChoice('styled', BookMapStyleOption.styled),
    this.illustratedMaps = false,
    this.improvePhotos = true,
  });

  BookExportOptions copyWith({
    String? pageSize,
    BookStyleChoice? style,
    bool? includeMaps,
    BookMapChoice? map,
    bool? illustratedMaps,
    bool? improvePhotos,
  }) => BookExportOptions(
    title: title,
    subtitle: subtitle,
    pageSize: pageSize ?? this.pageSize,
    style: style ?? this.style,
    targetPageCount: targetPageCount,
    includeMaps: includeMaps ?? this.includeMaps,
    map: map ?? this.map,
    illustratedMaps: illustratedMaps ?? this.illustratedMaps,
    improvePhotos: improvePhotos ?? this.improvePhotos,
  );

  /// The request of `POST /books/from-album`, like the web's export dialog: a style of the user's own is copied into
  /// the book, like a preset
  BookFromAlbumDto toDto({required String albumId, required String albumName}) {
    final size = bookPageSizeOf(pageSize);
    final trimmedSubtitle = subtitle.trim();
    final style = this.style;
    return BookFromAlbumDto(
      albumId: albumId,
      title: Optional.present(title.trim().isEmpty ? albumName : title.trim()),
      subtitle: trimmedSubtitle.isEmpty ? const Optional.absent() : Optional.present(trimmedSubtitle),
      pageWidthMm: Optional.present(size.widthMm),
      pageHeightMm: Optional.present(size.heightMm),
      stylePreset: style is PresetBookStyle ? Optional.present(style.preset) : const Optional.absent(),
      style: style is UserBookStyle
          ? Optional.present(BookStyleUpdate.fromJson(jsonDecode(jsonEncode(style.style.style))))
          : const Optional.absent(),
      targetPageCount: targetPageCount == null ? const Optional.absent() : Optional.present(targetPageCount),
      includeMaps: Optional.present(includeMaps),
      mapStyle: includeMaps ? Optional.present(map.style) : const Optional.absent(),
      mapLook: includeMaps && map.style == BookMapStyleOption.styled
          ? Optional.present(map.look)
          : const Optional.absent(),
      illustratedMaps: Optional.present(includeMaps && illustratedMaps),
      improvePhotos: Optional.present(improvePhotos),
    );
  }
}

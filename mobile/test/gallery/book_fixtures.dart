import 'dart:convert';

import 'package:openapi/api.dart';

Map<String, Object?> bookJson(
  String id, {
  String title = 'Sicily 2009',
  String status = 'active',
  String? exportStatus,
  bool exportStale = false,
  int pageCount = 3,
  String? firstPageId = 'page-1',
  String updatedAt = '2026-09-27T09:58:05.491Z',
}) => {
  'id': id,
  'ownerId': 'user-1',
  'albumId': 'album-1',
  'coverAssetId': null,
  'title': title,
  'subtitle': null,
  'pageWidthMm': 210,
  'pageHeightMm': 210,
  'style': {'marginMm': 16, 'gutterMm': 5, 'background': '#f7f4ee', 'textColor': '#44554d', 'fontFamily': 'serif'},
  'status': status,
  'exportStatus': exportStatus,
  'htmlExportStatus': null,
  'exportedAt': null,
  'htmlExportedAt': null,
  'exportStale': exportStale,
  'htmlExportStale': false,
  'pageCount': pageCount,
  'firstPageId': firstPageId,
  'createdAt': '2026-09-26T10:07:40.640Z',
  'updatedAt': updatedAt,
};

BookResponseDto book(
  String id, {
  String title = 'Sicily 2009',
  String status = 'active',
  String? exportStatus,
  bool exportStale = false,
}) => BookResponseDto.fromJson(
  bookJson(id, title: title, status: status, exportStatus: exportStatus, exportStale: exportStale),
)!;

BookDraftResponseDto draft(String id, String bookId, {String title = 'Crete, October 2016'}) =>
    BookDraftResponseDto.fromJson({
      'id': id,
      'key': 'trip:$bookId',
      'kind': 'trip',
      'memoryId': null,
      'reason': 'Your trip to Crete, with 84 photos',
      'createdAt': '2026-09-27T09:32:30.753Z',
      'book': bookJson(bookId, title: title, status: 'draft'),
    })!;

Map<String, Object?> pageJson(String id, int position) => {
  'id': id,
  'position': position,
  'layout': 'single',
  'background': null,
  'caption': null,
  'sectionTitle': null,
  'map': null,
  'slots': <Object?>[],
  'updatedAt': '2026-09-27T09:58:05.491Z',
};

BookDetailResponseDto bookDetail(
  String id, {
  String title = 'Sicily 2009',
  String status = 'active',
  int pages = 3,
  String? exportStatus,
  bool exportStale = false,
}) => BookDetailResponseDto.fromJson({
  ...bookJson(id, title: title, status: status, pageCount: pages, exportStatus: exportStatus, exportStale: exportStale),
  // given out of order: the viewer orders them by position
  'pages': [for (var i = pages; i >= 1; i--) pageJson('page-$i', i - 1)],
})!;

BookReviewResponseDto review() => BookReviewResponseDto.fromJson({
  'pageCount': 3,
  'counts': {'high': 1, 'medium': 1, 'low': 0},
  'issues': [
    {
      'type': 'low-dpi',
      'severity': 'high',
      'message': 'The photo on page 2 prints at 120 dpi',
      'pages': [2],
      'slot': 1,
      'assetIds': ['asset-1'],
    },
    {
      'type': 'repeated-layout',
      'severity': 'medium',
      'message': 'Pages 1 and 3 use the same layout',
      'pages': [1, 3],
    },
  ],
  'people': [
    {'personId': 'person-1', 'name': 'Anna', 'photos': 40, 'placed': 3},
  ],
  'unusedPhotos': [
    {'assetId': 'asset-9', 'score': 0.9},
  ],
  'weakestPlaced': [
    {'assetId': 'asset-1', 'page': 2, 'slot': 1, 'score': 0.2},
  ],
})!;

BookUserStyleResponseDto userStyle(String id, {String name = 'Sepia'}) => BookUserStyleResponseDto.fromJson({
  'id': id,
  'name': name,
  'description': 'Brown ink on old paper',
  'createdAt': '2026-09-01T10:00:00.000Z',
  'updatedAt': '2026-09-01T10:00:00.000Z',
  'style': {
    'background': '#f1e4c8',
    'textColor': '#5b3a1a',
    'fontFamily': 'serif',
    'marginMm': 14,
    'gutterMm': 4,
    'theme': 'plain',
  },
})!;

Map<String, Object?> slotJson(
  int slot, {
  String? assetId,
  double aspectRatio = 1.5,
  String? caption,
  bool cropped = false,
}) => {
  'slot': slot,
  'aspectRatio': aspectRatio,
  'assetId': assetId,
  'crop': cropped ? {'x': 0.1, 'y': 0.0, 'width': 0.8, 'height': 1.0} : null,
  'caption': caption,
};

/// A page with photo slots, for the editor
BookPageResponseDto editablePage(
  String id,
  int position, {
  String layout = 'two-up',
  List<Map<String, Object?>>? slots,
  String? sectionTitle,
  String? caption,
  String updatedAt = '2026-09-27T09:58:05.491Z',
}) => BookPageResponseDto.fromJson({
  ...pageJson(id, position),
  'layout': layout,
  'sectionTitle': sectionTitle,
  'caption': caption,
  'updatedAt': updatedAt,
  'slots': slots ?? [slotJson(0, assetId: 'asset-1'), slotJson(1)],
})!;

/// A book whose pages can be edited
BookDetailResponseDto editableBook(List<BookPageResponseDto> pages, {String id = 'book-1'}) =>
    BookDetailResponseDto.fromJson(
      jsonDecode(
        jsonEncode({
          ...bookJson(id, pageCount: pages.length),
          'pages': [for (final page in pages) page.toJson()],
        }),
      ),
    )!;

BookLayoutResponseDto layout(String id, String name, int slots, {bool map = false}) => BookLayoutResponseDto.fromJson({
  'id': id,
  'name': name,
  'description': '$name layout',
  'orientation': 'any',
  'fullBleed': false,
  'food': false,
  'slots': [
    for (var i = 0; i < slots; i++) {'x': i / slots, 'y': 0.0, 'width': 1 / slots, 'height': 0.8},
  ],
  'textAreas': [
    {'kind': 'caption', 'x': 0.0, 'y': 0.85, 'width': 1.0, 'height': 0.1},
  ],
  if (map) 'mapArea': {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0},
})!;

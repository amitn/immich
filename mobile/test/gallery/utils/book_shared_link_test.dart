import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/utils/book_shared_link.dart';
import 'package:immich_mobile/models/shared_link/shared_link.model.dart';
import 'package:openapi/api.dart';

/// A shared link as the server sends it; [book] makes it a link to a photo book
Map<String, Object?> linkJson({required String type, Map<String, Object?>? book, Map<String, Object?>? extra}) => {
  'id': 'link-1',
  'key': 'secret-key',
  'userId': 'user-1',
  'type': type,
  'createdAt': '2026-09-01T10:00:00.000Z',
  'allowDownload': true,
  'allowUpload': false,
  'showMetadata': false,
  'assets': <Object?>[],
  'description': null,
  'expiresAt': '2026-12-01T10:00:00.000Z',
  'password': 'pw',
  'slug': null,
  'redactFaces': false,
  'redactText': false,
  'book': ?book,
  ...?extra,
};

void main() {
  group('shared links to photo books', () {
    test('a list with a book link parses, next to the other links', () {
      final json = jsonEncode([
        linkJson(
          type: 'BOOK',
          book: {'id': 'book-1', 'title': 'Museum visits', 'subtitle': null, 'pageCount': 25, 'hasPdf': false},
        ),
        linkJson(type: 'INDIVIDUAL', extra: {'id': 'link-2'}),
      ]);

      final links = SharedLinkResponseDto.listFromJson(jsonDecode(json)).map(SharedLink.fromDto).toList();

      expect(links, hasLength(2));
      expect(links[0].type, SharedLinkSource.book);
      expect(links[0].title, 'MUSEUM VISITS');
      expect(links[0].thumbAssetId, isNull);
      expect(links[0].allowUpload, isFalse);
      expect(links[0].allowDownload, isTrue);
      expect(links[0].password, 'pw');
      expect(links[0].expiresAt, DateTime.utc(2026, 12, 1, 10));
      expect(links[1].type, SharedLinkSource.individual);
    });

    test('a book link without its book (deleted meanwhile) still parses', () {
      final dto = SharedLinkResponseDto.fromJson(linkJson(type: 'BOOK'))!;

      final link = SharedLink.fromDto(dto);

      expect(link.type, SharedLinkSource.book);
      expect(link.title, 'PHOTO BOOK');
    });

    test('the body that creates a book link takes no uploads and no space', () {
      final dto = bookSharedLinkCreateDto(
        bookId: 'book-1',
        showMetadata: true,
        allowDownload: false,
        password: 'pw',
        expiresAt: DateTime.utc(2026, 12, 1),
      );

      final json = dto.toJson();
      expect(json['type'], SharedLinkType.BOOK);
      expect(json['bookId'], 'book-1');
      expect(json['allowUpload'], isFalse);
      expect(json['allowDownload'], isFalse);
      expect(json['showMetadata'], isTrue);
      expect(json['password'], 'pw');
      expect(json.containsKey('albumId'), isFalse);
      expect(json.containsKey('spaceId'), isFalse);
      expect(json.containsKey('assetIds'), isFalse);
    });
  });
}

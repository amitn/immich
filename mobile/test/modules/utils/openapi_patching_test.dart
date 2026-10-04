import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/openapi_patching.dart';
import 'package:openapi/api.dart';

void main() {
  group('Test OpenApi Patching', () {
    test('upgradeDto', () {
      dynamic value;
      String targetType;

      targetType = 'UserPreferencesResponseDto';
      value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");

      upgradeDto(value, targetType);
      expect(value['tags'], TagsResponse(enabled: false, sidebarWeb: false).toJson());
      expect(value['download']['includeEmbeddedVideos'], false);
    });

    test('addDefault', () {
      final dynamic value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");
      String keys = 'download.unknownKey';
      dynamic defaultValue = 69420;

      addDefault(value, keys, defaultValue);
      expect(value['download']['unknownKey'], 69420);

      keys = 'alpha.beta';
      defaultValue = 'gamma';
      addDefault(value, keys, defaultValue);
      expect(value['alpha']['beta'], 'gamma');
    });

    test('addDefault with null', () {
      final dynamic value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");
      expect(value['download']['unknownKey'], isNull);
    });
  });

  // The generated fromJson must run the patches: without them a response of an older server, which lacks a newly
  // required field, fails to parse (a null check in release mode, an assert in debug mode)
  group('Responses of an older server', () {
    test('a shared link without the redaction fields parses', () {
      final dto = SharedLinkResponseDto.fromJson(
        jsonDecode('''
{
  "id": "link-1", "key": "abc", "userId": "user-1", "type": "ALBUM", "createdAt": "2026-01-01T00:00:00.000Z",
  "allowDownload": true, "allowUpload": false, "showMetadata": true, "assets": [],
  "description": null, "expiresAt": null, "password": null, "slug": null
}
'''),
      );

      expect(dto, isNotNull);
      expect(dto!.redactFaces, isFalse);
      expect(dto.redactText, isFalse);
    });

    test('server features without the assistant turn it off', () {
      final value = jsonDecode('{"trash": true, "map": true}');
      upgradeDto(value, 'ServerFeaturesDto');

      expect(value['assistant'], isFalse);
      expect(value['artisticStyles'], isFalse);
      expect(value['restaurantLookup'], isFalse);
    });

    test('preferences without memory exclusions keep documents in memories', () {
      final value = jsonDecode('{}');
      upgradeDto(value, 'UserPreferencesResponseDto');

      expect(value['memoryExclusions'], {'documents': false});
    });
  });
}

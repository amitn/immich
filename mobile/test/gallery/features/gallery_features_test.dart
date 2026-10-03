import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/features/gallery_features.dart';
import 'package:immich_mobile/models/server_info/server_features.model.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockServerInfoService extends Mock implements ServerInfoService {}

/// The features JSON of a server; [gallery] adds the keys of the assistant work, which an older server lacks
Map<String, Object?> featuresJson({Map<String, Object?>? gallery}) => {
  'configFile': false,
  'duplicateDetection': true,
  'email': false,
  'facialRecognition': true,
  'importFaces': false,
  'map': true,
  'oauth': false,
  'oauthAutoLaunch': false,
  'ocr': true,
  'passwordLogin': true,
  'peopleStatistics': false,
  'realtimeTranscoding': false,
  'reverseGeocoding': true,
  'search': true,
  'sidecar': true,
  'smartSearch': true,
  'smartSearchHasCutoff': false,
  'trash': true,
  ...?gallery,
};

void main() {
  group('GalleryFeatures', () {
    test('a server with the assistant turns on the assistant and photo books', () {
      final dto = ServerFeaturesDto.fromJson(
        featuresJson(
          gallery: {'assistant': true, 'artisticStyles': true, 'bookStadiaMaps': false, 'restaurantLookup': true},
        ),
      )!;

      final features = ServerFeatures.fromDto(dto).gallery;

      expect(features.assistant, isTrue);
      expect(features.books, isTrue);
      expect(features.artisticStyles, isTrue);
      expect(features.bookStadiaMaps, isFalse);
      expect(features.restaurantLookup, isTrue);
    });

    test('an older server, without the keys, hides everything', () {
      final dto = ServerFeaturesDto.fromJson(featuresJson())!;

      expect(ServerFeatures.fromDto(dto).gallery, const GalleryFeatures());
      expect(const GalleryFeatures().books, isFalse);
    });

    test('a server with the assistant disabled hides the assistant and books', () {
      final dto = ServerFeaturesDto.fromJson(
        featuresJson(
          gallery: {'assistant': false, 'artisticStyles': false, 'bookStadiaMaps': false, 'restaurantLookup': false},
        ),
      )!;

      final features = ServerFeatures.fromDto(dto).gallery;
      expect(features.assistant, isFalse);
      expect(features.books, isFalse);
    });

    test('the features default to off before the server answers', () {
      const features = ServerFeatures(trash: true, map: true, oauthEnabled: false, passwordLogin: true);
      expect(features.gallery, const GalleryFeatures());
    });
  });

  group('galleryFeaturesProvider', () {
    test('follows the server features', () async {
      final service = _MockServerInfoService();
      final dto = ServerFeaturesDto.fromJson(
        featuresJson(
          gallery: {'assistant': true, 'artisticStyles': false, 'bookStadiaMaps': false, 'restaurantLookup': false},
        ),
      )!;
      when(() => service.getServerFeatures()).thenAnswer((_) async => ServerFeatures.fromDto(dto));

      final container = ProviderContainer(
        overrides: [serverInfoProvider.overrideWith((ref) => ServerInfoNotifier(service))],
      );
      addTearDown(container.dispose);

      expect(container.read(galleryFeaturesProvider).assistant, isFalse);

      await container.read(serverInfoProvider.notifier).getServerFeatures();

      expect(container.read(galleryFeaturesProvider).assistant, isTrue);
      expect(container.read(galleryFeaturesProvider).books, isTrue);
    });
  });
}

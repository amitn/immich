import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/utils/assistant_links.dart';

const _id = '0B7C1D2E-3F40-4A5B-8C6D-7E8F9A0B1C2D';
const _lower = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';

void main() {
  group('assistantLinkTarget', () {
    test('paths of the web app open in the app', () {
      expect(assistantLinkTarget('/photos/$_id'), const AssistantPhotoLink(_lower));
      expect(assistantLinkTarget('/albums/a/photos/$_id'), const AssistantPhotoLink(_lower));
      expect(assistantLinkTarget('/albums/$_id'), const AssistantAlbumLink(_lower));
      expect(assistantLinkTarget('/books/$_id/'), const AssistantBookLink(_lower));
    });

    test('full links to the server open in the app too', () {
      expect(
        assistantLinkTarget('https://photos.example.com/books/$_id', serverHosts: {'photos.example.com'}),
        const AssistantBookLink(_lower),
      );
    });

    test('other web and mail links leave the app', () {
      expect(
        assistantLinkTarget('https://en.wikipedia.org/wiki/Taormina'),
        AssistantExternalLink(Uri.parse('https://en.wikipedia.org/wiki/Taormina')),
      );
      expect(
        assistantLinkTarget('https://elsewhere.example/books/$_id', serverHosts: {'photos.example.com'}),
        isA<AssistantExternalLink>(),
      );
      expect(assistantLinkTarget('mailto:me@example.com'), isA<AssistantExternalLink>());
    });

    test('anything else is not followed', () {
      expect(assistantLinkTarget('/settings'), isNull);
      expect(assistantLinkTarget('javascript:alert(1)'), isNull);
      expect(assistantLinkTarget('file:///etc/passwd'), isNull);
    });
  });
}

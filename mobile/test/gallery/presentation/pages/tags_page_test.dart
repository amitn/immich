import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/pages/tags.page.dart';
import 'package:immich_mobile/gallery/presentation/widgets/tags/gallery_tags_row.widget.dart';
import 'package:immich_mobile/gallery/providers/tags.provider.dart';
import 'package:immich_mobile/gallery/utils/tag_tree.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';

class _MockGalleryTagRepository extends Mock implements GalleryTagRepository {}

TagResponseDto tag(String id, String value) => TagResponseDto.fromJson({
  'id': id,
  'name': value.split('/').last,
  'value': value,
  'createdAt': '2026-01-01T00:00:00.000Z',
  'updatedAt': '2026-01-01T00:00:00.000Z',
})!;

final _tags = [
  tag('t-rome', 'Holidays/Italy/Rome'),
  tag('t-italy', 'Holidays/Italy'),
  tag('t-crete', 'Holidays/Crete'),
  tag('t-cats', 'Cats'),
  tag('t-noma', 'Food/Noma/Menu'),
];

void main() {
  group('the tree', () {
    test('is built from the paths, levels without a tag included', () {
      final root = buildTagTree(_tags);
      expect(root.children.map((node) => node.name), ['Cats', 'Food', 'Holidays']);

      final holidays = root.find('Holidays')!;
      expect(holidays.hasPhotos, isFalse);
      expect(holidays.children.map((node) => node.name), ['Crete', 'Italy']);
      expect(holidays.tagCount, 3);

      final italy = root.find('Holidays/Italy')!;
      expect(italy.tagId, 't-italy');
      expect(italy.children.single.path, 'Holidays/Italy/Rome');
      expect(root.find('Holidays/Spain'), isNull);
    });

    test('the Explore row leaves the photo tags of the journals out', () {
      expect(exploreTags(_tags).map((tag) => tag.value), [
        'Cats',
        'Holidays/Crete',
        'Holidays/Italy',
        'Holidays/Italy/Rome',
      ]);
      expect(tagParentLabel('Holidays/Italy/Rome'), 'Holidays / Italy');
      expect(tagParentLabel('Cats'), '');
    });
  });

  group('screens', () {
    late _MockGalleryTagRepository repository;
    late FakeGalleryNavigator navigator;

    setUp(() {
      repository = _MockGalleryTagRepository();
      navigator = FakeGalleryNavigator();
      when(() => repository.getTags()).thenAnswer((_) async => _tags);
      when(
        () => repository.coverOf(any()),
      ).thenAnswer((invocation) async => 'cover-${invocation.positionalArguments.first}');
    });

    List<Override> overrides() => [
      ...galleryOverrides(navigator: navigator),
      galleryTagRepositoryProvider.overrideWithValue(repository),
    ];

    testWidgets('the Library row shows the tags with their newest photo, and opens their photos', (tester) async {
      await tester.pumpConsumerWidget(const CustomScrollView(slivers: [GalleryTagsRow()]), overrides: overrides());

      expect(find.text('Tags'), findsOneWidget);
      expect(find.text('Rome'), findsOneWidget);
      expect(find.text('Holidays / Italy'), findsOneWidget);
      expect(find.text('Menu'), findsNothing);
      verify(() => repository.coverOf('t-cats')).called(1);

      await tester.tap(find.text('Cats'));
      await tester.tap(find.byKey(const Key('library-tags-view-all')));
      await tester.pump();
      expect(navigator.calls, ['tag photos t-cats', 'tags']);
    });

    testWidgets('the row is hidden without tags', (tester) async {
      when(() => repository.getTags()).thenAnswer((_) async => []);
      await tester.pumpConsumerWidget(const CustomScrollView(slivers: [GalleryTagsRow()]), overrides: overrides());
      expect(find.text('Tags'), findsNothing);
    });

    testWidgets('the tree opens a level with more tags, and shows the photos of a tag', (tester) async {
      await tester.pumpConsumerWidget(const TagsPage(), overrides: overrides());

      expect(find.text('Holidays'), findsOneWidget);
      expect(find.text('3 tags'), findsOneWidget);
      await tester.tap(find.text('Holidays'));
      await tester.tap(find.text('Cats'));
      await tester.pump();
      expect(navigator.calls, ['tags Holidays', 'tag photos t-cats']);
    });

    testWidgets('a level that is a tag too shows its photos first', (tester) async {
      await tester.pumpConsumerWidget(const TagsPage(path: 'Holidays/Italy'), overrides: overrides());

      expect(find.text('Italy'), findsOneWidget);
      expect(find.text('Holidays'), findsOneWidget);
      await tester.tap(find.byKey(const Key('tags-show-photos')));
      await tester.tap(find.text('Rome'));
      await tester.pump();
      expect(navigator.calls, ['tag photos t-italy', 'tag photos t-rome']);
    });

    testWidgets('says so without tags', (tester) async {
      when(() => repository.getTags()).thenAnswer((_) async => []);
      await tester.pumpConsumerWidget(const TagsPage(), overrides: overrides());
      expect(find.text('No tags yet'), findsOneWidget);
    });
  });
}

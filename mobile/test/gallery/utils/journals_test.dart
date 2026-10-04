import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:openapi/api.dart';

import '../journal_fixtures.dart';

void main() {
  test('the journals, in their order, with their book styles', () {
    expect(journalPacks.map((pack) => pack.id), [
      'food',
      'museum',
      'wine',
      'cookbook',
      'travel',
      'concerts',
      'nature',
      'reading',
      'kids-art',
      'garden',
    ]);
    for (final pack in journalPacks) {
      expect(pack.bookStylePreset, isNotNull, reason: pack.id);
    }
    expect(journalPackOf('kids-art')!.sourceOnSubjects, isTrue);
    expect(journalPackOf('pottery'), isNull);
  });

  group('the photos of others (#21)', () {
    test('are read, but only the user\'s sources are named', () {
      final meal = visit();
      expect(getVisitAssetIds(meal), ['menu-1', 'menu-2', 'dish-1', 'dish-2', 'dish-3', 'dish-4', 'sign-1']);
      expect(getNameableSourceIds(meal), ['menu-1']);
      expect(countReadOnlyPhotos(meal), 2);
    });

    test('are left out of the subjects', () {
      final rows = getEntryRows(visit(), menuMatch());
      expect(rows.map((row) => row.assetIds), [
        ['dish-1'],
        ['dish-2'],
        ['dish-3'],
      ]);
    });
  });

  group('the subjects', () {
    test('get the entry they were matched with, and an unsure match is to be checked', () {
      final rows = getEntryRows(visit(), menuMatch());
      expect(rows[0].name, 'Spaghetti alla carbonara');
      expect(rows[0].unsure, isFalse);
      expect(rows[1].name, 'Tiramisù');
      expect(rows[1].unsure, isTrue);
      expect(rows[1].suggestions, ['Tiramisù', 'Spaghetti alla carbonara']);
    });

    test('one that is not on the source gets no name', () {
      final bread = getEntryRows(visit(), menuMatch())[2];
      expect(bread.name, '');
      expect(bread.offList, isTrue);
      // without a source, nothing is "off the list"
      final noSource = CollectionMatchResponseDto.fromJson({...menuMatch().toJson(), 'entries': <Object?>[]});
      expect(getEntryRows(visit(), noSource)[2].offList, isFalse);
    });

    test('a name saved in the tags wins over the match', () {
      final meal = visit(
        saved: [
          {'assetId': 'dish-2', 'place': 'Trattoria da Enzo', 'entry': 'Panna cotta', 'source': false},
        ],
      );
      final row = getEntryRows(meal, menuMatch())[1];
      expect(row.name, 'Panna cotta');
      expect(row.savedName, 'Panna cotta');
      expect(row.unsure, isFalse);
      expect(row.isSaved, isTrue);
      // offered first, before the entries
      expect(getEntryOptions(menuMatch().entries, row), ['Panna cotta', 'Tiramisù', 'Spaghetti alla carbonara']);
    });

    test('the subject photos the match did not group come one by one', () {
      final meal = visit(subjectIds: ['dish-1', 'dish-5'], readOnlyIds: []);
      final match = CollectionMatchResponseDto.fromJson({
        ...menuMatch().toJson(),
        'subjects': [menuMatch().subjects.first.toJson()],
      })!;
      final rows = getEntryRows(meal, match);
      expect(rows.map((row) => row.key), ['dish-1', 'dish-5']);
      expect(rows.last.name, '');
    });

    test('without a match, every subject photo is a row', () {
      expect(getEntryRows(visit(), null).map((row) => row.key), ['dish-1', 'dish-2', 'dish-3']);
    });
  });

  test('the other names read for the place, not the one it has', () {
    final candidates = [
      CollectionPlaceCandidateDto(name: 'TRATTORIA DA ENZO', source_: CollectionPlaceSource.sign, confidence: 0.5),
      CollectionPlaceCandidateDto(name: 'Da Enzo al 29', source_: CollectionPlaceSource.receipt, confidence: 0.4),
      CollectionPlaceCandidateDto(name: 'da enzo al 29!', source_: CollectionPlaceSource.sign, confidence: 0.3),
      CollectionPlaceCandidateDto(name: 'Trattoría da Énzo', source_: CollectionPlaceSource.sign, confidence: 0.3),
    ];
    expect(getOtherPlaceNames(candidates, 'Trattoria da Enzo').map((c) => c.name), ['Da Enzo al 29']);
  });

  test('a place needs a letter or a digit', () {
    expect(isJournalPlaceValid('  -- '), isFalse);
    expect(isJournalPlaceValid('Café 29'), isTrue);
    expect(isJournalPlaceValid('東京'), isTrue);
  });

  test('the request names the user\'s sources and the named subjects', () {
    final rows = getEntryRows(visit(), menuMatch());
    final (:dto, :skipped) = getCollectionEntriesDto(' Trattoria da Enzo ', ['menu-1'], rows);
    expect(dto.place, 'Trattoria da Enzo');
    expect(dto.photos.map((photo) => (photo.id, photo.entry.orElse(null), photo.source_.orElse(null))), [
      ('menu-1', null, true),
      ('dish-1', 'Spaghetti alla carbonara', null),
      ('dish-2', 'Tiramisù', null),
    ]);
    expect(skipped, 1);
  });

  test('a save is summed up and shows in the visit', () {
    final response = savedEntries({
      'menu-1': 'Food/Trattoria da Enzo/Menu',
      'dish-1': 'Food/Trattoria da Enzo/Spaghetti alla carbonara',
      'dish-2': null,
    });
    final summary = JournalSaveSummary.of(response, ['menu-1']);
    expect((summary.place, summary.sources, summary.subjects, summary.failed), ('Trattoria da Enzo', 1, 1, 1));

    final named = applyCollectionEntries(visit(placeSource: 'fallback', place: 'Lunch in Rome'), response, ['menu-1']);
    expect(named.place.name, 'Trattoria da Enzo');
    expect(named.place.source_, CollectionPlaceSource.tag);
    expect(named.saved.map((saved) => (saved.assetId, saved.entry.orElse(null), saved.source_)), [
      ('menu-1', null, true),
      ('dish-1', 'Spaghetti alla carbonara', false),
    ]);
    expect(named.readOnlyIds.orElse(null), ['menu-2', 'dish-4']);
  });

  test('the time of a visit is the time on the clock where it was', () {
    expect(parseVisitTime('2025-06-14T13:05:00.000'), DateTime(2025, 6, 14, 13, 5));
    expect(parseVisitTime('2025-06-14T13:05:00.000Z'), DateTime(2025, 6, 14, 13, 5));
    expect(parseVisitTime('nonsense'), isNull);
  });

  test('the photo tags of the journals', () {
    expect(isJournalPhotoTag('Food/Noma/Menu'), isTrue);
    expect(isJournalPhotoTag('Kids art/Lina, 2025/Two foxes (age 8)'), isTrue);
    expect(isJournalPhotoTag('Food/Noma'), isFalse);
    expect(isJournalPhotoTag('Holidays/Rome/Day 1'), isFalse);
  });
}

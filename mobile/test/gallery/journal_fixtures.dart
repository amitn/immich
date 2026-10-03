import 'package:openapi/api.dart';

/// A meal: two photos of a menu (one of them a friend's), three dish photos (one a friend's), a sign
Map<String, Object?> visitJson({
  int index = 0,
  String place = 'Trattoria da Enzo',
  String placeSource = 'source',
  String? type = 'Lunch',
  List<String> sourceIds = const ['menu-1', 'menu-2'],
  List<String> subjectIds = const ['dish-1', 'dish-2', 'dish-3', 'dish-4'],
  List<String> readOnlyIds = const ['menu-2', 'dish-4'],
  List<Map<String, Object?>> saved = const [],
  List<Map<String, Object?>> candidates = const [],
}) => {
  'index': index,
  'start': '2025-06-14T13:05:00.000',
  'end': '2025-06-14T14:30:00.000',
  'day': '2025-06-14',
  'type': ?type,
  'city': 'Rome',
  'country': 'Italy',
  'subjectIds': subjectIds,
  'sourceIds': sourceIds,
  'signIds': ['sign-1'],
  'receiptIds': <String>[],
  'place': {'name': place, 'source': placeSource, 'confidence': 0.9, 'assetIds': <String>[]},
  'candidates': candidates,
  'saved': saved,
  if (readOnlyIds.isNotEmpty) 'readOnlyIds': readOnlyIds,
};

CollectionVisitResponseDto visit({
  int index = 0,
  String place = 'Trattoria da Enzo',
  String placeSource = 'source',
  String? type = 'Lunch',
  List<String> sourceIds = const ['menu-1', 'menu-2'],
  List<String> subjectIds = const ['dish-1', 'dish-2', 'dish-3', 'dish-4'],
  List<String> readOnlyIds = const ['menu-2', 'dish-4'],
  List<Map<String, Object?>> saved = const [],
  List<Map<String, Object?>> candidates = const [],
}) => CollectionVisitResponseDto.fromJson(
  visitJson(
    index: index,
    place: place,
    placeSource: placeSource,
    type: type,
    sourceIds: sourceIds,
    subjectIds: subjectIds,
    readOnlyIds: readOnlyIds,
    saved: saved,
    candidates: candidates,
  ),
)!;

CollectionVisitsResponseDto visits(List<Map<String, Object?>> visits, {bool truncated = false}) =>
    CollectionVisitsResponseDto.fromJson({
      'pack': 'food',
      'count': 120,
      'truncated': truncated,
      'photos': 120,
      'visits': visits,
      'warnings': <String>[],
    })!;

/// The menu lists carbonara and tiramisù; dish-1 is the carbonara, dish-2 probably the tiramisù, dish-3 is bread
/// (not on the menu), dish-4 (a friend's) the carbonara too
CollectionMatchResponseDto menuMatch() => CollectionMatchResponseDto.fromJson({
  'entries': [
    {'index': 0, 'name': 'Spaghetti alla carbonara', 'sourceId': 'menu-1'},
    {'index': 1, 'name': 'Tiramisù', 'sourceId': 'menu-1'},
  ],
  'subjects': [
    {
      'assetIds': ['dish-1', 'dish-4'],
      'index': 0,
      'name': 'Spaghetti alla carbonara',
      'score': 0.8,
      'unsure': false,
      'suggestions': [
        {'index': 0, 'name': 'Spaghetti alla carbonara', 'score': 0.8},
      ],
    },
    {
      'assetIds': ['dish-2'],
      'index': 1,
      'name': 'Tiramisù',
      'score': 0.3,
      'unsure': true,
      'suggestions': [
        {'index': 1, 'name': 'Tiramisù', 'score': 0.3},
        {'index': 0, 'name': 'Spaghetti alla carbonara', 'score': 0.1},
      ],
    },
    {
      'assetIds': ['dish-3'],
      'score': 0.1,
      'unsure': true,
      'offList': 0.7,
      'suggestions': [
        {'index': 1, 'name': 'Tiramisù', 'score': 0.2},
      ],
    },
  ],
  'noEmbedding': <String>[],
  'warnings': <String>[],
})!;

CollectionEntriesResponseDto savedEntries(Map<String, String?> tags, {String place = 'Trattoria da Enzo'}) =>
    CollectionEntriesResponseDto.fromJson({
      'place': place,
      'results': [
        for (final MapEntry(key: id, value: tag) in tags.entries)
          {'id': id, 'success': tag != null, 'tag': ?tag, if (tag == null) 'error': 'no_permission'},
      ],
    })!;

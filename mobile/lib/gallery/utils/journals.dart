import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/utils/gallery_i18n.dart';
import 'package:openapi/api.dart';

/// A journal (a collection pack of the API, `/collections/<id>/*`): its naming dialog is the same for every journal
/// and reads the rest from here, like the web's `WebCollectionPack`
class JournalPack {
  /// The id of the server pack, e.g. food; also its book style preset and its i18n prefix (`journals.<id>.*`)
  final String id;

  /// Where it is listed among the journals: food first
  final int order;
  final IconData icon;

  /// The first level of its tags, e.g. Food
  final String tagRoot;

  /// The source is printed on the subjects themselves (a bottle's label): a visit without a source photo still reads
  /// its subjects
  final bool sourceOnSubjects;

  /// The assistant can look its places up on OpenStreetMap (with the server's restaurant lookup)
  final bool placeLookup;

  const JournalPack({
    required this.id,
    required this.order,
    required this.icon,
    required this.tagRoot,
    this.sourceOnSubjects = false,
    this.placeLookup = false,
  });

  /// The book style preset of its books
  BookStylePreset? get bookStylePreset => BookStylePreset.fromJson(id);
}

/// The journals, in their order; the limits of one request are the server's `COLLECTION_LIMITS`
const journalPacks = [
  JournalPack(id: 'food', order: 0, icon: Icons.restaurant_outlined, tagRoot: 'Food', placeLookup: true),
  JournalPack(id: 'museum', order: 10, icon: Icons.account_balance_outlined, tagRoot: 'Art', placeLookup: true),
  JournalPack(
    id: 'wine',
    order: 20,
    icon: Icons.wine_bar_outlined,
    tagRoot: 'Wine',
    sourceOnSubjects: true,
    placeLookup: true,
  ),
  JournalPack(id: 'cookbook', order: 30, icon: Icons.soup_kitchen_outlined, tagRoot: 'Recipes'),
  JournalPack(id: 'travel', order: 40, icon: Icons.luggage_outlined, tagRoot: 'Travel'),
  JournalPack(id: 'concerts', order: 50, icon: Icons.music_note_outlined, tagRoot: 'Concerts', placeLookup: true),
  JournalPack(id: 'nature', order: 60, icon: Icons.local_florist_outlined, tagRoot: 'Nature', placeLookup: true),
  JournalPack(id: 'reading', order: 70, icon: Icons.auto_stories_outlined, tagRoot: 'Reading', sourceOnSubjects: true),
  JournalPack(id: 'kids-art', order: 80, icon: Icons.palette_outlined, tagRoot: 'Kids art', sourceOnSubjects: true),
  JournalPack(id: 'garden', order: 90, icon: Icons.yard_outlined, tagRoot: 'Garden'),
];

JournalPack? journalPackOf(String id) => journalPacks.where((pack) => pack.id == id).firstOrNull;

/// The most photos one request looks in, and the most subjects and sources one match reads
const journalAssetLimit = 2000;
const journalSubjectLimit = 100;
const journalSourceLimit = 100;

/// A label of a journal's naming dialog, `journals.<pack>.<label>` in `i18n/en.json`, e.g. food's `name_action` =
/// "Name the dishes…"
String journalLabel(BuildContext? context, JournalPack pack, String label, {Map<String, Object>? args}) =>
    galleryTr(context, 'journals.${pack.id}.$label', args: args);

/// What the dialog looks in: an album, or photos (a selection, the photos of a notification)
class JournalTarget {
  final String pack;
  final String? albumId;
  final List<String> assetIds;

  const JournalTarget.album(this.pack, String this.albumId) : assetIds = const [];

  const JournalTarget.assets(this.pack, this.assetIds) : albumId = null;

  @override
  bool operator ==(Object other) =>
      other is JournalTarget &&
      other.pack == pack &&
      other.albumId == albumId &&
      other.assetIds.length == assetIds.length &&
      Iterable.generate(assetIds.length).every((i) => other.assetIds[i] == assetIds[i]);

  @override
  int get hashCode => Object.hash(pack, albumId, Object.hashAll(assetIds));
}

/// A subject of a visit as it is edited: its photos (of the same subject, e.g. a dish) and the name they get
class EntryRow {
  /// Stable key: the first photo
  final String key;
  final List<String> assetIds;

  /// The name the photos get; empty skips them
  final String name;

  /// Named freely instead of with an entry of the source
  final bool offList;

  /// The suggested match is weak: the user should check it
  final bool unsure;

  /// The photos already have this name in the tags of the journal
  final String? savedName;

  /// The entry the server matched
  final String? matchedName;

  /// Entries, best first
  final List<String> suggestions;

  const EntryRow({
    required this.key,
    required this.assetIds,
    required this.name,
    this.offList = false,
    this.unsure = false,
    this.savedName,
    this.matchedName,
    this.suggestions = const [],
  });

  EntryRow copyWith({String? name, bool? offList, bool? unsure, String? Function()? savedName}) => EntryRow(
    key: key,
    assetIds: assetIds,
    name: name ?? this.name,
    offList: offList ?? this.offList,
    unsure: unsure ?? this.unsure,
    savedName: savedName == null ? this.savedName : savedName(),
    matchedName: matchedName,
    suggestions: suggestions,
  );

  /// Named as it is in the tags already
  bool get isSaved => savedName != null && savedName == name.trim();
}

/// The subject is probably not on the source (e.g. bread, not on the menu): no entry beats "off the list"
bool isOffListSubject(CollectionSubjectMatchDto subject) {
  final offList = subject.offList.orElse(null);
  final best = subject.suggestions.firstOrNull?.score ?? 0;
  return subject.index.orElse(null) == null && offList != null && offList > best;
}

final _notLetterOrDigit = RegExp(r'[^\p{L}\p{N}]', unicode: true);

/// A name to compare: lower case, without accents, spaces or punctuation
String normalizeJournalName(String name) => _stripAccents(name).replaceAll(_notLetterOrDigit, '');

const _accents = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', //
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', //
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y', 'ß': 'ss', 'œ': 'oe', 'æ': 'ae',
};

/// Without the accents of the Latin letters (Dart has no Unicode decomposition to drop every mark)
String _stripAccents(String name) {
  final lower = name.toLowerCase();
  final buffer = StringBuffer();
  for (final char in lower.split('')) {
    buffer.write(_accents[char] ?? char);
  }
  return buffer.toString();
}

/// The other names read for the place of a visit, but not the name it has (in another case or with other accents)
List<CollectionPlaceCandidateDto> getOtherPlaceNames(List<CollectionPlaceCandidateDto> candidates, String place) {
  final key = normalizeJournalName(place);
  final seen = <String>{};
  return candidates.where((candidate) {
    final name = normalizeJournalName(candidate.name);
    if (name.isEmpty || name == key || seen.contains(name)) {
      return false;
    }
    seen.add(name);
    return true;
  }).toList();
}

List<String> _readOnly(CollectionVisitResponseDto visit) => visit.readOnlyIds.orElse(null) ?? const [];

/// Every photo of a visit
List<String> getVisitAssetIds(CollectionVisitResponseDto visit) =>
    {...visit.sourceIds, ...visit.subjectIds, ...visit.signIds, ...visit.receiptIds}.toList();

/// The source photos of a visit the user can name: not the photos of others (e.g. of a shared space, #21)
List<String> getNameableSourceIds(CollectionVisitResponseDto visit) {
  final readOnly = _readOnly(visit).toSet();
  return visit.sourceIds.where((id) => !readOnly.contains(id)).toList();
}

/// How many photos of a visit are someone else's: they help to read the names, but only their owner names them
int countReadOnlyPhotos(CollectionVisitResponseDto visit) {
  final readOnly = _readOnly(visit).toSet();
  return getVisitAssetIds(visit).where(readOnly.contains).length;
}

/// The saved name of the photos: the one most of them have
String? _savedName(List<String> assetIds, CollectionVisitResponseDto visit) {
  final counts = <String, int>{};
  for (final saved in visit.saved) {
    final entry = saved.entry.orElse(null);
    if (entry != null && entry.isNotEmpty && assetIds.contains(saved.assetId)) {
      counts[entry] = (counts[entry] ?? 0) + 1;
    }
  }
  String? best;
  for (final MapEntry(key: name, value: count) in counts.entries) {
    if (best == null || count > counts[best]!) {
      best = name;
    }
  }
  return best;
}

/// The subjects of a visit to edit: the groups the match found, then the subject photos it could not match one by
/// one. A name already saved in the tags wins over the match, and the photos of others are left out: only their owner
/// names them
List<EntryRow> getEntryRows(CollectionVisitResponseDto visit, CollectionMatchResponseDto? match) {
  final hasSource = (match?.entries.length ?? 0) > 0;
  final grouped = {...?match?.subjects.expand((subject) => subject.assetIds)};
  final sourceIds = visit.sourceIds.toSet();
  final readOnly = _readOnly(visit).toSet();

  final rows = <EntryRow>[];
  for (final subject in match?.subjects ?? const <CollectionSubjectMatchDto>[]) {
    final assetIds = subject.assetIds.where((id) => !readOnly.contains(id)).toList();
    if (assetIds.isEmpty) {
      continue;
    }
    final savedName = _savedName(assetIds, visit);
    final offList = isOffListSubject(subject);
    final matched = subject.name.orElse(null);
    rows.add(
      EntryRow(
        key: assetIds.first,
        assetIds: assetIds,
        name: savedName ?? (offList ? '' : (matched ?? '')),
        offList: hasSource && savedName == null && offList,
        unsure: savedName == null && matched != null && subject.unsure,
        savedName: savedName,
        matchedName: matched,
        suggestions: subject.suggestions.map((suggestion) => suggestion.name).toList(),
      ),
    );
  }

  for (final id in visit.subjectIds) {
    if (grouped.contains(id) || sourceIds.contains(id) || readOnly.contains(id)) {
      continue;
    }
    final savedName = _savedName([id], visit);
    rows.add(EntryRow(key: id, assetIds: [id], name: savedName ?? '', savedName: savedName));
  }

  return rows;
}

/// The names to choose from for a subject: its saved name first when the source reads it differently, then the
/// entries, its suggestions first
List<String> getEntryOptions(List<CollectionEntryDto> entries, EntryRow row) {
  int rank(CollectionEntryDto entry) {
    final index = row.suggestions.indexOf(entry.name);
    return index == -1 ? row.suggestions.length : index;
  }

  final sorted = [...entries]
    ..sort((a, b) {
      final byRank = rank(a) - rank(b);
      return byRank != 0 ? byRank : a.index - b.index;
    });
  final options = sorted.map((entry) => entry.name).toList();
  final savedName = row.savedName;
  if (savedName != null && savedName.isNotEmpty && entries.every((entry) => entry.name != savedName)) {
    options.insert(0, savedName);
  }
  return options;
}

/// Whether the subjects of a visit were read even without a source photo
bool hasSubjectReadings(List<CollectionEntryDto> entries, List<EntryRow> rows) =>
    entries.isNotEmpty || rows.any((row) => row.savedName != null || row.matchedName != null);

final _letterOrDigit = RegExp(r'[\p{L}\p{N}]', unicode: true);

/// Whether a place has a name the server accepts: a letter or a digit
bool isJournalPlaceValid(String place) => _letterOrDigit.hasMatch(place);

/// The request that names the photos of a visit; subjects without a name are left out
({CollectionEntriesDto dto, int skipped}) getCollectionEntriesDto(
  String place,
  List<String> sourceIds,
  List<EntryRow> rows,
) {
  final named = rows.where((row) => row.name.trim().isNotEmpty).toList();
  return (
    dto: CollectionEntriesDto(
      place: place.trim(),
      photos: [
        for (final id in sourceIds) CollectionEntryNameDto(id: id, source_: const Optional.present(true)),
        for (final row in named)
          for (final id in row.assetIds) CollectionEntryNameDto(id: id, entry: Optional.present(row.name.trim())),
      ],
    ),
    skipped: rows.length - named.length,
  );
}

/// How many subject and source photos a save named, and how many failed
class JournalSaveSummary {
  final String place;
  final int subjects;
  final int sources;
  final int failed;

  const JournalSaveSummary({required this.place, required this.subjects, required this.sources, required this.failed});

  factory JournalSaveSummary.of(CollectionEntriesResponseDto response, List<String> sourceIds) {
    final sources = sourceIds.toSet();
    final succeeded = response.results.where((result) => result.success).toList();
    return JournalSaveSummary(
      place: response.place,
      sources: succeeded.where((result) => sources.contains(result.id)).length,
      subjects: succeeded.where((result) => !sources.contains(result.id)).length,
      failed: response.results.length - succeeded.length,
    );
  }
}

/// The visit with the tags a save wrote, so it shows as named
CollectionVisitResponseDto applyCollectionEntries(
  CollectionVisitResponseDto visit,
  CollectionEntriesResponseDto response,
  List<String> sourceIds,
) {
  final sources = sourceIds.toSet();
  final written = <String, String>{
    for (final result in response.results)
      if (result.success && result.tag.orElse(null) != null) result.id: result.tag.value!.split('/').skip(2).join('/'),
  };
  return CollectionVisitResponseDto(
    candidates: visit.candidates,
    city: visit.city,
    country: visit.country,
    day: visit.day,
    end: visit.end,
    index: visit.index,
    latitude: visit.latitude,
    longitude: visit.longitude,
    place: CollectionPlaceCandidateDto(
      name: response.place,
      source_: CollectionPlaceSource.tag,
      confidence: 1,
      assetIds: visit.place.assetIds,
    ),
    readOnlyIds: visit.readOnlyIds,
    receiptIds: visit.receiptIds,
    signIds: visit.signIds,
    sourceIds: visit.sourceIds,
    start: visit.start,
    subjectIds: visit.subjectIds,
    type: visit.type,
    saved: [
      ...visit.saved.where((saved) => !written.containsKey(saved.assetId)),
      for (final MapEntry(key: assetId, value: leaf) in written.entries)
        sources.contains(assetId)
            ? CollectionSavedEntryDto(assetId: assetId, place: response.place, source_: true)
            : CollectionSavedEntryDto(
                assetId: assetId,
                place: response.place,
                entry: Optional.present(leaf),
                source_: false,
              ),
    ],
  );
}

/// The local time of a visit: the server sends it without a zone, as the time on the clock where it was
DateTime? parseVisitTime(String value) {
  final parsed = DateTime.tryParse(value.endsWith('Z') ? value.substring(0, value.length - 1) : value);
  return parsed;
}

/// The tag of a subject or a source of any journal, `<Root>/<Place>/<Entry>` (e.g. `Food/<Restaurant>/<Dish>`):
/// there are too many of them to show one by one next to the other tags, so their place stands for them
bool isJournalPhotoTag(String value) {
  final parts = value.split('/');
  return parts.length == 3 && journalPacks.any((pack) => pack.tagRoot == parts.first);
}

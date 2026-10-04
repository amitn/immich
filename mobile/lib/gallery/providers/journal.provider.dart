import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/repositories/journal_api.repository.dart';
import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:openapi/api.dart';

enum JournalStatus { loading, ready, error }

/// A visit as it is named: its place, what its source lists and its subjects
class JournalVisitDraft {
  final JournalStatus status;
  final String place;
  final List<CollectionEntryDto> entries;
  final List<EntryRow> rows;
  final List<String> warnings;

  /// What the last save named
  final JournalSaveSummary? saved;

  const JournalVisitDraft({
    required this.status,
    required this.place,
    this.entries = const [],
    this.rows = const [],
    this.warnings = const [],
    this.saved,
  });

  JournalVisitDraft copyWith({
    JournalStatus? status,
    String? place,
    List<CollectionEntryDto>? entries,
    List<EntryRow>? rows,
    List<String>? warnings,
    JournalSaveSummary? saved,
  }) => JournalVisitDraft(
    status: status ?? this.status,
    place: place ?? this.place,
    entries: entries ?? this.entries,
    rows: rows ?? this.rows,
    warnings: warnings ?? this.warnings,
    saved: saved ?? this.saved,
  );

  /// The source listed entries to choose from (a menu, wall labels)
  bool get hasSource => entries.isNotEmpty;
}

/// The naming dialog of a journal: the visits found in the photos, and the one being named
class JournalNameState {
  final JournalStatus status;
  final List<CollectionVisitResponseDto> visits;

  /// The server's warnings about the visits
  final List<String> warnings;

  /// More photos than one request reads: the count of those searched
  final int? truncatedCount;

  /// The index of the visit being named
  final int? current;
  final Map<int, JournalVisitDraft> drafts;
  final bool saving;

  /// A visit was named, so the book of the journal can be made
  final bool savedAny;

  const JournalNameState({
    this.status = JournalStatus.loading,
    this.visits = const [],
    this.warnings = const [],
    this.truncatedCount,
    this.current,
    this.drafts = const {},
    this.saving = false,
    this.savedAny = false,
  });

  JournalNameState copyWith({
    JournalStatus? status,
    List<CollectionVisitResponseDto>? visits,
    List<String>? warnings,
    int? Function()? truncatedCount,
    int? Function()? current,
    Map<int, JournalVisitDraft>? drafts,
    bool? saving,
    bool? savedAny,
  }) => JournalNameState(
    status: status ?? this.status,
    visits: visits ?? this.visits,
    warnings: warnings ?? this.warnings,
    truncatedCount: truncatedCount == null ? this.truncatedCount : truncatedCount(),
    current: current == null ? this.current : current(),
    drafts: drafts ?? this.drafts,
    saving: saving ?? this.saving,
    savedAny: savedAny ?? this.savedAny,
  );

  CollectionVisitResponseDto? get visit => current == null ? null : visits[current!];

  JournalVisitDraft? get draft => current == null ? null : drafts[current!];

  /// The place has a name and there is something to name: a source photo of the user's, or a named subject
  bool get canSave {
    final visit = this.visit;
    final draft = this.draft;
    if (visit == null || draft == null || draft.status != JournalStatus.ready || saving) {
      return false;
    }
    if (!isJournalPlaceValid(draft.place)) {
      return false;
    }
    return getNameableSourceIds(visit).isNotEmpty || draft.rows.any((row) => row.name.trim().isNotEmpty);
  }
}

class JournalNameController extends StateNotifier<JournalNameState> {
  final JournalApiRepository _repository;
  final JournalTarget target;

  JournalNameController(this._repository, this.target) : super(const JournalNameState()) {
    unawaited(load());
  }

  Future<void> load() async {
    state = const JournalNameState();
    try {
      final response = await _repository.findVisits(target);
      if (!mounted) {
        return;
      }
      final truncated = response.truncated || target.assetIds.length > journalAssetLimit;
      state = JournalNameState(
        status: JournalStatus.ready,
        visits: response.visits,
        warnings: response.warnings,
        truncatedCount: truncated ? response.count : null,
      );
      if (response.visits.length == 1) {
        open(0);
      }
    } catch (_) {
      if (mounted) {
        state = const JournalNameState(status: JournalStatus.error);
      }
    }
  }

  /// Opens a visit; its subjects are matched with its source the first time
  void open(int index) {
    final visit = state.visits[index];
    if (state.drafts.containsKey(index)) {
      state = state.copyWith(current: () => index);
      return;
    }
    state = state.copyWith(
      current: () => index,
      drafts: {
        ...state.drafts,
        index: JournalVisitDraft(status: JournalStatus.loading, place: visit.place.name),
      },
    );
    unawaited(match(index));
  }

  /// Back to the visits
  void back() => state = state.copyWith(current: () => null);

  void _updateDraft(int index, JournalVisitDraft Function(JournalVisitDraft draft) change) {
    final draft = state.drafts[index];
    if (draft != null) {
      state = state.copyWith(drafts: {...state.drafts, index: change(draft)});
    }
  }

  Future<void> match(int index) async {
    final visit = state.visits[index];
    if (visit.subjectIds.isEmpty) {
      _updateDraft(index, (draft) => draft.copyWith(status: JournalStatus.ready, rows: getEntryRows(visit, null)));
      return;
    }
    _updateDraft(index, (draft) => draft.copyWith(status: JournalStatus.loading));
    try {
      final match = await _repository.match(target.pack, subjectIds: visit.subjectIds, sourceIds: visit.sourceIds);
      if (!mounted) {
        return;
      }
      _updateDraft(
        index,
        (draft) => draft.copyWith(
          status: JournalStatus.ready,
          entries: match.entries,
          rows: getEntryRows(visit, match),
          warnings: match.warnings,
        ),
      );
    } catch (_) {
      if (mounted) {
        _updateDraft(index, (draft) => draft.copyWith(status: JournalStatus.error));
      }
    }
  }

  /// Matches the open visit again, after a failure
  Future<void> retryMatch() async {
    final index = state.current;
    if (index != null) {
      await match(index);
    }
  }

  void setPlace(String place) => _updateCurrent((draft) => draft.copyWith(place: place));

  void _updateCurrent(JournalVisitDraft Function(JournalVisitDraft draft) change) {
    final index = state.current;
    if (index != null) {
      _updateDraft(index, change);
    }
  }

  void _updateRow(String key, EntryRow Function(EntryRow row) change) => _updateCurrent(
    (draft) => draft.copyWith(rows: [for (final row in draft.rows) row.key == key ? change(row) : row]),
  );

  /// Names a subject; a name the user chose or typed is no longer a match to check
  void setName(String key, String name) => _updateRow(key, (row) => row.copyWith(name: name, unsure: false));

  /// A subject that is not on the source (bread, not on the menu) is named freely; back on the list, it gets the
  /// entry it was matched with
  void setOffList(String key, bool offList) {
    final entries = state.draft?.entries ?? const <CollectionEntryDto>[];
    bool isEntry(String name) => entries.any((entry) => entry.name == name.trim());
    _updateRow(key, (row) {
      if (offList) {
        return row.copyWith(offList: true, name: isEntry(row.name) ? '' : row.name);
      }
      final keep = isEntry(row.name) || (row.savedName != null && row.name.trim() == row.savedName);
      return row.copyWith(
        offList: false,
        name: keep ? row.name : (row.savedName ?? row.matchedName ?? row.suggestions.firstOrNull ?? ''),
      );
    });
  }

  /// Names the photos of the open visit; null when it could not be saved
  Future<JournalSaveSummary?> save() async {
    final index = state.current;
    final visit = state.visit;
    final draft = state.draft;
    if (index == null || visit == null || draft == null || !state.canSave) {
      return null;
    }

    final sourceIds = getNameableSourceIds(visit);
    final (:dto, skipped: _) = getCollectionEntriesDto(draft.place, sourceIds, draft.rows);
    state = state.copyWith(saving: true);
    try {
      final response = await _repository.saveEntries(target.pack, dto);
      final summary = JournalSaveSummary.of(response, sourceIds);
      final named = {
        for (final result in response.results)
          if (result.success) result.id,
      };
      if (mounted) {
        final visits = [...state.visits]..[index] = applyCollectionEntries(visit, response, sourceIds);
        state = state.copyWith(
          saving: false,
          savedAny: true,
          visits: visits,
          drafts: {
            ...state.drafts,
            index: draft.copyWith(
              place: response.place,
              saved: summary,
              // the subjects the server named; not the photos it could not name (e.g. of others)
              rows: [
                for (final row in draft.rows)
                  row.name.trim().isEmpty || !row.assetIds.any(named.contains)
                      ? row
                      : row.copyWith(name: row.name.trim(), unsure: false, savedName: () => row.name.trim()),
              ],
            ),
          },
        );
      }
      return summary;
    } catch (_) {
      if (mounted) {
        state = state.copyWith(saving: false);
      }
      rethrow;
    }
  }
}

final journalNameProvider = StateNotifierProvider.autoDispose
    .family<JournalNameController, JournalNameState, JournalTarget>(
      (ref, target) => JournalNameController(ref.watch(journalApiRepositoryProvider), target),
    );

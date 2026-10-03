import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// The journals (`/collections/<pack>/*`, the collection packs of the API): find the visits in photos, read their
/// source (a menu, a wall label) and match the subjects with it, and name the photos in tags
class JournalApiRepository extends ApiRepository {
  final ApiService _apiService;

  JournalApiRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  CollectionsApi get _api => CollectionsApi(_apiService.serverInfoApi.apiClient);

  /// The visits (meals, museum visits…) of an album, or of photos (at most [journalAssetLimit])
  Future<CollectionVisitsResponseDto> findVisits(JournalTarget target) => checkNull(
    _api.findCollectionVisits(
      target.pack,
      target.albumId != null
          ? CollectionVisitsDto(albumId: Optional.present(target.albumId))
          : CollectionVisitsDto(assetIds: Optional.present(target.assetIds.take(journalAssetLimit).toList())),
    ),
  );

  /// Reads the source photos of a visit and matches its subjects with what they list
  Future<CollectionMatchResponseDto> match(
    String pack, {
    required List<String> subjectIds,
    List<String> sourceIds = const [],
  }) => checkNull(
    _api.matchCollectionVisit(
      pack,
      CollectionMatchDto(
        subjectIds: subjectIds.take(journalSubjectLimit).toList(),
        sourceIds: sourceIds.isEmpty
            ? const Optional.absent()
            : Optional.present(sourceIds.take(journalSourceLimit).toList()),
      ),
    ),
  );

  /// Names the photos of a visit in the tags of the journal; photos of others fail with `no_permission`
  Future<CollectionEntriesResponseDto> saveEntries(String pack, CollectionEntriesDto dto) =>
      checkNull(_api.saveCollectionEntries(pack, dto));
}

final journalApiRepositoryProvider = Provider<JournalApiRepository>(
  (ref) => JournalApiRepository(ref.watch(apiServiceProvider)),
);

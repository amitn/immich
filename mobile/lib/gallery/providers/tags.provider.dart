import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/utils/tag_tree.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// The tags with their full paths (`GET /tags`), and the newest photo of a tag for its tile
class GalleryTagRepository extends ApiRepository {
  final ApiService _apiService;

  GalleryTagRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  TagsApi get _tags => TagsApi(_apiService.serverInfoApi.apiClient);

  SearchApi get _search => SearchApi(_apiService.serverInfoApi.apiClient);

  Future<List<TagResponseDto>> getTags() => checkNull(_tags.getAllTags());

  /// The newest photo of a tag, like the web's Explore row
  Future<String?> coverOf(String tagId) async {
    final response = await _search.searchAssets(
      MetadataSearchDto(
        tagIds: Optional.present([tagId]),
        size: const Optional.present(1),
        order: const Optional.present(AssetOrder.desc),
      ),
    );
    return response?.assets.items.firstOrNull?.id;
  }
}

final galleryTagRepositoryProvider = Provider<GalleryTagRepository>(
  (ref) => GalleryTagRepository(ref.watch(apiServiceProvider)),
);

/// The user's tags; refreshed with the screens that show them
final galleryTagsProvider = FutureProvider.autoDispose<List<TagResponseDto>>(
  (ref) => ref.watch(galleryTagRepositoryProvider).getTags(),
);

final galleryTagTreeProvider = Provider.autoDispose<AsyncValue<TagNode>>(
  (ref) => ref.watch(galleryTagsProvider).whenData(buildTagTree),
);

/// The newest photo of a tag; null for a tag without photos (or when it cannot be found)
final galleryTagCoverProvider = FutureProvider.autoDispose.family<String?, String>((ref, tagId) async {
  try {
    return await ref.watch(galleryTagRepositoryProvider).coverOf(tagId);
  } catch (_) {
    return null;
  }
});

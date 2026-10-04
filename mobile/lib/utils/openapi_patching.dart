import 'package:flutter/foundation.dart';
import 'package:openapi/api.dart';

abstract interface class _Dynamic {
  Object? resolve();
}

class _CurrentTimestamp implements _Dynamic {
  const _CurrentTimestamp();

  @override
  Object? resolve() => DateTime.now().toIso8601String();
}

const _now = _CurrentTimestamp();

@visibleForTesting
final Map<String, Map<String, Object?>> openApiPatches = {
  'UserPreferencesResponseDto': {
    'download.includeEmbeddedVideos': false,
    'folders': FoldersResponse(enabled: false, sidebarWeb: false).toJson(),
    'memories': MemoriesResponse(enabled: true, duration: 5, sidebarWeb: false).toJson(),
    'ratings': RatingsResponse(enabled: false).toJson(),
    'people': PeopleResponse(enabled: true, sidebarWeb: false).toJson(),
    'tags': TagsResponse(enabled: false, sidebarWeb: false).toJson(),
    'sharedLinks': SharedLinksResponse(enabled: true, sidebarWeb: false).toJson(),
    'cast': CastResponse(gCastEnabled: false).toJson(),
    'albums': {'defaultAssetOrder': 'desc'},
    'recentlyAdded': RecentlyAddedResponse(sidebarWeb: false).toJson(),
    // A server without the assistant, photo books or collection notices has none of these features to turn on
    'aiAnswers': AiAnswersResponse(enabled: false).toJson(),
    'bookDrafts': BookDraftsResponse(enabled: false).toJson(),
    'collectionNotifications': CollectionNotificationsResponse(enabled: false).toJson(),
    // A server without memory exclusions shows every memory, documents included
    'memoryExclusions': MemoryExclusionsResponse(documents: false).toJson(),
    // A server without memory notifications sends none; the defaults keep them off
    'memoryNotifications': MemoryNotificationsResponse(
      creations: false,
      digest: false,
      digestDay: 7,
      drafts: false,
      hour: 9,
      memories: false,
      timeZone: '',
    ).toJson(),
  },
  'AdminConfigDto': {
    'agent': {
      'activityRetentionDays': 90,
      'artProfile': '',
      'autoApproveWrites': false,
      'chatProfile': '',
      'enabled': false,
      'idleTimeoutMinutes': 15,
      'maxConcurrentSessions': 3,
      'mcpUrl': '',
      'profiles': <Object?>[],
    },
    'books': {
      'drafts': {'birthdays': false, 'enabled': false, 'maxPerRun': 3, 'trips': false, 'yearly': false},
      'maps': {'defaultStyle': 'styled', 'stadiaApiKey': ''},
    },
    'collections': {
      'notifications': {'enabled': false, 'maxPerRun': 3, 'windowDays': 14},
    },
    'food': {
      'openStreetMap': {'enabled': false, 'overpassUrl': 'https://overpass-api.de/api/interpreter'},
    },
    'memoryNotifications': {'digest': false, 'enabled': false},
  },
  // assistant routines (#15): a server without them has nothing to run
  'AdminConfigAgentDto': {
    'routines': {
      'approvalExpiryDays': 7,
      'enabled': false,
      'eventSettleMinutes': 10,
      'maxConcurrentRuns': 1,
      'maxRoutinesPerUser': 20,
      'maxRunMinutes': 30,
      'maxRunsPerDay': 24,
      'maxToolCalls': 200,
      'pauseAfterFailures': 3,
    },
  },
  'ServerConfigDto': {
    'mapLightStyleUrl': 'https://tiles.openfreemap.org/styles/positron',
    'mapDarkStyleUrl': 'https://tiles.openfreemap.org/styles/dark',
    'minFaces': 3,
  },
  'UserResponseDto': {'profileChangedAt': _now},
  'AssetResponseDto': {'visibility': 'timeline', 'createdAt': _now, 'isEdited': false},
  'UserAdminResponseDto': {'profileChangedAt': _now, 'clusterGroupId': ''},
  'LoginResponseDto': {'isOnboarded': false},
  'SyncUserV1': {'profileChangedAt': _now, 'hasProfileImage': false},
  'SyncAssetV1': {'isEdited': false},
  'ServerFeaturesDto': {
    'ocr': false,
    'realtimeTranscoding': false,
    'assistant': false,
    'artisticStyles': false,
    'bookStadiaMaps': false,
    'restaurantLookup': false,
  },
  'SearchAssetResponseDto': {'nextCursor': null},
  // A server without redaction never hides faces or text behind a shared link
  'SharedLinkResponseDto': {'redactFaces': false, 'redactText': false},
  'MemoriesResponse': {'duration': 5, 'sidebarWeb': false},
  'WorkflowResponseDto': {'logging': false},
};

void upgradeDto(dynamic value, String targetType) {
  if (value is! Map) {
    return;
  }
  final fields = openApiPatches[targetType];
  if (fields == null) {
    return;
  }
  fields.forEach((key, defaultValue) {
    addDefault(value, key, defaultValue is _Dynamic ? defaultValue.resolve() : defaultValue);
  });
}

void addDefault(dynamic value, String keys, dynamic defaultValue) {
  // Loop through the keys and assign the default value if the key is not present
  final List<String> keyList = keys.split('.');
  dynamic current = value;

  for (int i = 0; i < keyList.length - 1; i++) {
    if (current[keyList[i]] == null) {
      current[keyList[i]] = {};
    }
    current = current[keyList[i]];
  }

  if (current[keyList.last] == null) {
    current[keyList.last] = defaultValue;
  }
}

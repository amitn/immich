import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/models/assistant_message.model.dart';
import 'package:immich_mobile/gallery/utils/assistant_conversation.dart';
import 'package:openapi/api.dart';

import '../assistant_fixtures.dart';

AssistantMessage _agent(String id, String text) => AssistantMessage.fromDto(message(id, content: {'text': text}));

AssistantMessage _user(String id, String text, {List<String> assetIds = const []}) =>
    AssistantMessage.fromDto(message(id, role: 'user', content: {'text': text, 'assetIds': assetIds}));

AssistantMessage _optimistic(String id, String text, {List<String> assetIds = const [], DateTime? now}) =>
    AssistantMessage.optimistic(id: id, sessionText: text, assetIds: assetIds, now: now);

void main() {
  group('toChatTitle', () {
    test('collapses whitespace and cuts long text', () {
      expect(AssistantConversation.toChatTitle('  Make\n an   album '), 'Make an album');
      final long = 'a' * 100;
      expect(AssistantConversation.toChatTitle(long), '${'a' * 80}…');
    });
  });

  group('upsert', () {
    test('streamed text replaces the message of the same id', () {
      var messages = AssistantConversation.upsert(const [], _agent('m1', 'Look'));
      messages = AssistantConversation.upsert(messages, _agent('m1', 'Looking for photos'));

      expect(messages, hasLength(1));
      expect(messages.single.text, 'Looking for photos');
    });

    test("the server's copy replaces the optimistic user message", () {
      var messages = [
        _optimistic('local-1', 'Make an album', assetIds: [photoA]),
      ];
      messages = AssistantConversation.upsert(messages, _user('m1', 'Make an album', assetIds: [photoA]));

      expect(messages.map((m) => m.id), ['m1']);
      expect(messages.single.pending, isFalse);
    });

    test('a user message with other text still replaces the oldest optimistic one', () {
      var messages = [_optimistic('local-1', 'typo')];
      messages = AssistantConversation.upsert(messages, _user('m1', 'trimmed by the server'));
      expect(messages.map((m) => m.id), ['m1']);
    });

    test('new messages are appended', () {
      var messages = AssistantConversation.upsert(const [], _user('m1', 'Hi'));
      messages = AssistantConversation.upsert(messages, _agent('m2', 'Hello'));
      expect(messages.map((m) => m.id), ['m1', 'm2']);
    });
  });

  group('load', () {
    test("keeps an optimistic message the server's history lacks", () {
      final pending = _optimistic('local-1', 'Still sending', now: DateTime.utc(2026, 9, 2));
      final messages = AssistantConversation.load([pending], [_agent('m1', 'Earlier')]);
      expect(messages.map((m) => m.id), ['m1', 'local-1']);
    });

    test('drops an optimistic message the history confirms', () {
      final pending = _optimistic('local-1', 'Make an album', now: DateTime.utc(2026, 9, 1, 10));
      final messages = AssistantConversation.load([pending], [_user('m1', 'Make an album')]);
      expect(messages.map((m) => m.id), ['m1']);
    });
  });

  group('permissions', () {
    test('a request shows as answered, and leaves the pending ones', () {
      final request = AssistantMessage.fromDto(message('p1', kind: 'permission', content: permissionContent()));
      expect(AssistantConversation.pendingPermissions([request]), hasLength(1));

      final answered = AssistantConversation.setPermissionStatus(
        [request],
        'request-1',
        AssistantPermissionStatus.approved,
      );

      expect(answered.single.status, AssistantPermissionStatus.approved);
      expect(AssistantConversation.pendingPermissions(answered), isEmpty);
    });

    test('the options map to Allow, Allow all in this chat and Deny', () {
      final request = AssistantMessage.fromDto(message('p1', kind: 'permission', content: permissionContent()));
      expect(request.options.map((option) => option.choice), [
        AssistantPermissionChoice.allow,
        AssistantPermissionChoice.allowAll,
        AssistantPermissionChoice.deny,
      ]);
      expect(request.options.map((option) => option.choice.approves), [true, true, false]);
      expect(request.shortToolName, 'create_album');
    });
  });

  test('the photos of a chat, lower case', () {
    final messages = [
      _user('m1', 'Look', assetIds: [photoA.toUpperCase()]),
      AssistantMessage.fromDto(
        message(
          't1',
          kind: 'tool_call',
          content: {
            'assetIds': [photoB],
          },
        ),
      ),
    ];
    expect(AssistantConversation.assetIds(messages), {photoA, photoB});
  });

  group('applySessionUpdate', () {
    test('an untitled chat takes its title from the first message', () {
      final updated = AssistantConversation.applySessionUpdate(
        session('s1'),
        update(
          's1',
          'running',
          message: messageJson('m1', role: 'user', content: {'text': 'Find beach photos'}),
        ),
        now: DateTime.utc(2026, 9, 2),
      );

      expect(updated.title, 'Find beach photos');
      expect(updated.status, AgentSessionStatus.running);
      expect(updated.updatedAt, DateTime.utc(2026, 9, 2));
    });

    test('a titled chat keeps its title', () {
      final updated = AssistantConversation.applySessionUpdate(
        session('s1', title: 'Beach'),
        update(
          's1',
          'idle',
          message: messageJson('m1', role: 'user', content: {'text': 'Something else'}),
        ),
      );
      expect(updated.title, 'Beach');
    });
  });
}

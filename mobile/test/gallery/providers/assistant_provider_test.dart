import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/assistant.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/assistant_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../assistant_fixtures.dart';

class _MockAssistantApiRepository extends Mock implements AssistantApiRepository {}

void main() {
  late _MockAssistantApiRepository repository;
  late GalleryEventBus bus;
  late ProviderContainer container;

  setUp(() {
    repository = _MockAssistantApiRepository();
    bus = GalleryEventBus();
    container = ProviderContainer(
      overrides: [
        assistantApiRepositoryProvider.overrideWithValue(repository),
        galleryEventBusProvider.overrideWithValue(bus),
      ],
    );
  });

  tearDown(() async {
    container.dispose();
    await bus.dispose();
  });

  Future<void> emit(AgentUpdateDto update) async {
    bus.addAgentUpdate(jsonDecode(jsonEncode(update)));
    await Future<void>.delayed(Duration.zero);
  }

  test('an update of another chat moves it in the list but leaves the open chat alone', () async {
    when(() => repository.getSessions()).thenAnswer((_) async => [session('s1', title: 'Open'), session('s2')]);
    when(() => repository.getSession('s1')).thenAnswer((_) async => detail('s1', title: 'Open'));
    final subscription = container.listen(assistantProvider, (_, _) {});
    addTearDown(subscription.close);
    final notifier = container.read(assistantProvider.notifier);

    await notifier.start(sessionId: 's1');
    await Future<void>.delayed(Duration.zero);

    await emit(
      update(
        's2',
        'running',
        message: messageJson('m1', sessionId: 's2', role: 'user', content: {'text': 'Rome'}),
      ),
    );

    final state = container.read(assistantProvider);
    expect(state.sessionId, 's1');
    expect(state.messages, isEmpty);
    expect(state.isRunning, isFalse);
    final other = state.sessions!.firstWhere((candidate) => candidate.id == 's2');
    expect(other.status, AgentSessionStatus.running);
    expect(other.title, 'Rome');
  });

  test('an update of a chat the list does not know reloads the list', () async {
    when(() => repository.getSessions()).thenAnswer((_) async => [session('s1')]);
    final subscription = container.listen(assistantProvider, (_, _) {});
    addTearDown(subscription.close);
    await container.read(assistantProvider.notifier).start();
    await Future<void>.delayed(Duration.zero);

    when(() => repository.getSessions()).thenAnswer((_) async => [session('s9', title: 'From the web'), session('s1')]);
    await emit(update('s9', 'running'));
    await Future<void>.delayed(Duration.zero);

    expect(container.read(assistantProvider).sessions!.first.title, 'From the web');
  });

  test('a failed chat list is an empty list, not a spinner', () async {
    when(() => repository.getSessions()).thenThrow(ApiException(500, 'boom'));
    final subscription = container.listen(assistantProvider, (_, _) {});
    addTearDown(subscription.close);

    await container.read(assistantProvider.notifier).loadSessions();

    final state = container.read(assistantProvider);
    expect(state.sessions, isEmpty);
    expect(state.sessionsFailed, isTrue);
  });

  test('a chat that fails to load returns to a new chat', () async {
    when(() => repository.getSessions()).thenAnswer((_) async => []);
    when(() => repository.getSession('gone')).thenThrow(ApiException(404, 'not found'));
    final subscription = container.listen(assistantProvider, (_, _) {});
    addTearDown(subscription.close);

    await expectLater(
      container.read(assistantProvider.notifier).openSession('gone'),
      throwsA(isA<AssistantError>().having((error) => error.failure, 'failure', AssistantFailure.loadChat)),
    );
    expect(container.read(assistantProvider).sessionId, isNull);
  });
}

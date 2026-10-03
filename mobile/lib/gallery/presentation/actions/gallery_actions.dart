import 'package:immich_mobile/gallery/presentation/actions/ask_assistant.action.dart';
import 'package:immich_mobile/gallery/presentation/actions/name_journal.action.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';

/// The actions of the assistant work (#3) on selected photos, for the selection sheets of the timeline, an album and a
/// space: each hides itself where it does not apply
const galleryTimelineActions = <ActionColumnButton>[
  ActionColumnButton(action: AskAssistantAction(source: .timeline)),
  ActionColumnButton(action: NameJournalAction(source: .timeline)),
];

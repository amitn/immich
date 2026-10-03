import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_asset_thumbnail.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_photo_viewer.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/journals/journal_entry_row.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/providers/journal.provider.dart';
import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';

/// "Name the …" of a journal (the web's `JournalNameModal`): finds the visits (meals, museum visits, tastings…) in an
/// album or in photos, reads the source photos of one (a menu, wall labels) and matches its subjects with it, and
/// names them in the tags of the journal. Made for one hand: the actions are at the bottom, and the source photos
/// open full screen to be read. The photos of others are read, never named (#21)
@RoutePage()
class JournalNamePage extends ConsumerWidget {
  final String pack;
  final String? albumId;
  final String? albumName;
  final int albumAssetCount;
  final List<String> assetIds;

  const JournalNamePage({
    super.key,
    required this.pack,
    this.albumId,
    this.albumName,
    this.albumAssetCount = 0,
    this.assetIds = const [],
  });

  JournalTarget get _target =>
      albumId != null ? JournalTarget.album(pack, albumId!) : JournalTarget.assets(pack, assetIds);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final journal = journalPackOf(pack);
    if (journal == null) {
      return Scaffold(appBar: AppBar());
    }
    final target = _target;
    final state = ref.watch(journalNameProvider(target));
    final controller = ref.read(journalNameProvider(target).notifier);
    final assistant = ref.watch(galleryFeaturesProvider.select((features) => features.assistant));
    final restaurantLookup = ref.watch(galleryFeaturesProvider.select((features) => features.restaurantLookup));
    final navigator = ref.read(galleryNavigatorProvider);
    final canMakeBook = albumId != null || assistant;
    String label(String key, {Map<String, Object>? args}) => journalLabel(context, journal, key, args: args);

    Future<void> makeBook() async {
      if (albumId != null) {
        await Navigator.of(context).maybePop();
        await navigator.exportAlbumAsBook(
          albumId: albumId!,
          albumName: albumName ?? '',
          assetCount: albumAssetCount,
          stylePreset: journal.bookStylePreset,
        );
        return;
      }
      final prompt = label('book_prompt');
      await Navigator.of(context).maybePop();
      await navigator.openAssistant(assetIds: assetIds, prompt: prompt);
    }

    Future<void> save() async {
      final toast = ref.read(toastServiceProvider);
      final errorText = label('error_save');
      try {
        final summary = await controller.save();
        if (summary == null) {
          return;
        }
        ref.invalidate(tagProvider);
        if (!context.mounted) {
          return;
        }
        await toast.success(
          label('saved', args: {'subjects': summary.subjects, 'sources': summary.sources, 'place': summary.place}),
        );
        if (summary.failed > 0 && context.mounted) {
          await toast.error(label('not_saved', args: {'count': summary.failed}));
        }
      } catch (_) {
        await toast.error(errorText);
      }
    }

    Future<void> askAssistant(CollectionVisitResponseDto visit, JournalVisitDraft draft) async {
      final start = parseVisitTime(visit.start);
      final args = <String, Object>{
        'type': visit.type.orElse(null) ?? '',
        'date': start == null ? visit.day : DateFormat.yMMMMEEEEd(context.locale.toString()).format(start),
        'place': draft.place.trim(),
      };
      final unknown = visit.place.source_ == CollectionPlaceSource.fallback && draft.place.trim() == visit.place.name;
      final prompt = label(unknown ? 'assistant_prompt_unknown_place' : 'assistant_prompt', args: args);
      await Navigator.of(context).maybePop();
      await navigator.openAssistant(assetIds: getVisitAssetIds(visit), prompt: prompt);
    }

    final visit = state.visit;
    final draft = state.draft;
    final showList = visit == null || draft == null;

    Widget body;
    Widget? bottom;
    switch (state.status) {
      case JournalStatus.loading:
        body = _Message(icon: journal.icon, text: label('finding'), busy: true);
      case JournalStatus.error:
        body = _Message(
          icon: Icons.error_outline,
          text: label('error_find'),
          action: TextButton(onPressed: () => unawaited(controller.load()), child: Text(context.t.retry)),
        );
      case JournalStatus.ready when showList:
        final warnings = [
          if (state.truncatedCount != null) label('truncated', args: {'count': state.truncatedCount!}),
          ...state.warnings,
        ];
        body = state.visits.isEmpty
            ? _Message(
                icon: journal.icon,
                text: label(albumId != null ? 'no_visits_album' : 'no_visits_selection'),
                notes: warnings,
              )
            : _VisitList(journal: journal, visits: state.visits, warnings: warnings, onOpen: controller.open);
        if (state.savedAny && canMakeBook) {
          bottom = FilledButton.icon(
            key: const Key('journal-make-book'),
            onPressed: () => unawaited(makeBook()),
            icon: const Icon(Icons.menu_book_outlined),
            label: Text(label('make_book')),
          );
        }
      case JournalStatus.ready:
        body = _VisitDetail(
          journal: journal,
          visit: visit!,
          draft: draft!,
          placeLookup: journal.placeLookup && restaurantLookup,
          canMakeBook: canMakeBook,
          controller: controller,
        );
        bottom = Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 8,
          children: [
            if (assistant || (draft.saved != null && canMakeBook))
              Row(
                spacing: 8,
                children: [
                  if (assistant)
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const Key('journal-ask-assistant'),
                        onPressed: () => unawaited(askAssistant(visit, draft)),
                        icon: const Icon(Icons.auto_awesome_outlined),
                        label: Text(label('ask_assistant'), overflow: TextOverflow.ellipsis),
                      ),
                    ),
                  if (draft.saved != null && canMakeBook)
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const Key('journal-make-book'),
                        onPressed: () => unawaited(makeBook()),
                        icon: const Icon(Icons.menu_book_outlined),
                        label: Text(label('make_book'), overflow: TextOverflow.ellipsis),
                      ),
                    ),
                ],
              ),
            FilledButton.icon(
              key: const Key('journal-save'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: state.canSave ? () => unawaited(save()) : null,
              icon: state.saving
                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.check),
              label: Text(context.t.save),
            ),
          ],
        );
    }

    final canGoBack = !showList && state.visits.length > 1;
    return PopScope(
      canPop: !canGoBack,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && canGoBack) {
          controller.back();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(label('title')),
          leading: canGoBack
              ? IconButton(
                  key: const Key('journal-all-visits'),
                  tooltip: label('all_visits'),
                  icon: const Icon(Icons.arrow_back),
                  onPressed: controller.back,
                )
              : null,
        ),
        body: body,
        bottomNavigationBar: bottom == null
            ? null
            : SafeArea(
                child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: bottom),
              ),
      ),
    );
  }
}

/// "Lunch · Sat, Jun 14, 2025 1:05 PM": the kind of a visit (food only) and its local time
String journalVisitTitle(BuildContext context, JournalPack journal, CollectionVisitResponseDto visit) {
  final start = parseVisitTime(visit.start);
  final time = start == null ? visit.day : DateFormat.yMMMEd(context.locale.toString()).add_jm().format(start);
  final type = visit.type.orElse(null);
  if (type == null || type.isEmpty) {
    return time;
  }
  final typeLabel = journalLabel(context, journal, 'visit_type_${type.toLowerCase()}');
  return typeLabel.startsWith('journals.') ? time : '$typeLabel · $time';
}

String? _visitPlace(CollectionVisitResponseDto visit) {
  final parts = [visit.city.orElse(null), visit.country.orElse(null)].whereType<String>().where((s) => s.isNotEmpty);
  return parts.isEmpty ? null : parts.join(', ');
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String text;
  final bool busy;
  final List<String> notes;
  final Widget? action;

  const _Message({required this.icon, required this.text, this.busy = false, this.notes = const [], this.action});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 12,
          children: [
            if (busy)
              const CircularProgressIndicator()
            else
              Icon(icon, size: 48, color: theme.colorScheme.onSurfaceVariant),
            Text(text, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            for (final note in notes)
              Text(
                note,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ?action,
          ],
        ),
      ),
    );
  }
}

class _VisitList extends StatelessWidget {
  final JournalPack journal;
  final List<CollectionVisitResponseDto> visits;
  final List<String> warnings;
  final ValueChanged<int> onOpen;

  const _VisitList({required this.journal, required this.visits, required this.warnings, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    String label(String key, {Map<String, Object>? args}) => journalLabel(context, journal, key, args: args);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Text(label('visits_found', args: {'count': visits.length}), style: theme.textTheme.titleSmall),
        for (final warning in warnings)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(warning, style: muted),
          ),
        const SizedBox(height: 8),
        for (final (index, visit) in visits.indexed)
          Card(
            key: ValueKey('journal-visit-$index'),
            margin: const EdgeInsets.only(bottom: 8),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => onOpen(index),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Row(
                  spacing: 12,
                  children: [
                    GalleryAssetThumbnail(
                      assetId: visit.subjectIds.firstOrNull ?? getVisitAssetIds(visit).first,
                      size: 64,
                    ),
                    Expanded(
                      child: _VisitSummary(journal: journal, visit: visit),
                    ),
                    const Icon(Icons.chevron_right),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _VisitSummary extends StatelessWidget {
  final JournalPack journal;
  final CollectionVisitResponseDto visit;

  const _VisitSummary({required this.journal, required this.visit});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    String label(String key, {Map<String, Object>? args}) => journalLabel(context, journal, key, args: args);
    final others = getOtherPlaceNames(visit.candidates, visit.place.name).map((candidate) => candidate.name);
    final named = visit.saved.where((saved) => saved.entry.orElse(null) != null).length;
    final place = _visitPlace(visit);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 2,
      children: [
        Text(visit.place.name, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
        Text(
          [
            label('place_source_${visit.place.source_}'),
            if (others.isNotEmpty) label('also_read', args: {'names': others.join(', ')}),
          ].join(' · '),
          style: muted,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        Text(journalVisitTitle(context, journal, visit), style: theme.textTheme.bodySmall),
        if (place != null) Text(place, style: muted),
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: label(
                  'visit_photos',
                  args: {'subjects': visit.subjectIds.length, 'sources': visit.sourceIds.length},
                ),
              ),
              if (named > 0)
                TextSpan(
                  text: ' · ${label('visit_named', args: {'count': named})}',
                  style: TextStyle(color: Colors.green.shade700),
                ),
            ],
          ),
          style: muted,
        ),
      ],
    );
  }
}

class _VisitDetail extends StatelessWidget {
  final JournalPack journal;
  final CollectionVisitResponseDto visit;
  final JournalVisitDraft draft;
  final bool placeLookup;
  final bool canMakeBook;
  final JournalNameController controller;

  const _VisitDetail({
    required this.journal,
    required this.visit,
    required this.draft,
    required this.placeLookup,
    required this.canMakeBook,
    required this.controller,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final muted = theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant);
    String label(String key, {Map<String, Object>? args}) => journalLabel(context, journal, key, args: args);
    final others = getOtherPlaceNames(visit.candidates, draft.place);
    final readOnly = countReadOnlyPhotos(visit);
    final place = _visitPlace(visit);
    final subjectsRead =
        journal.sourceOnSubjects &&
        draft.status != JournalStatus.error &&
        (draft.status == JournalStatus.loading || hasSubjectReadings(draft.entries, draft.rows));
    final skipped = draft.rows.where((row) => row.name.trim().isEmpty).length;
    final saved = draft.saved;

    Widget heading(String text) => Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 8),
      child: Text(text, style: theme.textTheme.titleSmall),
    );

    Widget note(IconData icon, String text, {Color? color}) => Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: (color ?? colorScheme.primary).withAlpha(20),
        borderRadius: const BorderRadius.all(Radius.circular(12)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 8,
        children: [
          Icon(icon, size: 20, color: color ?? colorScheme.primary),
          Expanded(child: Text(text, style: theme.textTheme.bodySmall)),
        ],
      ),
    );

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Text(journalVisitTitle(context, journal, visit), style: theme.textTheme.titleMedium),
        if (place != null)
          Row(
            spacing: 4,
            children: [
              Icon(Icons.place_outlined, size: 16, color: colorScheme.onSurfaceVariant),
              Text(place, style: muted),
            ],
          ),
        const SizedBox(height: 16),
        _PlaceField(
          key: ValueKey('journal-place-${visit.index}'),
          value: draft.place,
          label: label('place'),
          helper: label('place_source_${visit.place.source_}'),
          onChanged: controller.setPlace,
        ),
        if (visit.place.source_ == CollectionPlaceSource.fallback)
          note(
            Icons.warning_amber_outlined,
            label(placeLookup ? 'place_unknown_lookup' : 'place_unknown'),
            color: Colors.amber.shade800,
          ),
        if (others.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(label('other_names'), style: muted),
          ),
          Wrap(
            spacing: 8,
            children: [
              for (final candidate in others)
                ActionChip(
                  key: ValueKey('journal-other-name-${candidate.name}'),
                  label: Text(candidate.name),
                  tooltip: label('place_source_${candidate.source_}'),
                  onPressed: () => controller.setPlace(candidate.name),
                ),
            ],
          ),
        ],
        if (readOnly > 0) note(Icons.people_outline, context.t.journal_read_only_photos(count: readOnly)),
        heading(label('source')),
        if (visit.sourceIds.isEmpty)
          Text(
            subjectsRead
                ? (draft.status == JournalStatus.ready
                      ? label('entries_read', args: {'count': draft.entries.length})
                      : '')
                : label('no_source'),
            style: muted,
          )
        else ...[
          SizedBox(
            height: 112,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: visit.sourceIds.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) => Semantics(
                button: true,
                label: label('view_source'),
                child: Stack(
                  children: [
                    GalleryAssetThumbnail(
                      key: ValueKey('journal-source-${visit.sourceIds[index]}'),
                      assetId: visit.sourceIds[index],
                      size: 112,
                      semanticLabel: label('source_photo'),
                      onTap: () =>
                          unawaited(showGalleryPhotos(context, visit.sourceIds, index: index, title: label('source'))),
                    ),
                    const Positioned(
                      right: 6,
                      bottom: 6,
                      child: IgnorePointer(child: Icon(Icons.zoom_out_map, color: Colors.white, size: 20)),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (draft.status == JournalStatus.ready)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(label('entries_read', args: {'count': draft.entries.length}), style: muted),
            ),
        ],
        heading(label('subjects')),
        switch (draft.status) {
          JournalStatus.loading => Row(
            spacing: 12,
            children: [
              const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
              Expanded(child: Text(label('matching'), style: muted)),
            ],
          ),
          JournalStatus.error => Row(
            children: [
              Expanded(
                child: Text(label('error_match'), style: TextStyle(color: colorScheme.error)),
              ),
              TextButton(onPressed: () => unawaited(controller.retryMatch()), child: Text(context.t.retry)),
            ],
          ),
          JournalStatus.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final warning in draft.warnings)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(warning, style: muted),
                ),
              if (draft.rows.isEmpty) Text(label('no_subjects'), style: muted),
              for (final row in draft.rows)
                JournalEntryRowTile(
                  key: ValueKey('journal-row-${row.key}'),
                  journal: journal,
                  row: row,
                  entries: draft.entries,
                  onName: (name) => controller.setName(row.key, name),
                  onOffList: (offList) => controller.setOffList(row.key, offList),
                ),
              if (skipped > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(label('skipped', args: {'count': skipped}), style: muted),
                ),
            ],
          ),
        },
        if (saved != null)
          note(
            Icons.check_circle_outline,
            [
              label('saved', args: {'subjects': saved.subjects, 'sources': saved.sources, 'place': saved.place}),
              if (canMakeBook) label('make_book_description'),
            ].join('\n'),
            color: Colors.green.shade700,
          ),
      ],
    );
  }
}

/// The place of a visit, kept in step with a name chosen among the other names read
class _PlaceField extends StatefulWidget {
  final String value;
  final String label;
  final String helper;
  final ValueChanged<String> onChanged;

  const _PlaceField({
    super.key,
    required this.value,
    required this.label,
    required this.helper,
    required this.onChanged,
  });

  @override
  State<_PlaceField> createState() => _PlaceFieldState();
}

class _PlaceFieldState extends State<_PlaceField> {
  late final TextEditingController _controller = TextEditingController(text: widget.value);

  @override
  void didUpdateWidget(covariant _PlaceField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != _controller.text) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(
    key: const Key('journal-place'),
    controller: _controller,
    maxLength: 100,
    textCapitalization: TextCapitalization.words,
    onChanged: widget.onChanged,
    decoration: InputDecoration(
      labelText: widget.label,
      helperText: widget.helper,
      helperMaxLines: 2,
      border: const OutlineInputBorder(),
    ),
  );
}

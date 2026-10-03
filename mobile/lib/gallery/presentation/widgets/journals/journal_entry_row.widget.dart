import 'dart:async';

import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_asset_thumbnail.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_photo_viewer.widget.dart';
import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

/// A subject of a visit (a dish, an artwork) to name: its photos, a name typed or chosen among the entries of the
/// source, and whether it is on the source at all
class JournalEntryRowTile extends StatefulWidget {
  final JournalPack journal;
  final EntryRow row;
  final List<CollectionEntryDto> entries;
  final ValueChanged<String> onName;
  final ValueChanged<bool> onOffList;

  const JournalEntryRowTile({
    super.key,
    required this.journal,
    required this.row,
    required this.entries,
    required this.onName,
    required this.onOffList,
  });

  @override
  State<JournalEntryRowTile> createState() => _JournalEntryRowTileState();
}

class _JournalEntryRowTileState extends State<JournalEntryRowTile> {
  late final TextEditingController _name = TextEditingController(text: widget.row.name);

  @override
  void didUpdateWidget(covariant JournalEntryRowTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    // a name chosen in the list, or restored when the subject goes back on the source
    if (widget.row.name != _name.text) {
      _name.value = TextEditingValue(
        text: widget.row.name,
        selection: TextSelection.collapsed(offset: widget.row.name.length),
      );
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  String _label(String key, {Map<String, Object>? args}) => journalLabel(context, widget.journal, key, args: args);

  Future<void> _choose() async {
    final options = getEntryOptions(widget.entries, widget.row);
    final chosen = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) =>
          _EntryPicker(title: _label('subject_name_placeholder'), options: options, selected: widget.row.name),
    );
    if (chosen != null) {
      widget.onName(chosen);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final row = widget.row;
    final hasSource = widget.entries.isNotEmpty;
    final choose = hasSource && !row.offList;
    final amber = Colors.amber.shade800;
    final green = Colors.green.shade700;

    Widget badge(String text, Color color) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: color.withAlpha(28), borderRadius: const BorderRadius.all(Radius.circular(10))),
      child: Text(text, style: theme.textTheme.labelSmall?.copyWith(color: color)),
    );

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: row.unsure ? amber : colorScheme.outlineVariant),
        borderRadius: const BorderRadius.all(Radius.circular(14)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 12,
        children: [
          Tooltip(
            message: _label('subject_photos', args: {'count': row.assetIds.length}),
            child: Stack(
              children: [
                GalleryAssetThumbnail(
                  assetId: row.assetIds.first,
                  size: 76,
                  semanticLabel: row.name.trim().isEmpty ? _label('subject_unnamed') : row.name,
                  onTap: () => unawaited(showGalleryPhotos(context, row.assetIds, title: row.name.trim())),
                ),
                if (row.assetIds.length > 1)
                  Positioned(
                    right: 4,
                    bottom: 4,
                    child: IgnorePointer(
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: const BoxDecoration(
                          color: Colors.black54,
                          borderRadius: BorderRadius.all(Radius.circular(8)),
                        ),
                        child: Text(
                          '+${row.assetIds.length - 1}',
                          style: theme.textTheme.labelSmall?.copyWith(color: Colors.white),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 6,
              children: [
                if (row.unsure || row.offList || row.isSaved)
                  Wrap(
                    spacing: 6,
                    children: [
                      if (row.unsure) badge(_label('subject_unsure'), amber),
                      if (row.offList) badge(_label('not_on_source'), colorScheme.onSurfaceVariant),
                      if (row.isSaved) badge(_label('subject_saved'), green),
                    ],
                  ),
                TextField(
                  key: ValueKey('journal-name-${row.key}'),
                  controller: _name,
                  maxLength: 200,
                  maxLines: null,
                  textCapitalization: TextCapitalization.sentences,
                  onChanged: widget.onName,
                  decoration: InputDecoration(
                    isDense: true,
                    counterText: '',
                    labelText: _label('subject_name'),
                    hintText: _label(choose ? 'subject_name_placeholder' : 'subject_free_placeholder'),
                    hintMaxLines: 2,
                    border: const OutlineInputBorder(),
                    suffixIcon: choose
                        ? IconButton(
                            key: ValueKey('journal-choose-${row.key}'),
                            tooltip: _label('subject_name_placeholder'),
                            icon: const Icon(Icons.list_alt),
                            onPressed: () => unawaited(_choose()),
                          )
                        : null,
                  ),
                ),
                if (hasSource)
                  InkWell(
                    key: ValueKey('journal-off-list-${row.key}'),
                    onTap: () => widget.onOffList(!row.offList),
                    child: Row(
                      children: [
                        Checkbox(
                          value: row.offList,
                          visualDensity: VisualDensity.compact,
                          onChanged: (value) => widget.onOffList(value ?? false),
                        ),
                        Flexible(child: Text(_label('not_on_source'), style: theme.textTheme.bodySmall)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The entries of the source to choose from, the suggestions for the subject first, with a filter
class _EntryPicker extends StatefulWidget {
  final String title;
  final List<String> options;
  final String selected;

  const _EntryPicker({required this.title, required this.options, required this.selected});

  @override
  State<_EntryPicker> createState() => _EntryPickerState();
}

class _EntryPickerState extends State<_EntryPicker> {
  var _filter = '';

  @override
  Widget build(BuildContext context) {
    final filter = normalizeJournalName(_filter);
    final shown = filter.isEmpty
        ? widget.options
        : widget.options.where((option) => normalizeJournalName(option).contains(filter)).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      builder: (context, scroll) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              key: const Key('journal-entry-filter'),
              onChanged: (value) => setState(() => _filter = value),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: widget.title,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              controller: scroll,
              itemCount: shown.length,
              itemBuilder: (context, index) => ListTile(
                key: ValueKey('journal-entry-${shown[index]}'),
                title: Text(shown[index]),
                trailing: shown[index] == widget.selected.trim() ? const Icon(Icons.check) : null,
                onTap: () => Navigator.of(context).pop(shown[index]),
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(context.t.cancel)),
          ),
        ],
      ),
    );
  }
}

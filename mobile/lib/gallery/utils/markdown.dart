/// A small markdown parser for the assistant's replies: the GitHub flavour the agents write (headings, lists, quotes,
/// code, tables, emphasis, links), with line breaks kept. Images and HTML are never rendered: a reply makes no
/// requests of its own, like on the web.
library;

/// A run of text with one style
class MdSpan {
  final String text;
  final bool bold;
  final bool italic;
  final bool strike;
  final bool code;

  /// The link target, when the span is (part of) a link
  final String? href;

  /// The photo whose thumbnail replaces the span: an id of a photo of the chat
  final String? assetId;

  const MdSpan(
    this.text, {
    this.bold = false,
    this.italic = false,
    this.strike = false,
    this.code = false,
    this.href,
    this.assetId,
  });

  MdSpan _with({bool? bold, bool? italic, bool? strike, String? href}) => MdSpan(
    text,
    bold: this.bold || (bold ?? false),
    italic: this.italic || (italic ?? false),
    strike: this.strike || (strike ?? false),
    code: code,
    href: this.href ?? href,
    assetId: assetId,
  );

  @override
  bool operator ==(Object other) =>
      other is MdSpan &&
      other.text == text &&
      other.bold == bold &&
      other.italic == italic &&
      other.strike == strike &&
      other.code == code &&
      other.href == href &&
      other.assetId == assetId;

  @override
  int get hashCode => Object.hash(text, bold, italic, strike, code, href, assetId);

  @override
  String toString() {
    final flags = [
      if (bold) 'bold',
      if (italic) 'italic',
      if (strike) 'strike',
      if (code) 'code',
      if (href != null) 'href=$href',
      if (assetId != null) 'asset=$assetId',
    ];
    return 'MdSpan(${flags.isEmpty ? '' : '${flags.join(',')}: '}"$text")';
  }
}

sealed class MdBlock {
  const MdBlock();
}

class MdParagraph extends MdBlock {
  final List<MdSpan> spans;

  const MdParagraph(this.spans);
}

class MdHeading extends MdBlock {
  final int level;
  final List<MdSpan> spans;

  const MdHeading(this.level, this.spans);
}

class MdCodeBlock extends MdBlock {
  final String code;

  const MdCodeBlock(this.code);
}

class MdQuote extends MdBlock {
  final List<MdBlock> blocks;

  const MdQuote(this.blocks);
}

class MdList extends MdBlock {
  final bool ordered;
  final int start;

  /// Each item is a list of blocks: its text, and any nested list
  final List<List<MdBlock>> items;

  const MdList({required this.ordered, required this.items, this.start = 1});
}

class MdTable extends MdBlock {
  final List<List<MdSpan>> header;
  final List<List<List<MdSpan>>> rows;

  const MdTable(this.header, this.rows);
}

class MdRule extends MdBlock {
  const MdRule();
}

final _uuid = RegExp(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', caseSensitive: false);
final _uuidOnly = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false);
final _heading = RegExp(r'^(#{1,6})\s+(.*?)\s*#*\s*$');
final _rule = RegExp(r'^\s{0,3}([-*_])(\s*\1){2,}\s*$');
final _fence = RegExp(r'^\s{0,3}(```|~~~)');
final _bullet = RegExp(r'^(\s*)[-*+]\s+(.*)$');
final _ordered = RegExp(r'^(\s*)(\d{1,9})[.)]\s+(.*)$');
final _quote = RegExp(r'^\s{0,3}>\s?(.*)$');
final _tableSeparator = RegExp(r'^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$');

/// Only these links are followed: the web's rule (http(s), mail, and paths of the server)
final _safeUrl = RegExp(r'^(?:https?:|mailto:|/(?!/)|#)', caseSensitive: false);

/// Parses [markdown] into blocks; ids of [assetIds] (lower case) in the text become photo chips
List<MdBlock> parseMarkdown(String? markdown, {Set<String> assetIds = const {}}) {
  if (markdown == null || markdown.trim().isEmpty) {
    return const [];
  }
  final lines = markdown.replaceAll('\r\n', '\n').split('\n');
  return _BlockParser(lines, assetIds).parse();
}

class _BlockParser {
  final List<String> lines;
  final Set<String> assetIds;
  int _index = 0;

  _BlockParser(this.lines, this.assetIds);

  List<MdSpan> _inline(String text) => parseInline(text, assetIds: assetIds);

  List<MdBlock> parse() {
    final blocks = <MdBlock>[];
    while (_index < lines.length) {
      final line = lines[_index];
      if (line.trim().isEmpty) {
        _index++;
        continue;
      }

      if (_fence.hasMatch(line)) {
        blocks.add(_codeBlock());
        continue;
      }

      final heading = _heading.firstMatch(line.trim());
      if (heading != null && line.startsWith(RegExp(r'\s{0,3}#'))) {
        blocks.add(MdHeading(heading.group(1)!.length, _inline(heading.group(2)!)));
        _index++;
        continue;
      }

      if (_rule.hasMatch(line)) {
        blocks.add(const MdRule());
        _index++;
        continue;
      }

      if (_quote.hasMatch(line)) {
        blocks.add(_quoteBlock());
        continue;
      }

      if (_bullet.hasMatch(line) || _ordered.hasMatch(line)) {
        blocks.add(_list(_indentOf(line)));
        continue;
      }

      if (line.contains('|') && _index + 1 < lines.length && _tableSeparator.hasMatch(lines[_index + 1])) {
        blocks.add(_table());
        continue;
      }

      blocks.add(_paragraph());
    }
    return blocks;
  }

  static int _indentOf(String line) => line.length - line.trimLeft().length;

  MdCodeBlock _codeBlock() {
    final fence = _fence.firstMatch(lines[_index])!.group(1)!;
    _index++;
    final code = <String>[];
    while (_index < lines.length && !lines[_index].trimLeft().startsWith(fence)) {
      code.add(lines[_index]);
      _index++;
    }
    // the closing fence
    _index++;
    return MdCodeBlock(code.join('\n'));
  }

  MdQuote _quoteBlock() {
    final inner = <String>[];
    while (_index < lines.length) {
      final match = _quote.firstMatch(lines[_index]);
      if (match == null) {
        break;
      }
      inner.add(match.group(1)!);
      _index++;
    }
    return MdQuote(_BlockParser(inner, assetIds).parse());
  }

  bool _startsBlock(String line) =>
      _fence.hasMatch(line) ||
      _rule.hasMatch(line) ||
      _quote.hasMatch(line) ||
      _bullet.hasMatch(line) ||
      _ordered.hasMatch(line) ||
      (line.trimLeft().startsWith('#') && _heading.hasMatch(line.trim()));

  MdParagraph _paragraph() {
    final text = <String>[];
    while (_index < lines.length) {
      final line = lines[_index];
      if (line.trim().isEmpty || (text.isNotEmpty && _startsBlock(line))) {
        break;
      }
      if (text.isNotEmpty && line.contains('|') && _index + 1 < lines.length) {
        if (_tableSeparator.hasMatch(lines[_index + 1])) {
          break;
        }
      }
      text.add(line.trim());
      _index++;
    }
    // breaks: a line break of the text is a line break of the paragraph, like the web renders it
    return MdParagraph(_inline(text.join('\n')));
  }

  MdList _list(int indent) {
    final first = lines[_index];
    final ordered = !_bullet.hasMatch(first) && _ordered.hasMatch(first);
    final start = ordered ? int.parse(_ordered.firstMatch(first)!.group(2)!) : 1;
    final items = <List<MdBlock>>[];

    while (_index < lines.length) {
      final line = lines[_index];
      if (line.trim().isEmpty) {
        // a blank line ends the list unless the list goes on after it
        final next = _index + 1 < lines.length ? lines[_index + 1] : '';
        if ((_bullet.hasMatch(next) || _ordered.hasMatch(next)) && _indentOf(next) >= indent) {
          _index++;
          continue;
        }
        break;
      }

      final lineIndent = _indentOf(line);
      final bullet = _bullet.firstMatch(line);
      final number = _ordered.firstMatch(line);
      final isItem = bullet != null || number != null;

      if (isItem && lineIndent < indent) {
        break;
      }
      if (isItem && lineIndent > indent + 1) {
        // a nested list belongs to the item before it
        if (items.isEmpty) {
          items.add([]);
        }
        items.last.add(_list(lineIndent));
        continue;
      }
      if (isItem) {
        if (ordered != (bullet == null)) {
          // a list of the other kind starts
          break;
        }
        final text = bullet != null ? bullet.group(2)! : number!.group(3)!;
        items.add([MdParagraph(_inline(text))]);
        _index++;
        continue;
      }
      if (_startsBlock(line) && lineIndent <= indent) {
        break;
      }

      // a continuation line of the item
      if (items.isEmpty) {
        break;
      }
      final last = items.last;
      final paragraph = last.isNotEmpty && last.last is MdParagraph ? last.removeLast() as MdParagraph : null;
      final previous = paragraph?.spans ?? const <MdSpan>[];
      last.add(MdParagraph([...previous, const MdSpan('\n'), ..._inline(line.trim())]));
      _index++;
    }

    return MdList(ordered: ordered, start: start, items: items);
  }

  List<String> _cells(String line) {
    var row = line.trim();
    if (row.startsWith('|')) {
      row = row.substring(1);
    }
    if (row.endsWith('|') && !row.endsWith(r'\|')) {
      row = row.substring(0, row.length - 1);
    }
    return row.split(RegExp(r'(?<!\\)\|')).map((cell) => cell.trim().replaceAll(r'\|', '|')).toList();
  }

  MdTable _table() {
    final header = _cells(lines[_index]).map(_inline).toList();
    _index += 2;
    final rows = <List<List<MdSpan>>>[];
    while (_index < lines.length && lines[_index].contains('|') && lines[_index].trim().isNotEmpty) {
      final cells = _cells(lines[_index]).map(_inline).toList();
      // every row has the columns of the header
      while (cells.length < header.length) {
        cells.add(const []);
      }
      rows.add(cells.take(header.length).toList());
      _index++;
    }
    return MdTable(header, rows);
  }
}

/// Parses the inline markdown of [text]: emphasis, code, strike-through and links; ids of [assetIds] (lower case)
/// become photo chips, except in links and code blocks
List<MdSpan> parseInline(String text, {Set<String> assetIds = const {}}) {
  final spans = _InlineParser(text).parse();
  if (assetIds.isEmpty) {
    return _merge(spans);
  }
  return _merge([for (final span in spans) ..._chips(span, assetIds)]);
}

List<MdSpan> _chips(MdSpan span, Set<String> assetIds) {
  if (span.href != null || span.assetId != null) {
    return [span];
  }
  if (span.code) {
    final id = span.text.trim().toLowerCase();
    return _uuidOnly.hasMatch(id) && assetIds.contains(id) ? [MdSpan(id, assetId: id)] : [span];
  }

  final result = <MdSpan>[];
  var last = 0;
  for (final match in _uuid.allMatches(span.text)) {
    final id = match.group(0)!.toLowerCase();
    if (!assetIds.contains(id)) {
      continue;
    }
    if (match.start > last) {
      result.add(
        MdSpan(span.text.substring(last, match.start), bold: span.bold, italic: span.italic, strike: span.strike),
      );
    }
    result.add(MdSpan(id, assetId: id));
    last = match.end;
  }
  if (result.isEmpty) {
    return [span];
  }
  if (last < span.text.length) {
    result.add(MdSpan(span.text.substring(last), bold: span.bold, italic: span.italic, strike: span.strike));
  }
  return result;
}

/// Joins neighbouring spans of the same style
List<MdSpan> _merge(List<MdSpan> spans) {
  final result = <MdSpan>[];
  for (final span in spans) {
    if (span.text.isEmpty) {
      continue;
    }
    final previous = result.isEmpty ? null : result.last;
    if (previous != null &&
        previous.assetId == null &&
        span.assetId == null &&
        previous.bold == span.bold &&
        previous.italic == span.italic &&
        previous.strike == span.strike &&
        previous.code == span.code &&
        previous.href == span.href) {
      result[result.length - 1] = MdSpan(
        previous.text + span.text,
        bold: span.bold,
        italic: span.italic,
        strike: span.strike,
        code: span.code,
        href: span.href,
      );
    } else {
      result.add(span);
    }
  }
  return result;
}

final _wordChar = RegExp(r'[\p{L}\p{N}]', unicode: true);

bool _isWordChar(String? char) => char != null && _wordChar.hasMatch(char);

/// The link target when it may be followed, or null
String? safeMarkdownUrl(String url) {
  final trimmed = url.trim();
  return _safeUrl.hasMatch(trimmed) ? trimmed : null;
}

class _InlineParser {
  final String text;
  int _index = 0;
  final _buffer = StringBuffer();
  final _spans = <MdSpan>[];

  _InlineParser(this.text);

  String? _at(int index) => index >= 0 && index < text.length ? text[index] : null;

  void _flush() {
    if (_buffer.isNotEmpty) {
      _spans.add(MdSpan(_buffer.toString()));
      _buffer.clear();
    }
  }

  void _addAll(List<MdSpan> spans) {
    _flush();
    _spans.addAll(spans);
  }

  List<MdSpan> parse() {
    while (_index < text.length) {
      final char = text[_index];

      if (char == r'\' && _index + 1 < text.length && r'\`*_{}[]()#+-.!|~<>'.contains(text[_index + 1])) {
        _buffer.write(text[_index + 1]);
        _index += 2;
        continue;
      }

      if (char == '`' && _code()) {
        continue;
      }

      if ((text.startsWith('**', _index) || text.startsWith('__', _index)) &&
          _emphasis(text.substring(_index, _index + 2))) {
        continue;
      }

      if (text.startsWith('~~', _index) && _emphasis('~~')) {
        continue;
      }

      if ((char == '*' || char == '_') && _emphasis(char)) {
        continue;
      }

      if (char == '[' && _link()) {
        continue;
      }

      if (char == '<' && _autolink()) {
        continue;
      }

      if ((text.startsWith('http://', _index) || text.startsWith('https://', _index)) &&
          !_isWordChar(_at(_index - 1)) &&
          _bareUrl()) {
        continue;
      }

      _buffer.write(char);
      _index++;
    }
    _flush();
    return _spans;
  }

  bool _code() {
    var ticks = 0;
    while (_at(_index + ticks) == '`') {
      ticks++;
    }
    final fence = '`' * ticks;
    final end = text.indexOf(fence, _index + ticks);
    if (end == -1) {
      return false;
    }
    var code = text.substring(_index + ticks, end);
    if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) {
      code = code.substring(1, code.length - 1);
    }
    _addAll([MdSpan(code, code: true)]);
    _index = end + ticks;
    return true;
  }

  bool _emphasis(String delimiter) {
    final start = _index + delimiter.length;
    final next = _at(start);
    if (next == null || next.trim().isEmpty) {
      return false;
    }
    // an underscore inside a word (snake_case) is not emphasis
    if (delimiter.startsWith('_') && _isWordChar(_at(_index - 1))) {
      return false;
    }

    var search = start;
    while (true) {
      var end = text.indexOf(delimiter, search);
      if (end == -1 || end == start) {
        return false;
      }
      // in a run like "***" a double delimiter closes with the last two: "**bold *both***"
      while (delimiter.length == 2 && _at(end + 2) == delimiter[0]) {
        end++;
      }
      final before = _at(end - 1);
      final after = _at(end + delimiter.length);
      final closes =
          before != null &&
          before.trim().isNotEmpty &&
          // a single delimiter must not be half of a double one
          (delimiter.length == 2 || (after != delimiter && before != delimiter)) &&
          (!delimiter.startsWith('_') || !_isWordChar(after));
      if (!closes) {
        search = end + 1;
        continue;
      }

      final inner = _InlineParser(text.substring(start, end)).parse();
      _addAll([
        for (final span in inner)
          span._with(
            bold: delimiter.length == 2 && delimiter != '~~',
            italic: delimiter.length == 1,
            strike: delimiter == '~~',
          ),
      ]);
      _index = end + delimiter.length;
      return true;
    }
  }

  bool _link() {
    // the matching closing bracket, allowing nested brackets in the text
    var depth = 0;
    var close = -1;
    for (var i = _index; i < text.length; i++) {
      if (text[i] == r'\') {
        i++;
        continue;
      }
      if (text[i] == '[') {
        depth++;
      } else if (text[i] == ']') {
        depth--;
        if (depth == 0) {
          close = i;
          break;
        }
      }
    }
    if (close == -1 || _at(close + 1) != '(') {
      return false;
    }
    final end = text.indexOf(')', close + 2);
    if (end == -1) {
      return false;
    }
    final target = text.substring(close + 2, end).trim().split(RegExp(r'\s+')).first;
    final label = _InlineParser(text.substring(_index + 1, close)).parse();
    final href = safeMarkdownUrl(target.replaceAll(RegExp(r'^<|>$'), ''));
    _addAll([for (final span in label) href == null ? span : span._with(href: href)]);
    _index = end + 1;
    return true;
  }

  bool _autolink() {
    final end = text.indexOf('>', _index);
    if (end == -1) {
      return false;
    }
    final url = text.substring(_index + 1, end);
    if (!RegExp(r'^(https?://|mailto:)\S+$', caseSensitive: false).hasMatch(url)) {
      return false;
    }
    _addAll([MdSpan(url, href: url)]);
    _index = end + 1;
    return true;
  }

  bool _bareUrl() {
    var end = _index;
    while (end < text.length && text[end].trim().isNotEmpty && text[end] != '<') {
      end++;
    }
    // trailing punctuation ends the sentence, not the URL
    while (end > _index && '.,;:!?)\'"'.contains(text[end - 1])) {
      end--;
    }
    final url = text.substring(_index, end);
    if (url.length <= 'https://'.length) {
      return false;
    }
    _addAll([MdSpan(url, href: url)]);
    _index = end;
    return true;
  }
}

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/utils/markdown.dart';

const _photo = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const _other = 'ffffffff-3f40-4a5b-8c6d-7e8f9a0b1c2d';

void main() {
  group('inline markdown', () {
    test('plain text stays one span', () {
      expect(parseInline('Found 12 photos'), [const MdSpan('Found 12 photos')]);
    });

    test('bold, italic, strike-through and code', () {
      expect(parseInline('a **bold** b *it* c ~~gone~~ d `code`'), [
        const MdSpan('a '),
        const MdSpan('bold', bold: true),
        const MdSpan(' b '),
        const MdSpan('it', italic: true),
        const MdSpan(' c '),
        const MdSpan('gone', strike: true),
        const MdSpan(' d '),
        const MdSpan('code', code: true),
      ]);
    });

    test('nested emphasis keeps both styles', () {
      expect(parseInline('**bold *both***'), [
        const MdSpan('bold ', bold: true),
        const MdSpan('both', bold: true, italic: true),
      ]);
    });

    test('underscores inside words are not emphasis', () {
      expect(parseInline('call create_album_from_photos now'), [const MdSpan('call create_album_from_photos now')]);
      expect(parseInline('an _italic_ word'), [
        const MdSpan('an '),
        const MdSpan('italic', italic: true),
        const MdSpan(' word'),
      ]);
    });

    test('an unclosed delimiter is text', () {
      expect(parseInline('5 * 3 = 15 and **open'), [const MdSpan('5 * 3 = 15 and **open')]);
    });

    test('links keep their label styles', () {
      expect(parseInline('see [the **album**](https://example.com/a)'), [
        const MdSpan('see '),
        const MdSpan('the ', href: 'https://example.com/a'),
        const MdSpan('album', bold: true, href: 'https://example.com/a'),
      ]);
    });

    test('links of the server and mail are followed, other schemes are not', () {
      expect(parseInline('[album](/albums/1)').single.href, '/albums/1');
      expect(parseInline('[mail](mailto:a@b.c)').single.href, 'mailto:a@b.c');
      expect(parseInline('[bad](javascript:alert(1))').first.href, isNull);
      expect(parseInline('[bad](//evil.example)').first.href, isNull);
    });

    test('bare and angle-bracket URLs become links without their trailing punctuation', () {
      expect(parseInline('Open https://example.com/x. Done'), [
        const MdSpan('Open '),
        const MdSpan('https://example.com/x', href: 'https://example.com/x'),
        const MdSpan('. Done'),
      ]);
      expect(parseInline('<https://example.com>'), [const MdSpan('https://example.com', href: 'https://example.com')]);
    });

    test('escaped characters are literal', () {
      expect(parseInline(r'\*not italic\*'), [const MdSpan('*not italic*')]);
    });

    test('ids of the chat photos become chips, other ids stay text', () {
      expect(parseInline('Best: $_photo and $_other', assetIds: {_photo}), [
        const MdSpan('Best: '),
        const MdSpan(_photo, assetId: _photo),
        const MdSpan(' and $_other'),
      ]);
    });

    test('an id in inline code becomes a chip; ids in links stay', () {
      expect(parseInline('`${_photo.toUpperCase()}`', assetIds: {_photo}), [const MdSpan(_photo, assetId: _photo)]);
      expect(parseInline('[$_photo](/photos/$_photo)', assetIds: {_photo}), [
        const MdSpan(_photo, href: '/photos/$_photo'),
      ]);
    });
  });

  group('block markdown', () {
    test('nothing to render', () {
      expect(parseMarkdown(null), isEmpty);
      expect(parseMarkdown('  \n '), isEmpty);
    });

    test('paragraphs keep their line breaks', () {
      final blocks = parseMarkdown('First line\nsecond line\n\nNew paragraph');
      expect(blocks, hasLength(2));
      expect((blocks[0] as MdParagraph).spans, [const MdSpan('First line\nsecond line')]);
      expect((blocks[1] as MdParagraph).spans, [const MdSpan('New paragraph')]);
    });

    test('headings, rules and quotes', () {
      final blocks = parseMarkdown('## Your trip\n---\n> quoted **text**');
      expect(blocks[0], isA<MdHeading>().having((heading) => heading.level, 'level', 2));
      expect((blocks[0] as MdHeading).spans, [const MdSpan('Your trip')]);
      expect(blocks[1], isA<MdRule>());
      final quote = blocks[2] as MdQuote;
      expect((quote.blocks.single as MdParagraph).spans, [const MdSpan('quoted '), const MdSpan('text', bold: true)]);
    });

    test('a fenced code block keeps its text verbatim', () {
      final blocks = parseMarkdown('```json\n{"a": **1**}\n```\nafter');
      expect((blocks[0] as MdCodeBlock).code, '{"a": **1**}');
      expect((blocks[1] as MdParagraph).spans, [const MdSpan('after')]);
    });

    test('bullet and numbered lists, with nesting', () {
      final blocks = parseMarkdown('Steps:\n1. Pick photos\n2. Crop them\n   - square\n   - keep faces\n3. Done');
      expect(blocks[0], isA<MdParagraph>());
      final list = blocks[1] as MdList;
      expect(list.ordered, isTrue);
      expect(list.items, hasLength(3));
      expect((list.items[1][0] as MdParagraph).spans, [const MdSpan('Crop them')]);
      final nested = list.items[1][1] as MdList;
      expect(nested.ordered, isFalse);
      expect(nested.items.map((item) => (item.single as MdParagraph).spans.single.text), ['square', 'keep faces']);
    });

    test('a numbered list keeps its first number', () {
      final list = parseMarkdown('3. third\n4. fourth').single as MdList;
      expect(list.start, 3);
    });

    test('a table', () {
      final table = parseMarkdown('| Date | Place |\n|---|:---:|\n| 2024 | Rome |\n| 2025 |').single as MdTable;
      expect(table.header.map((cell) => cell.single.text), ['Date', 'Place']);
      expect(table.rows, hasLength(2));
      expect(table.rows[0].map((cell) => cell.single.text), ['2024', 'Rome']);
      expect(table.rows[1][1], isEmpty);
    });

    test('ids of the chat photos become chips inside blocks too', () {
      final list = parseMarkdown('- $_photo', assetIds: {_photo}).single as MdList;
      expect((list.items.single.single as MdParagraph).spans, [const MdSpan(_photo, assetId: _photo)]);
    });
  });
}

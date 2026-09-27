import { bookStylePresets } from 'src/dtos/book.dto.js';
import { planPage, wrapText } from 'src/utils/book/render.js';
import { getSetlistBlocks, parseSetlistText } from 'src/utils/book/setlist-page.js';

const options = {
  fontPx: 30,
  ink: '#f3ede2',
  accent: '#ff3d7a',
  pxPerMm: 10,
  wrap: wrapText,
  lineHeight: 1.25,
  capsCharWidth: 0.6,
  charWidth: 0.52,
};

const songs = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1}. Song number ${index + 1}`);

describe('setlist pages', () => {
  it('should read the header, the songs, the starts of a line-up and the other lines of a caption', () => {
    expect(
      parseSetlistText('Setlist\nMarch 7 · Seattle\n\n1. Ohio\n2) Had Ten Dollaz\nInterlude\n\nSaturday:\n20:30 Phoro'),
    ).toEqual({
      lines: ['Setlist', 'March 7 · Seattle'],
      items: [
        { kind: 'numbered', label: '1', text: 'Ohio' },
        { kind: 'numbered', label: '2', text: 'Had Ten Dollaz' },
        { kind: 'marker', text: 'Interlude' },
        { kind: 'heading', text: 'Saturday' },
        { kind: 'numbered', label: '20:30', text: 'Phoro' },
      ],
    });
    expect(parseSetlistText('1. Ohio\n2. Told You').lines).toEqual([]);
  });

  it('should set the songs in bold capitals with their numbers in the accent, under a thick rule', () => {
    const rect = { left: 100, top: 100, width: 1000, height: 1500 };
    const { blocks, decorations } = getSetlistBlocks(`Setlist\nMarch 7\n\n${songs(5).join('\n')}`, rect, options);
    expect(blocks.map(({ text }) => text)).toEqual([
      'Setlist',
      'March 7',
      ...songs(5).flatMap((song, index) => [String(index + 1), song.replace(/^\d+\. /, '').toUpperCase()]),
    ]);
    expect(blocks.find(({ text }) => text === '1')).toEqual(expect.objectContaining({ color: '#ff3d7a', bold: true }));
    expect(blocks.find(({ text }) => text === 'SONG NUMBER 1')).toEqual(
      expect.objectContaining({ color: '#f3ede2', bold: true }),
    );
    expect(decorations).toEqual([expect.objectContaining({ kind: 'line', color: '#ff3d7a' })]);
    for (const block of blocks) {
      expect(block.rect.top + block.rect.height).toBeLessThanOrEqual(rect.top + rect.height + 1);
    }
  });

  it('should set a long setlist in two columns, and leave out what does not fit at the smallest size', () => {
    const rect = { left: 0, top: 0, width: 1000, height: 900 };
    const two = getSetlistBlocks(songs(40).join('\n'), rect, options);
    const lefts = new Set(
      two.blocks.filter(({ bold, align }) => bold && align === 'left').map(({ rect }) => rect.left),
    );
    expect(lefts.size).toBe(2);
    expect(two.blocks.filter(({ align }) => align === 'right')).toHaveLength(40);

    const cut = getSetlistBlocks(songs(200).join('\n'), { ...rect, height: 300 }, options);
    expect(cut.blocks.filter(({ align }) => align === 'right').length).toBeLessThan(200);
  });

  it('should typeset the caption of a setlist page beside the photo of the sheet', () => {
    const plan = planPage(
      {
        pageWidthMm: 240,
        pageHeightMm: 240,
        title: 'Nights Out',
        subtitle: null,
        style: bookStylePresets.concerts.style,
        coverAssetId: null,
      },
      {
        layout: 'setlist',
        sectionTitle: 'Cherry Glazerr · Neumos, 7 Mar 2019',
        caption: 'Setlist\nMarch 7 · Seattle\n\n1. Ohio\n2. Told You',
        background: null,
        assets: [{ slot: 0, assetId: 'sheet', crop: null, caption: null }],
      },
      { dpi: 100, mode: 'review', sources: new Map([['sheet', { input: 'sheet.jpg', width: 2400, height: 3000 }]]) },
    );
    const texts = plan.text.map(({ text }) => text);
    expect(texts).toEqual(expect.arrayContaining(['Cherry Glazerr', 'Setlist', 'OHIO', 'TOLD YOU']));
    expect(plan.slots[0].rect.left).toBeGreaterThan(plan.text.find(({ text }) => text === 'OHIO')!.rect.left);
  });
});

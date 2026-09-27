import { bookStylePresets } from 'src/dtos/book.dto.js';
import { getNoteHeading, isPrintedTheme } from 'src/utils/book/collections.js';
import { TASTING_NOTE_LAYOUT } from 'src/utils/book/layouts.js';
import { planPage } from 'src/utils/book/render.js';
import { parseTastingNote } from 'src/utils/book/tasting-note.js';
import { getBookCaption } from 'src/utils/collections/packs/reading/book.js';

describe('reading journal', () => {
  const caption = getBookCaption('Wanderungen in den Dolomiten — Paul Grohmann', {
    layout: TASTING_NOTE_LAYOUT,
    takenAt: new Date('2022-07-09T15:08:06Z').getTime(),
    description: 'The first ascents of the 1860s.',
  });

  it('should read the page of a book as a fiche: the author, the title, when it was read, the note', () => {
    expect(parseTastingNote(caption)).toEqual({
      producer: 'Paul Grohmann',
      wine: 'Wanderungen in den Dolomiten',
      rows: [{ label: 'Read', value: '9 July 2022' }],
      note: 'The first ascents of the 1860s.',
    });
  });

  it('should set a journal page in the printed look, with the note headed "Notes"', () => {
    expect(isPrintedTheme('reading')).toBe(true);
    expect(getNoteHeading('reading')).toBe('Notes');
    expect(getNoteHeading('wine')).toBeUndefined();

    const plan = planPage(
      {
        pageWidthMm: 210,
        pageHeightMm: 210,
        title: 'Books read',
        subtitle: null,
        style: bookStylePresets.reading.style,
        coverAssetId: null,
      },
      {
        layout: TASTING_NOTE_LAYOUT,
        sectionTitle: null,
        caption: null,
        background: null,
        assets: [{ slot: 0, assetId: 'book', crop: null, caption }],
      },
      { dpi: 72, mode: 'review', sources: new Map([['book', { input: 'book.jpg', width: 1000, height: 1500 }]]) },
    );
    const texts = plan.text.map(({ text }) => text);
    expect(texts).toEqual(
      expect.arrayContaining(['Paul Grohmann', 'Wanderungen in den Dolomiten', 'Read', '9 July 2022', 'Notes']),
    );
    expect(texts).not.toContain('Tasting note');
  });
});

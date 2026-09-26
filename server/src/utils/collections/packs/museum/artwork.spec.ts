import {
  captionArtwork,
  describeArtwork,
  formatArtwork,
  getArtworkPrompt,
  isDate,
  isMedium,
  parseArtwork,
} from 'src/utils/collections/packs/museum/artwork.js';

describe('museum artworks', () => {
  it('should write an artwork as a line of a catalogue, leaving out what is unknown', () => {
    expect(
      formatArtwork({ title: 'Virgin and Child', artist: 'Nicolau Chanterene', date: '1535-1540', medium: 'Marble' }),
    ).toBe('Virgin and Child — Nicolau Chanterene, 1535-1540, marble');
    expect(formatArtwork({ title: 'Yakshi', date: 'c. 2nd century B.C.E.', medium: 'Red Sandstone' })).toBe(
      'Yakshi — c. 2nd century B.C.E., red Sandstone',
    );
    expect(formatArtwork({ title: 'Bust of a woman' })).toBe('Bust of a woman');
    // a tag can't hold a slash
    expect(formatArtwork({ title: 'Lintel', medium: 'Stone / basalt' })).toBe('Lintel — stone - basalt');
  });

  it('should read the parts of a name back', () => {
    expect(parseArtwork('Virgin and Child — Nicolau Chanterene, 1535-1540, marble')).toEqual({
      title: 'Virgin and Child',
      artist: 'Nicolau Chanterene',
      date: '1535-1540',
      medium: 'marble',
    });
    expect(
      parseArtwork('Agnus Dei — Josefa de Ayalla e Cabrera, called Josefa de Óbidos, c. 1660-70, oil on canvas'),
    ).toEqual({
      title: 'Agnus Dei',
      artist: 'Josefa de Ayalla e Cabrera, called Josefa de Óbidos',
      date: 'c. 1660-70',
      medium: 'oil on canvas',
    });
    expect(parseArtwork('Ephebos — Roman Period, bronze')).toEqual({
      title: 'Ephebos',
      date: 'Roman Period',
      medium: 'bronze',
    });
    expect(parseArtwork('Dédale — Jean Lemaire, dit Lemaire-Poussin, huile sur toile')).toEqual({
      title: 'Dédale',
      artist: 'Jean Lemaire, dit Lemaire-Poussin',
      medium: 'huile sur toile',
    });
    expect(
      parseArtwork('Guéridon — Ateliers Jacob Frères, 1815-1824, palissandre plaqué, marbre, bronze doré'),
    ).toMatchObject({
      artist: 'Ateliers Jacob Frères',
      medium: 'palissandre plaqué, marbre, bronze doré',
    });
    expect(parseArtwork('The Kiss — Gustav Klimt')).toEqual({ title: 'The Kiss', artist: 'Gustav Klimt' });
    expect(parseArtwork('Bust of a woman')).toEqual({ title: 'Bust of a woman' });
  });

  it('should tell dates and media apart', () => {
    for (const date of [
      '1544',
      'c. 1500',
      'circa 1760',
      'Vers 1840',
      '1508-12',
      '14th century',
      'Ca. 10th century C.E.',
      'XVe siècle',
      'séc. XVI',
      'Roman Period',
      'Periodo Romano',
      '1st quarter of 16th century',
    ]) {
      expect(isDate(date), date).toBe(true);
    }
    for (const text of ['Nicolau Chanterene', 'Agnus Dei', 'oil on panel']) {
      expect(isDate(text), text).toBe(false);
    }
    for (const medium of [
      'Oil on panel',
      'Huile sur toile',
      'Óleo sobre madeira',
      'Tempera and gold on panel',
      'Basalt',
      'Khondalite',
      'Porcelaine tendre',
      'Alabaster and marble',
      'Huile sur toile, 271 x 306 cm',
    ]) {
      expect(isMedium(medium), medium).toBe(true);
    }
    for (const text of ['Agnus Dei', 'The Judgement of Daniel or The Innocence of Susanna', 'Lion Capital']) {
      expect(isMedium(text), text).toBe(false);
    }
  });

  it('should describe and caption an artwork as a museum does', () => {
    const entry = 'Virgin and Child — Nicolau Chanterene, 1535-1540, marble';
    expect(describeArtwork(entry, 'Museu de Évora')).toBe(
      'Virgin and Child · Nicolau Chanterene, 1535-1540 · Museu de Évora',
    );
    expect(describeArtwork('Bust of a woman', 'Museu de Évora')).toBe('Bust of a woman · Museu de Évora');
    expect(captionArtwork(entry)).toBe('Virgin and Child\nNicolau Chanterene, 1535-1540, marble');
    expect(captionArtwork('Yakshi — c. 2nd century B.C.E., red sandstone')).toBe(
      'Yakshi\nc. 2nd century B.C.E., red sandstone',
    );
    expect(captionArtwork('Makara — basalt')).toBe('Makara\nBasalt');
    expect(captionArtwork('Bust of a woman')).toBe('Bust of a woman');
  });

  it('should describe an artwork to CLIP by its title and the kind of object its medium makes', () => {
    expect(getArtworkPrompt({ name: 'Calvary — Gregório Lopes, 1544, oil on panel' })).toBe(
      'a photo of a painting, Calvary (oil on panel)',
    );
    expect(getArtworkPrompt({ name: 'Yakshi — c. 2nd century B.C.E., red sandstone' })).toBe(
      'a photo of a sculpture, Yakshi (red sandstone)',
    );
    expect(getArtworkPrompt({ name: 'Assiette — Manufacture de Sèvres, 1772, porcelaine tendre' })).toBe(
      'a photo of a decorative art object, Assiette (porcelaine tendre)',
    );
    expect(getArtworkPrompt({ name: 'Bust of a woman' })).toBe('a photo of an artwork, Bust of a woman');
  });
});

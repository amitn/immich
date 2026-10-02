import {
  formatTaxon,
  isOriginText,
  parsePlantLabel,
  parseTaxon,
  readPlantLabel,
} from 'src/utils/collections/packs/nature/label.js';

const box = (text: string, left: number, top: number, height = 0.04) => {
  const right = Math.min(1, left + text.length * height * 0.5);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.97 };
};

/** lines one below the other, each as large as given */
const lines = (texts: Array<string | [string, number]>, { left = 0.2, top = 0.2, gap = 0.02 } = {}) => {
  let y = top;
  return texts.map((line) => {
    const [text, height] = typeof line === 'string' ? [line, 0.04] : line;
    const result = box(text, left, y, height);
    y += height + gap;
    return result;
  });
};

describe('plant labels', () => {
  it('should read the accession tag of a botanical garden: the names, the family, where it comes from', () => {
    const ocr = [
      box('810620 002', 0.28, 0.3),
      box('Castanospermum australe', 0.28, 0.38),
      box('Fabaceae', 0.75, 0.38),
      ...lines(
        ['Moreton Bay Chestnut. Australia Chestnut', 'Australia, North Queensland', 'Plowman, Timothy', 'Wild'],
        { left: 0.28, top: 0.45 },
      ),
    ];
    expect(readPlantLabel(ocr)).toEqual({
      scientific: 'Castanospermum australe',
      family: 'Fabaceae',
      common: 'Moreton Bay Chestnut',
      details: ['Australia, North Queensland', 'Wild'],
    });
    expect(parsePlantLabel(ocr).items).toEqual([
      expect.objectContaining({
        name: 'Moreton Bay Chestnut (Castanospermum australe, Fabaceae)',
        description: 'Australia, North Queensland · Wild',
      }),
    ]);
  });

  it('should read the code of the garden on a tag, and a family OCR misspelled', () => {
    const ocr = lines(['780373 002 Kahanu Map # 404', 'Hernandia moerenhoutiana', 'Hermandiaceae', 'Wild']);
    const parsed = parsePlantLabel(ocr);
    expect(parsed.title).toBe('Kahanu');
    expect(parsed.items[0].name).toBe('Hernandia moerenhoutiana (Hermandiaceae)');
  });

  it('should read the common name of a plaque above its scientific name', () => {
    const ocr = lines([['Red Panda', 0.07], 'Ailurus fulgens', 'Ailuridae', 'Himalaya, China']);
    expect(readPlantLabel(ocr)).toEqual(
      expect.objectContaining({ common: 'Red Panda', scientific: 'Ailurus fulgens', family: 'Ailuridae' }),
    );
  });

  it('should read a chalk label of a rose: its cultivar, and its kind, colour and scent', () => {
    const ocr = lines([["'SCENTIMENTAL", 0.15], 'FLORISUNDA', 'RED & WHITE', 'STRIPES', 'H.SCENTED']);
    expect(readPlantLabel(ocr)).toEqual({
      common: "Rose 'Scentimental'",
      scientific: 'Rosa',
      cultivar: 'Scentimental',
      details: ['floribunda', 'red & white', 'stripes', 'h.scented'],
    });
    expect(parsePlantLabel(ocr).items[0].name).toBe("Rose 'Scentimental' (Rosa)");
  });

  it('should keep a cultivar name on two lines, with the words OCR ran together, and stop at smaller print', () => {
    expect(readPlantLabel(lines([['PRIDEAND', 0.1], ['PRETUDICE', 0.11], 'INTRODUCED 2013', 'FLORIBUNDA']))).toEqual(
      expect.objectContaining({ cultivar: 'Pride and Pretudice', common: "Rose 'Pride and Pretudice'" }),
    );
    expect(readPlantLabel(lines([['PROPER', 0.16], ['RID TEA', 0.1], 'RED', 'FRAGRANT']))).toEqual(
      expect.objectContaining({ cultivar: 'Proper', details: ['hybrid tea', 'red', 'fragrant'] }),
    );
  });

  it('should name a rose of a kind without a cultivar by its kind', () => {
    expect(readPlantLabel(lines(['CROUND COVER', 'ROSE. WHITE, YELLOW', 'APRICOT']))).toEqual(
      expect.objectContaining({ common: 'Ground cover rose', scientific: 'Rosa' }),
    );
    expect(readPlantLabel(lines(['EN']))).toBeUndefined();
  });

  it('should tell where a species comes from', () => {
    expect(isOriginText('Old World Tropics')).toBe(true);
    expect(isOriginText('Solomon Islands to Society Islands')).toBe(true);
    expect(isOriginText('Philippines')).toBe(true);
    expect(isOriginText('Moreton Bay Chestnut')).toBe(false);
  });

  it('should write and read back the names of a species', () => {
    const chestnut = { common: 'Moreton Bay Chestnut', scientific: 'Castanospermum australe', family: 'Fabaceae' };
    expect(formatTaxon(chestnut)).toBe('Moreton Bay Chestnut (Castanospermum australe, Fabaceae)');
    expect(parseTaxon(formatTaxon(chestnut))).toEqual(chestnut);
    expect(parseTaxon('Hernandia moerenhoutiana (Hernandiaceae)')).toEqual({
      scientific: 'Hernandia moerenhoutiana',
      family: 'Hernandiaceae',
    });
    expect(parseTaxon("Rose 'Proper Job' (Rosa)")).toEqual({ common: "Rose 'Proper Job'", scientific: 'Rosa' });
    expect(parseTaxon('Hildegardia barteri')).toEqual({ scientific: 'Hildegardia barteri' });
    expect(parseTaxon('White poppy')).toEqual({ common: 'White poppy' });
  });
});

import { DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import { getCollectionTagRules, validateCollectionPack } from 'src/utils/collections/pack.js';
import { captionSpecies, describeSpecies, reviewFieldGuide } from 'src/utils/collections/packs/nature/book.js';
import { cleanGardenLine } from 'src/utils/collections/packs/nature/garden.js';
import { assignSpecies, naturePack, speciesPrompt } from 'src/utils/collections/packs/nature/pack.js';
import { findPlaceNames } from 'src/utils/collections/place.js';
import { BUILT_IN_COLLECTION_PACKS } from 'src/utils/collections/registry.js';
import { mergeSourceEntries } from 'src/utils/collections/source.js';
import { getEntryTag, getSourceTag } from 'src/utils/collections/tags.js';

const box = (text: string, left: number, top: number, height = 0.05) => {
  const right = Math.min(1, left + text.length * height * 0.5);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.98 };
};

const tag = (species: string, family: string) => [
  box('770102 001 Kahanu Map # 3', 0.3, 0.2),
  box(species, 0.3, 0.3, 0.06),
  box(family, 0.3, 0.38),
  box('Wild', 0.3, 0.46),
];

const at = (minutes: number, seconds = 0) => Date.UTC(2012, 5, 6, 10, minutes, seconds);

const vector = (...values: number[]) => {
  const norm = Math.hypot(...values);
  return Float32Array.from(values, (value) => value / norm);
};

describe('nature pack', () => {
  it('should be a valid pack of its own, with a field-guide book style', () => {
    expect(validateCollectionPack(naturePack, BUILT_IN_COLLECTION_PACKS)).toEqual([]);
    expect(naturePack.book.preset).toEqual(expect.objectContaining({ id: 'nature', name: 'Field guide' }));
    expect(naturePack.book.theme).toEqual(expect.objectContaining({ id: 'field-guide', look: 'gallery' }));
  });

  it('should tag species by their names, and labels as sources', () => {
    const rules = getCollectionTagRules(naturePack);
    expect(getEntryTag(rules, 'Kahanu', 'Moreton Bay Chestnut (Castanospermum australe, Fabaceae)')).toBe(
      'Nature/Kahanu/Moreton Bay Chestnut (Castanospermum australe, Fabaceae)',
    );
    expect(getSourceTag(rules, 'Kahanu')).toBe('Nature/Kahanu/Label');
  });

  it('should caption a plate with the scientific name first, then the common name and the family', () => {
    expect(captionSpecies('Moreton Bay Chestnut (Castanospermum australe, Fabaceae)')).toBe(
      'Castanospermum australe\nMoreton Bay Chestnut · Fabaceae',
    );
    expect(captionSpecies('Hernandia moerenhoutiana (Hernandiaceae)')).toBe('Hernandia moerenhoutiana\nHernandiaceae');
    expect(captionSpecies("Rose 'Proper Job' (Rosa)")).toBe("Rosa 'Proper Job'\nRose");
    expect(captionSpecies('Ground cover rose (Rosa)')).toBe('Rosa\nGround cover rose');
    expect(captionSpecies('White poppy')).toBe('White poppy');
    expect(describeSpecies("Rose 'Proper Job' (Rosa)", 'Copped Hall')).toBe("Rose 'Proper Job' · Copped Hall");
  });

  it('should describe a species to CLIP by its names, and a rose by its kind and cultivar', () => {
    expect(speciesPrompt({ name: 'Moreton Bay Chestnut (Castanospermum australe, Fabaceae)' })).toBe(
      'a photo of Moreton Bay Chestnut, Castanospermum australe',
    );
    expect(speciesPrompt({ name: "Rose 'Scentimental' (Rosa)", description: 'floribunda · stripes' })).toBe(
      "a photo of a floribunda rose, 'Scentimental'",
    );
    expect(speciesPrompt({ name: 'Ground cover rose (Rosa)', description: 'ground cover' })).toBe('a photo of a rose');
  });

  it('should read the garden of its accession tags, and no species as a garden', () => {
    expect(cleanGardenLine('70102 001 Kahanu Map# 3')).toBe('Kahanu');
    const photos = [
      { assetId: 'a', kind: 'source' as const, ocr: tag('Horsfieldia costulata', 'Myristicaceae') },
      { assetId: 'b', kind: 'source' as const, ocr: tag('Hernandia moerenhoutiana', 'Hernandiaceae') },
    ];
    expect(findPlaceNames(photos, naturePack.place).map(({ name }) => name)).toEqual(['Kahanu']);
  });

  it('should keep a species labelled on two trees as an entry of each label', () => {
    const reading = (assetId: string) => ({
      ...naturePack.source.parse(tag('Castanospermum australe', 'Fabaceae')),
      assetId,
    });
    const merged = mergeSourceEntries([reading('one'), reading('two')], { repeats: naturePack.source.repeats });
    expect(merged.map(({ sourceId }) => sourceId)).toEqual(['one', 'two']);
    expect(mergeSourceEntries([reading('one'), reading('two')]).map(({ sourceId }) => sourceId)).toEqual(['one']);
  });

  it('should pair each plant with the label photographed next to it', () => {
    const plant = vector(1, 0.2, 0.1);
    const { matches } = assignSpecies(
      [
        { id: 'tree', time: at(26), embedding: plant },
        { id: 'seedling', time: at(48, 7), embedding: plant },
        { id: 'unseen', time: at(49), embedding: new Float32Array(0) },
      ],
      [
        { name: 'A', embedding: vector(1, 0.2, 0.1), sourceTime: at(26, 20) },
        { name: 'A', embedding: vector(1, 0.2, 0.1), sourceTime: at(47, 36) },
      ],
      { ...DEFAULT_MATCH_OPTIONS, ...naturePack.match.options, baselines: [vector(0, 1, 0)], suggestions: 2 },
    );
    expect(matches.map(({ ids, item }) => ({ ids, item }))).toEqual([
      { ids: ['tree'], item: 0 },
      { ids: ['seedling'], item: 1 },
      { ids: ['unseen'], item: undefined },
    ]);
  });

  it('should point out the plates of a field guide without a scientific name', () => {
    const issues = reviewFieldGuide({
      pages: [{ layout: 'single', assets: [{ assetId: 'poppy' }, { assetId: 'rose' }] }],
      photos: [
        {
          id: 'poppy',
          takenAt: 0,
          collection: { pack: 'nature', place: 'Copped Hall', kind: 'entry', entry: 'White poppy' },
        },
        {
          id: 'rose',
          takenAt: 0,
          collection: { pack: 'nature', place: 'Copped Hall', kind: 'entry', entry: "Rose 'Proper Job' (Rosa)" },
        },
      ],
      chapters: [],
    });
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'low', type: 'could-look-better', pages: [1], assetIds: ['poppy'] }),
    ]);
  });
});

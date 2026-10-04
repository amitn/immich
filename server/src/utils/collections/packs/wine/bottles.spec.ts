import { AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import {
  BottlePhoto,
  assignBottles,
  groupBottles,
  isOtherBottle,
  isSameLabel,
  mergeLabels,
  scoreListEntry,
} from 'src/utils/collections/packs/wine/bottles.js';
import { WineLabel } from 'src/utils/collections/packs/wine/label.js';

const MINUTE = 60_000;

const label = (value: Partial<WineLabel>): WineLabel => ({
  confidence: 0.8,
  sure: false,
  several: false,
  words: [],
  looseWords: [],
  ...value,
});

/** an embedding in a few dimensions: photos with the same `look` look alike */
const look = (...values: number[]) => {
  const norm = Math.hypot(...values);
  return Float32Array.from(values, (value) => value / norm);
};

const photo = (id: string, minutes: number, embedding: Float32Array, value?: Partial<WineLabel>): BottlePhoto => ({
  id,
  time: minutes * MINUTE,
  embedding,
  ...(value && { label: label(value) }),
});

const box = (text: string, top: number, height = 0.03, score = 0.98) => {
  const width = text.length * height * 0.45;
  const left = 0.5 - width / 2;
  return {
    x1: left,
    y1: top,
    x2: left + width,
    y2: top,
    x3: left + width,
    y3: top + height,
    x4: left,
    y4: top + height,
    text,
    textScore: score,
  };
};

const options: AssignOptions = { ...DEFAULT_MATCH_OPTIONS, order: 'none', baselines: [], suggestions: 3 };

describe('bottles', () => {
  describe('isOtherBottle and isSameLabel', () => {
    it('should tell two bottles apart by their vintages or their clear words', () => {
      expect(isOtherBottle(label({ vintage: '2008' }), label({ vintage: '2009' }))).toBe(true);
      expect(isOtherBottle(label({ words: ['selbach', 'oster'] }), label({ words: ['prum', 'graacher'] }))).toBe(true);
      expect(isOtherBottle(label({ words: ['haag'] }), label({ words: ['willi', 'haag'] }))).toBe(false);
      // a label read too poorly to say
      expect(isOtherBottle(label({}), label({ words: ['kudos'] }))).toBe(false);
      expect(isOtherBottle(undefined, label({ vintage: '2009' }))).toBe(false);
    });

    it('should see the same label in fragments read differently', () => {
      expect(isSameLabel(label({ words: ['javillier'] }), label({ words: ['javiller'] }))).toBe(true);
      expect(isSameLabel(label({ looseWords: ['snarebtee'] }), label({ looseWords: ['snaubte'] }))).toBe(true);
      expect(isSameLabel(label({ words: ['kudos'] }), label({ words: ['cairdeas'] }))).toBe(false);
    });
  });

  describe('groupBottles', () => {
    it('should put the photos of one bottle together: the label, the glass, the pour', () => {
      const bottle = look(1, 0.1, 0);
      const groups = groupBottles([
        photo('label', 0, bottle, { words: ['snarebtee'], looseWords: ['snarebtee'] }),
        photo('glasses', 1, look(1, 0.2, 0.05)),
        photo('pour', 3, look(0.95, 0.25, 0)),
      ]);
      expect(groups.map((group) => group.map(({ id }) => id))).toEqual([['label', 'glasses', 'pour']]);
    });

    it('should keep bottles apart that look alike on the same table, when their labels differ', () => {
      const table = look(1, 0.05, 0);
      const groups = groupBottles([
        photo('selbach', 0, table, { vintage: '2008', words: ['selbach', 'oster'] }),
        photo('prum', 0.5, table, { vintage: '2008', words: ['prum', 'graacher'] }),
        photo('richter', 1, table, { vintage: '1979', words: [] }),
      ]);
      expect(groups).toHaveLength(3);
    });

    it('should keep the same wine apart when it is photographed much later', () => {
      const groups = groupBottles([
        photo('first', 0, look(1, 0, 0), { words: ['kudos'] }),
        photo('later', 30, look(1, 0, 0), { words: ['kudos'] }),
      ]);
      expect(groups).toHaveLength(2);
    });

    it('should not join a photo to a bottle it only looks a little like', () => {
      const groups = groupBottles([photo('a', 0, look(1, 0, 0)), photo('b', 1, look(0, 1, 0))]);
      expect(groups).toHaveLength(2);
    });
  });

  describe('mergeLabels', () => {
    it('should take each part of the name from the reading surest of it', () => {
      const merged = mergeLabels([
        label({ producer: 'Snarebtee', confidence: 0.14, looseWords: ['snarebtee'] }),
        label({ producer: 'Kudos', vintage: '2012', confidence: 0.57, words: ['kudos'] }),
        label({ wine: 'Pinot Noir', confidence: 0.3, words: [] }),
      ]);
      expect(merged).toMatchObject({ producer: 'Kudos', vintage: '2012', wine: 'Pinot Noir', sure: false });
      expect(merged?.looseWords).toEqual(['snarebtee']);
    });
  });

  describe('scoreListEntry', () => {
    it('should score a line of the list by the words the label shares with it', () => {
      const kudos = label({ producer: 'Kudos', vintage: '2012', words: ['kudos'], looseWords: ['kudos'] });
      expect(
        scoreListEntry(kudos, { name: 'Kudos Pinot Noir 2012', description: 'Willamette Valley' }),
      ).toBeGreaterThan(0.3);
      expect(scoreListEntry(kudos, { name: 'Cloud Break Pinot Noir 2012' })).toBeLessThan(0.3);
      // another vintage of the same wine is another wine
      expect(scoreListEntry(kudos, { name: 'Kudos 2011' })).toBeLessThan(scoreListEntry(kudos, { name: 'Kudos 2012' }));
    });
  });

  describe('assignBottles', () => {
    it('should name each bottle from its label, sure only of a label read clearly', () => {
      const result = assignBottles(
        [
          {
            id: 'selbach',
            time: 0,
            embedding: look(1, 0, 0),
            ocr: [
              box('SELBACH-OSTER', 0.66, 0.03),
              box('2008', 0.72, 0.017),
              box('ZELTINGER SCHLOSSBERG', 0.75, 0.022),
              box('RIESLING SPATLESE', 0.78, 0.021),
            ],
          },
          {
            id: 'kudos',
            time: 20 * MINUTE,
            embedding: look(0, 1, 0),
            ocr: [box('KUDOS', 0.65, 0.12), box('2012', 0.83, 0.02, 0.86)],
          },
          { id: 'glass', time: 40 * MINUTE, embedding: look(0, 0, 1), ocr: [] },
        ],
        [],
        options,
      );
      expect(result.entries).toEqual([
        {
          name: 'Selbach-Oster · Zeltinger Schlossberg Riesling Spätlese · 2008',
          description: 'Riesling',
          sourceId: 'selbach',
        },
        { name: 'Kudos · 2012', sourceId: 'kudos' },
      ]);
      expect(result.matches.map(({ ids, item, unsure }) => ({ ids, item, unsure }))).toEqual([
        { ids: ['selbach'], item: 0, unsure: false },
        { ids: ['kudos'], item: 1, unsure: true },
        // nothing read and no list: the assistant names it
        { ids: ['glass'], item: undefined, unsure: true },
      ]);
    });

    it('should name one wine photographed twice once, as shared', () => {
      const kudos = [box('KUDOS', 0.65, 0.12), box('2012', 0.83, 0.02)];
      const result = assignBottles(
        [
          { id: 'first', time: 0, embedding: look(1, 0, 0), ocr: kudos },
          { id: 'second', time: 60 * MINUTE, embedding: look(1, 0, 0), ocr: kudos },
        ],
        [],
        options,
      );
      expect(result.entries).toHaveLength(1);
      expect(result.matches.map(({ item, shared }) => ({ item, shared }))).toEqual([
        { item: 0, shared: true },
        { item: 0, shared: true },
      ]);
    });

    it('should match the bottles with the lines of a wine list, and add the ones the list does not have', () => {
      const entries = [
        { name: 'Selbach-Oster Zeltinger Schlossberg Riesling Spätlese 2008' },
        { name: 'Joh. Jos. Prüm Graacher Himmelreich Kabinett 2008' },
      ];
      const result = assignBottles(
        [
          {
            id: 'prum',
            time: 0,
            embedding: look(1, 0, 0),
            ocr: [box('Joh.Jos. Prüm', 0.8, 0.036), box('2008', 0.84, 0.02), box('Graacher Himmelreich', 0.86, 0.023)],
          },
          { id: 'kudos', time: 20 * MINUTE, embedding: look(0, 1, 0), ocr: [box('KUDOS', 0.65, 0.12)] },
        ],
        entries,
        options,
      );
      expect(result.matches[0]).toMatchObject({ ids: ['prum'], item: 1 });
      expect(result.matches[0].suggestions[0]).toMatchObject({ item: 1 });
      expect(result.entries).toEqual([{ name: 'Kudos', sourceId: 'kudos' }]);
      expect(result.matches[1]).toMatchObject({ ids: ['kudos'], item: 2, unsure: true });
    });
  });
});

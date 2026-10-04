import { GROWTH_TIMELINE_LAYOUT } from 'src/utils/book/layouts.js';
import { getCollectionTagRules, validateCollectionPack } from 'src/utils/collections/pack.js';
import { getPlantCaption, reviewGardenBook } from 'src/utils/collections/packs/garden/book.js';
import { gardenPack } from 'src/utils/collections/packs/garden/pack.js';
import { PLANT_PROMPTS } from 'src/utils/collections/packs/garden/plants.js';
import { getCollectionPack, getCollectionPacks } from 'src/utils/collections/registry.js';
import { findSourceLeaf, getEntryTag, getSourceTag, parseCollectionTag } from 'src/utils/collections/tags.js';
import { groupVisits } from 'src/utils/collections/visits.js';

const at = (iso: string) => new Date(`${iso}Z`).getTime();

describe('garden pack', () => {
  it('should be registered, valid beside the other packs', () => {
    expect(getCollectionPack('garden')).toBe(gardenPack);
    expect(validateCollectionPack(gardenPack, getCollectionPacks())).toEqual([]);
    expect(gardenPack.book.preset).toMatchObject({ id: 'garden', name: 'Garden journal' });
    expect(gardenPack.book.chapters).toBe('entry');
    expect(gardenPack.agent.instructions).toContain('pack "garden"');
  });

  it('should tag the plants "Garden/<Garden>/<Plant variety>", and the sources "…/Tag" or "…/Seed packet"', () => {
    const rules = getCollectionTagRules(gardenPack);
    expect(getEntryTag(rules, 'Hawea Pl garden', "Peach 'Tropic Prince'")).toBe(
      "Garden/Hawea Pl garden/Peach 'Tropic Prince'",
    );
    expect(getSourceTag(rules, 'Hawea Pl garden')).toBe('Garden/Hawea Pl garden/Tag');
    expect(getSourceTag(rules, 'Makawao garden', 'Seed packet')).toBe('Garden/Makawao garden/Seed packet');
    expect(parseCollectionTag(rules, 'Garden/Makawao garden/Seed packet')).toEqual({
      place: 'Makawao garden',
      kind: 'source',
    });
    expect(findSourceLeaf(rules, 'seed packet')).toBe('Seed packet');
    // a plant called like a source leaf is still a plant
    expect(getEntryTag(rules, 'Makawao garden', 'Tag')).toBe('Garden/Makawao garden/Tag (plant photo)');
  });

  it('should keep a garden one visit over the years, and write the growth stage in the descriptions', () => {
    const visits = groupVisits(
      [
        { id: 'a', time: at('2013-02-01T10:42:31'), kind: 'subject' as const },
        { id: 'b', time: at('2014-06-14T09:03:43'), kind: 'subject' as const },
        { id: 'c', time: at('2016-06-05T11:23:45'), kind: 'subject' as const },
      ],
      gardenPack.visits.options,
    );
    expect(visits).toHaveLength(1);
    const flowering = PLANT_PROMPTS.map((_, index) => (index === 2 ? 0.3 : 0.2));
    expect(gardenPack.describe("Peach 'Tropic Prince'", 'Hawea Pl', { similarities: flowering })).toBe(
      "Peach 'Tropic Prince' · flowering",
    );
    expect(gardenPack.describe("Peach 'Tropic Prince'", 'Hawea Pl')).toBe("Peach 'Tropic Prince'");
  });

  it('should caption a photo on a growth timeline with its date and stage', () => {
    const context = { layout: GROWTH_TIMELINE_LAYOUT, takenAt: at('2013-02-01T10:43:03') };
    expect(
      getPlantCaption("Peach 'Tropic Prince'", { ...context, description: "Peach 'Tropic Prince' · flowering" }),
    ).toBe('1 Feb 2013\nflowering');
    expect(getPlantCaption("Peach 'Tropic Prince'", { ...context, description: 'First blossom!' })).toBe(
      '1 Feb 2013\nFirst blossom!',
    );
    expect(getPlantCaption("Peach 'Tropic Prince'", { layout: 'dish' })).toBe("Peach 'Tropic Prince'");
  });

  it('should report plants without a variety, and plants shown on one day only', () => {
    const issues = reviewGardenBook({
      pages: [],
      photos: [
        { id: 'a', takenAt: at('2013-02-01T10:00:00') },
        { id: 'b', takenAt: at('2014-06-14T10:00:00') },
      ],
      chapters: [
        {
          place: 'Hawea Pl garden',
          placed: [
            { entry: "Peach 'Tropic Prince'", assetIds: ['a'] },
            { entry: 'Unknown', assetIds: ['c'] },
          ],
          available: [{ entry: "Peach 'Tropic Prince'", assetIds: ['a', 'b'] }],
          pages: [2],
        },
      ],
    });
    expect(issues.map(({ type, assetIds }) => ({ type, assetIds }))).toEqual([
      { type: 'missing-dish-name', assetIds: ['c'] },
      { type: 'could-look-better', assetIds: ['b'] },
    ]);
  });
});

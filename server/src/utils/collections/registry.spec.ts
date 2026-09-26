import { bookStylePresetIds, bookStyleThemes } from 'src/dtos/book.dto.js';
import { AutoLayoutPhoto, planAutoLayout } from 'src/utils/book/auto-layout.js';
import {
  getCollectionTag,
  getCollectionTagPrefixes,
  isCollectionTheme,
  isPrintedTheme,
} from 'src/utils/book/collections.js';
import { reviewBook } from 'src/utils/book/review.js';
import { getCollectionMessages, getCollectionTagRules, validateCollectionPack } from 'src/utils/collections/pack.js';
import { foodPack } from 'src/utils/collections/packs/food/pack.js';
import {
  BUILT_IN_COLLECTION_PACKS,
  getCollectionPack,
  getCollectionPackByTagRoot,
  getCollectionPacks,
  registerCollectionPack,
  unregisterCollectionPack,
} from 'src/utils/collections/registry.js';
import { getEntryTag, getSourceTag } from 'src/utils/collections/tags.js';
import { labelsPack } from 'test/fixtures/collections/labels.pack.js';

describe('collection packs', () => {
  it('should have valid built-in packs, food first', () => {
    expect(BUILT_IN_COLLECTION_PACKS[0]).toBe(foodPack);
    for (const pack of BUILT_IN_COLLECTION_PACKS) {
      expect(validateCollectionPack(pack, BUILT_IN_COLLECTION_PACKS), pack.id).toEqual([]);
    }
    expect(getCollectionPack('food')).toBe(foodPack);
    expect(getCollectionPackByTagRoot('Food')).toBe(foodPack);
  });

  it('should take the book presets and themes of the packs', () => {
    expect(bookStylePresetIds).toEqual(['classic', 'soft', 'bold', 'food']);
    expect(bookStyleThemes).toEqual(['plain', 'food']);
    expect(isCollectionTheme('food')).toBe(true);
    expect(isPrintedTheme('food')).toBe(true);
    expect(isPrintedTheme('plain')).toBe(false);
  });

  it('should keep the messages of food in its words', () => {
    const messages = getCollectionMessages(foodPack);
    expect(messages.fewEntries).toBe(
      'Few menu items could be read: look at the menu image and read the items yourself',
    );
    expect(messages.noSource).toBe('No menu: name the dishes from what you see');
    expect(messages.noEntriesRead).toBe(
      'No menu items could be read: look at the menu yourself and pass its items, or name the dishes from what you see',
    );
    expect(messages.cannotMatch).toBe('Smart search is disabled, so dishes cannot be matched with menu items');
    expect(messages.placeNeedsName).toBe('The restaurant needs a name');
    expect(messages.tilesFailed).toBe(
      'The menu could not be read at full resolution; the items come from the stored OCR',
    );
    expect(messages.smartSearchDisabled).toBe(
      'Smart search is disabled: dishes cannot be recognized, only menus, signs and receipts by their text',
    );
  });

  it('should reject a pack that collides with another', () => {
    expect(validateCollectionPack({ ...labelsPack, id: 'food' }, [foodPack])).toContain('id "food" is taken');
    expect(validateCollectionPack({ ...labelsPack, tagRoot: 'food' }, [foodPack])).toContain(
      'tag root "food" is taken by food',
    );
    expect(validateCollectionPack({ ...labelsPack, id: 'Labels!' })).toEqual([
      'id "Labels!" must be lowercase letters, digits and dashes',
    ]);
    expect(() => registerCollectionPack({ ...labelsPack, tagRoot: 'Food' })).toThrow('tag root "Food" is taken');
    expect(() => unregisterCollectionPack('food')).toThrow('built in');
  });
});

describe('a second pack in books', () => {
  beforeAll(() => {
    registerCollectionPack(labelsPack);
    return () => unregisterCollectionPack(labelsPack.id);
  });

  const labels = getCollectionTagRules(labelsPack);
  const food = getCollectionTagRules(foodPack);
  const start = Date.UTC(2024, 4, 2, 10, 0);
  const MINUTE = 60_000;
  let counter = 0;
  const photo = (values: string[], dto: Partial<AutoLayoutPhoto> = {}): AutoLayoutPhoto => {
    counter++;
    return {
      id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
      width: 3000,
      height: 2000,
      takenAt: start + counter * 10 * MINUTE,
      score: 0.5,
      faces: [],
      isFavorite: false,
      collection: getCollectionTag(values) ?? null,
      ...dto,
    };
  };

  it('should read its tags next to the food tags', () => {
    expect(getCollectionTagPrefixes()).toEqual(['Food/', 'Labels/']);
    expect(getCollectionTag([getEntryTag(labels, 'Orto Botanico', 'Rosa canina')])).toEqual({
      pack: 'labels',
      place: 'Orto Botanico',
      kind: 'entry',
      entry: 'Rosa canina',
    });
    expect(getCollectionTag([getSourceTag(labels, 'Orto Botanico')])).toEqual({
      pack: 'labels',
      place: 'Orto Botanico',
      kind: 'source',
    });
    // a place of the same name in two packs is two places
    expect(getCollectionTag([getSourceTag(food, 'Orto Botanico')])).toMatchObject({ pack: 'food' });
  });

  it('should make a chapter per visit of each pack, opened by its source page, with its entries captioned', () => {
    counter = 0;
    const garden = [
      photo([getSourceTag(labels, 'Orto Botanico')], { width: 2000, height: 2700, score: 0.3 }),
      photo([getEntryTag(labels, 'Orto Botanico', 'Asplenium nidus')]),
      photo([getEntryTag(labels, 'Orto Botanico', 'Rosa canina')]),
    ];
    const lunch = [
      photo([getSourceTag(food, 'Orto Botanico')], { width: 2000, height: 2700, score: 0.3 }),
      photo([getEntryTag(food, 'Orto Botanico', 'Caponata')]),
    ];
    const result = planAutoLayout([...garden, ...lunch], {
      size: { pageWidthMm: 210, pageHeightMm: 210 },
      style: foodPack.book.preset.style,
      includeMaps: false,
      cover: false,
    });

    expect(result.sections.map(({ place, pack }) => [place, pack])).toEqual([
      ['Orto Botanico', 'labels'],
      ['Orto Botanico', 'food'],
    ]);
    const captions = new Map(result.pages.flatMap((page) => page.slots.map((slot) => [slot.assetId, slot.caption])));
    expect(captions.get(garden[1].id)).toBe('Asplenium nidus');
    expect(captions.get(lunch[1].id)).toBe('Caponata');
    const sourcePages = result.pages.filter((page) => page.layout.startsWith('menu'));
    expect(sourcePages.map((page) => page.slots[0].assetId)).toEqual([garden[0].id, lunch[0].id]);
    expect(sourcePages[0].caption).toBe('Asplenium nidus\nRosa canina');
  });

  it('should review its entries in its own words', () => {
    counter = 0;
    const fern = photo([getEntryTag(labels, 'Orto Botanico', 'Asplenium nidus')]);
    const board = photo([getSourceTag(labels, 'Orto Botanico')]);
    const review = reviewBook({
      size: { pageWidthMm: 210, pageHeightMm: 210 },
      style: foodPack.book.preset.style,
      pages: [{ layout: 'single', assets: [{ slot: 0, assetId: fern.id, crop: null, caption: null }] }],
      photos: [fern, board],
    });

    expect(review.issues).toContainEqual(
      expect.objectContaining({
        type: 'missing-dish-name',
        message: expect.stringMatching(/^Page 1 shows? a plant without its name \(e\.g\. Asplenium nidus\)/),
      }),
    );
    // the labels pack does not ask for its source page
    expect(review.issues.map(({ type }) => type)).not.toContain('missing-menu-page');
  });

  it('should list the pack among the packs while it is registered', () => {
    expect(getCollectionPacks().map(({ id }) => id)).toEqual(['food', 'labels']);
  });
});

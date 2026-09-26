import type { CollectionPackSummaryDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import { getLibraryQuestions } from '$lib/utils/library-questions';

const $t = ((key: string, options?: { values?: Record<string, unknown> }) =>
  options?.values ? `${key} ${JSON.stringify(options.values)}` : key) as unknown as MessageFormatter;

const pack = (overrides: Partial<CollectionPackSummaryDto>): CollectionPackSummaryDto => ({
  pack: 'food',
  title: 'Food',
  place: 'restaurant',
  entry: 'menu items',
  visit: 'meals',
  photos: 0,
  visits: 0,
  places: 0,
  entries: 0,
  sources: 0,
  years: [],
  recentPlaces: [],
  ...overrides,
});

const food = pack({
  photos: 36,
  visits: 3,
  years: [2013, 2014, 2016],
  recentPlaces: [
    { name: 'Noma Australia', visits: 1, last: '2016-03-23' },
    { name: 'The French Laundry', visits: 1, last: '2014-01-11' },
    { name: "Katz's Delicatessen", visits: 1, last: '2013-06-15' },
  ],
});

describe('getLibraryQuestions', () => {
  it('should fall back to generic questions without a summary or collections', () => {
    const generic = [
      'assistant_question_generic_last_time',
      'assistant_question_generic_museums',
      'assistant_question_generic_day',
      'assistant_question_generic_collections',
    ];
    expect(getLibraryQuestions($t)).toEqual(generic);
    expect(getLibraryQuestions($t, { packs: [pack({ pack: 'museum' })], truncated: false })).toEqual(generic);
  });

  it('should ask about the places of the food collection', () => {
    expect(getLibraryQuestions($t, { packs: [food, pack({ pack: 'museum' })], truncated: false })).toEqual([
      'assistant_question_food {"place":"Noma Australia"}',
      'assistant_question_food {"place":"The French Laundry"}',
      'assistant_question_food {"place":"Katz\'s Delicatessen"}',
      'assistant_question_generic_collections',
    ]);
  });

  it('should ask about every pack before older places, and about unknown packs by their place', () => {
    const packs = [
      food,
      pack({
        pack: 'museum',
        photos: 4,
        years: [2024, 2025],
        recentPlaces: [{ name: 'Rijksmuseum', visits: 1, last: '' }],
      }),
      pack({ pack: 'cookbook', photos: 3, recentPlaces: [{ name: 'Quiche Lorraine', visits: 2, last: '' }] }),
      pack({ pack: 'wine', photos: 2, recentPlaces: [{ name: 'Noma Australia', visits: 1, last: '' }] }),
    ];
    expect(getLibraryQuestions($t, { packs, truncated: false })).toEqual([
      'assistant_question_food {"place":"Noma Australia"}',
      'assistant_question_museum {"year":"2025"}',
      'assistant_question_cookbook {"place":"Quiche Lorraine"}',
      'assistant_question_generic_collections',
    ]);
    expect(getLibraryQuestions($t, { packs: packs.slice(3), truncated: false })[0]).toBe(
      'assistant_question_place {"place":"Noma Australia"}',
    );
  });

  it('should ask about a trip', () => {
    const travel = pack({
      pack: 'travel',
      photos: 5,
      recentPlaces: [{ name: 'Crete, October 2016', visits: 1, last: '2016-10-05' }],
    });
    expect(getLibraryQuestions($t, { packs: [travel], truncated: false })).toEqual([
      'assistant_question_travel {"place":"Crete, October 2016"}',
      'assistant_question_generic_collections',
    ]);
  });
});

import { CollectionTagRow } from 'src/utils/collections/query.js';

/**
 * The collection tags of the demo library of the development instance (read on 2026-09-26): three restaurant meals
 * named with the food pack, with their menus. The photos have no location and no people.
 */
const DEMO_TAGS: Array<[assetId: string, value: string, localDateTime: string]> = [
  ['ad3e0356-6091-420b-92d9-e3ffe04cbf3b', "Food/Katz's Delicatessen/Menu", '2013-06-15T08:53:24.480Z'],
  ['e95ba90a-30e0-4e29-a993-083420913d53', "Food/Katz's Delicatessen/Pickles", '2013-06-15T08:55:32.910Z'],
  [
    '14edac36-08ed-4d28-801f-3639e9af962d',
    "Food/Katz's Delicatessen/Dr. Brown's Root Beer",
    '2013-06-15T09:02:38.100Z',
  ],
  ['abb582ef-d5ee-402a-81fc-332925cd7b25', "Food/Katz's Delicatessen/Steak Fries", '2013-06-15T09:03:35.920Z'],
  ['08601fe5-3dd9-47de-b230-f8f20182ffa6', "Food/Katz's Delicatessen/Matzo Ball Soup", '2013-06-15T09:07:13.290Z'],
  ['cccbda84-27a4-4b82-81fa-afe9c79db73d', "Food/Katz's Delicatessen/Katz's Pastrami", '2013-06-15T09:14:03.320Z'],
  ['f47aed56-a50d-4c63-b16c-e74fc54d6944', 'Food/The French Laundry/Menu', '2014-01-11T11:43:00.000Z'],
  ['7144b65c-9b36-4845-9280-0522144198e6', 'Food/The French Laundry/Gougères', '2014-01-11T11:52:10.000Z'],
  ['192ae623-a809-4808-a97f-921d44246f93', 'Food/The French Laundry/Salmon Tartare Cornet', '2014-01-11T11:52:55.000Z'],
  ['199577ca-b5df-4d0c-ad2a-6a3ee362c30f', 'Food/The French Laundry/"Oysters and Pearls"', '2014-01-11T11:57:19.170Z'],
  ['252845c8-c4b7-48a9-8327-857c15a56cc8', 'Food/The French Laundry/Bread and Butter', '2014-01-11T12:08:01.000Z'],
  [
    'a807a409-b6c8-4ee2-bb12-fd888e34e158',
    'Food/The French Laundry/Salad of Hawaiian Hearts of Peach Palm',
    '2014-01-11T12:08:37.070Z',
  ],
  [
    'd2840755-5bad-49ef-b0d0-cce85f00b723',
    'Food/The French Laundry/Citrus-Cured Scottish Sea Trout',
    '2014-01-11T12:22:28.000Z',
  ],
  [
    '5bc94b25-5607-4cfe-95c0-f96a5377eb0c',
    'Food/The French Laundry/Alaskan King Crab "Boudin"',
    '2014-01-11T12:35:57.000Z',
  ],
  [
    '12eafb37-a90a-471e-9029-35e0c8ef3990',
    'Food/The French Laundry/Four Story Hill Farm Milk-Poached Poularde',
    '2014-01-11T12:49:44.000Z',
  ],
  [
    'dfe2fed3-6a73-4147-83f3-5ce7dafd079b',
    'Food/The French Laundry/Andante Dairy "Acapella"',
    '2014-01-11T13:17:36.000Z',
  ],
  ['eb68baec-b4af-4e18-b662-8faed73a6835', 'Food/The French Laundry/Citrus Pre-Dessert', '2014-01-11T13:28:42.000Z'],
  [
    '053284f9-35cc-43b5-9458-c728bcf51c80',
    'Food/The French Laundry/"Assortment of Desserts"',
    '2014-01-11T13:46:16.000Z',
  ],
  ['e927e0d1-8983-4d5a-ace1-b9ec8328fa7d', 'Food/The French Laundry/Coffee and Doughnuts', '2014-01-11T14:01:40.000Z'],
  ['a363d7df-e4c1-405e-ada9-5bf7f8e1d34d', 'Food/The French Laundry/Menu', '2014-01-11T16:08:21.260Z'],
  [
    '68c40371-9d89-470a-b8e2-94ed27ad2d25',
    'Food/Noma Australia/Unripe macadamia and spanner crab',
    '2016-03-23T17:41:16.840Z',
  ],
  [
    '3d60ba1e-6821-41dc-9037-5998e0a0480c',
    'Food/Noma Australia/Wild seasonal berries flavoured with gubinge',
    '2016-03-23T17:49:34.680Z',
  ],
  [
    'fe9ca106-531d-41f1-922c-9d6c485d9ce0',
    'Food/Noma Australia/Table setting with juice pairing',
    '2016-03-23T17:55:32.470Z',
  ],
  [
    '0d19db34-1f0a-4365-a1ef-5809d9da8ed6',
    'Food/Noma Australia/Porridge of golden & desert oak wattleseed with saltbush',
    '2016-03-23T17:59:58.930Z',
  ],
  [
    '1972a2d6-0f60-496b-95af-8ed10be68970',
    'Food/Noma Australia/Seafood platter and crocodile fat',
    '2016-03-23T18:09:15.350Z',
  ],
  [
    '3a0beea2-0d7e-41e4-8481-5ca718ededb6',
    'Food/Noma Australia/W.A. deep sea snow crab with cured egg yolk',
    '2016-03-23T18:18:52.010Z',
  ],
  [
    '2af1f17a-c207-4f38-8d96-49e05e40ba0a',
    'Food/Noma Australia/PIE: dried scallops and nasturtium flowers',
    '2016-03-23T18:28:43.030Z',
  ],
  [
    'beb3b1e3-0572-4084-84c8-baea2e2b2cb8',
    "Food/Noma Australia/BBQ'd milk 'dumpling', Marron and Magpie goose",
    '2016-03-23T18:37:32.220Z',
  ],
  ['30415942-b471-4f26-a593-b80878d762f3', 'Food/Noma Australia/Truffle and Avocado', '2016-03-23T18:48:17.210Z'],
  [
    '69c1cc59-c784-4d2c-b044-9e6a03c34737',
    'Food/Noma Australia/Tomato dried with pepper berries',
    '2016-03-23T18:56:58.240Z',
  ],
  [
    '0fd97927-087d-46d5-b09c-23b778d5457d',
    'Food/Noma Australia/Abalone schnitzel and bush condiments',
    '2016-03-23T19:09:53.460Z',
  ],
  ['8b6f6951-dd1d-4685-884c-9511713d37bc', 'Food/Noma Australia/Marinated fresh fruit', '2016-03-23T19:38:21.750Z'],
  ['f145dc66-c01b-4cf7-8d79-b2060533c5d3', 'Food/Noma Australia/Rum lamington', '2016-03-23T19:51:24.420Z'],
  [
    'da63e5ab-734c-44b4-8194-6b8671adaec9',
    'Food/Noma Australia/Peanut milk and freekah "Baytime"',
    '2016-03-23T20:01:39.920Z',
  ],
  ['0c8ed112-39ef-4b21-ac05-e2eecb70311c', 'Food/Noma Australia/Golden petits fours', '2016-03-23T20:17:28.430Z'],
  ['ca08aa1b-4382-4128-817c-6b04bb9d776d', 'Food/Noma Australia/Menu', '2016-03-23T20:51:08.500Z'],
];

export const demoCollectionRows = (): CollectionTagRow[] =>
  DEMO_TAGS.map(([assetId, value, localDateTime]) => ({
    assetId,
    value,
    localDateTime: new Date(localDateTime),
    city: null,
    country: null,
    people: [],
  }));

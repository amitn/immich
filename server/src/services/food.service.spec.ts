import { BadRequestException } from '@nestjs/common';
import { AssetFileType, AssetType } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { FoodService } from 'src/services/food.service.js';
import { TagService } from 'src/services/tag.service.js';
import { CollectionKind } from 'src/utils/collections/classify.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { FOOD_PROMPT_LIST } from 'src/utils/collections/packs/food/classify.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** CLIP similarities with the classification prompts, every prompt of a kind at the given value */
const similarities = (values: Partial<Record<CollectionKind, number>>) =>
  FOOD_PROMPT_LIST.map(({ kind }) => values[kind] ?? 0.15);

const dish = similarities({ subject: 0.3, other: 0.2 });
const person = similarities({ subject: 0.18, other: 0.3 });
const storefront = similarities({ sign: 0.28, other: 0.22 });
const menuLook = similarities({ source: 0.27, subject: 0.22, other: 0.2 });

const box = (text: string, left: number, top: number, height = 0.022) => {
  const right = left + text.length * height * 0.45;
  const bottom = top + height;
  return {
    x1: left,
    y1: top,
    x2: right,
    y2: top,
    x3: right,
    y3: bottom,
    x4: left,
    y4: bottom,
    text,
    boxScore: 0.9,
    textScore: 0.95,
  };
};

const menuBoxes: OcrBoxInput[] = [
  box('Trattoria da Nino', 0.25, 0.03, 0.05),
  box('PRIMI', 0.1, 0.12, 0.03),
  box('Spaghetti alla carbonara', 0.1, 0.18),
  box('12,00', 0.8, 0.18),
  box('Pasta alla Norma', 0.1, 0.24),
  box('11,00', 0.8, 0.24),
  box('DOLCI', 0.1, 0.32, 0.03),
  box('Tiramisù', 0.1, 0.38),
  box('6,00', 0.8, 0.38),
  box('Cannolo', 0.1, 0.44),
  box('5,00', 0.8, 0.44),
];

const eventRow = (id: string, iso: string, extra: Record<string, unknown> = {}) => ({
  id,
  localDateTime: new Date(`${iso}Z`),
  latitude: null,
  longitude: null,
  city: null,
  country: null,
  people: [],
  ...extra,
});

const agentRow = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: AssetType.Image,
    localDateTime: new Date('2024-06-12T20:30:00Z'),
    latitude: null,
    longitude: null,
    city: null,
    country: null,
    description: '',
    previewPath: `/data/thumbs/${id}.jpeg`,
    faces: [],
    ...extra,
  }) as never;

/** the OCR output of the machine learning service for boxes normalized to the image */
const mlOcr = (boxes: OcrBoxInput[]) => ({
  text: boxes.map(({ text }) => text),
  box: boxes.flatMap(({ x1, y1, x2, y2, x3, y3, x4, y4 }) => [x1, y1, x2, y2, x3, y3, x4, y4]),
  boxScore: boxes.map(() => 0.9),
  textScore: boxes.map(() => 0.95),
});

/** a unit vector along an axis */
const unit = (index: number, size = 8) => Array.from({ length: size }, (_, i) => (i === index ? 1 : 0));

describe(FoodService.name, () => {
  let sut: FoodService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FoodService));
    mocks.machineLearning.encodeText.mockImplementation((text: string) => Promise.resolve(`[${text.length},1,0]`));
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.asset.getByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, type: AssetType.Image, deletedAt: null })) as never),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findMeals', () => {
    it('should require an album, photos or dates', async () => {
      await expect(sut.findMeals(auth, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should require access to the album', async () => {
      await expect(sut.findMeals(auth, { albumId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should find the meals of an album and name them', async () => {
      const albumId = newUuid();
      const [sign, menu, pasta, dessert, friends, lunch] = Array.from({ length: 6 }, () => newUuid());
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.assetJob.getForAgentEvents.mockResolvedValue([
        eventRow(sign, '2024-06-12T19:58:00', { city: 'Taormina' }),
        eventRow(menu, '2024-06-12T20:05:00', { city: 'Taormina' }),
        eventRow(pasta, '2024-06-12T20:40:00', { city: 'Taormina' }),
        eventRow(dessert, '2024-06-12T21:15:00', { city: 'Taormina' }),
        eventRow(friends, '2024-06-12T21:20:00', { city: 'Taormina' }),
        eventRow(lunch, '2024-06-13T13:10:00', { city: 'Catania' }),
      ] as never);
      mocks.search.getEmbeddingSimilarities.mockResolvedValue([
        { assetId: sign, similarities: storefront },
        { assetId: menu, similarities: menuLook },
        { assetId: pasta, similarities: dish },
        { assetId: dessert, similarities: dish },
        { assetId: friends, similarities: person },
        { assetId: lunch, similarities: dish },
      ]);
      mocks.ocr.getByAssetIds.mockResolvedValue([
        { assetId: sign, ...box('TRATTORIA DA NINO', 0.2, 0.3, 0.08) },
        ...menuBoxes.map((ocr) => ({ assetId: menu, ...ocr })),
      ] as never);

      const result = await sut.findMeals(auth, { albumId });

      expect(mocks.assetJob.getForAgentEvents).toHaveBeenCalledWith(
        expect.objectContaining({ albumId, userIds: undefined, viewingUserId: auth.user.id }),
      );
      expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(FOOD_PROMPT_LIST.length);
      expect(result).toMatchObject({ count: 6, truncated: false, foodPhotos: 5, warnings: [] });
      expect(result.meals).toHaveLength(2);
      expect(result.meals[0]).toMatchObject({
        index: 0,
        start: '2024-06-12T19:58:00',
        type: 'Dinner',
        city: 'Taormina',
        dishIds: [pasta, dessert],
        menuIds: [menu],
        signIds: [sign],
        receiptIds: [],
        restaurant: { name: 'Trattoria da Nino', source: 'sign' },
        saved: [],
      });
      expect(result.meals[0].restaurant.assetIds).toEqual(expect.arrayContaining([sign, menu]));
      expect(result.meals[1]).toMatchObject({
        dishIds: [lunch],
        restaurant: { name: 'Lunch in Catania', source: 'fallback', confidence: 0 },
      });
    });

    it('should use the food tags already on the photos', async () => {
      const [pasta] = [newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([pasta]));
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(pasta)]);
      mocks.search.getEmbeddingSimilarities.mockResolvedValue([{ assetId: pasta, similarities: dish }]);
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([
        { assetId: pasta, tagId: newUuid(), value: 'Food/Il Gabbiano/Spaghetti' },
        { assetId: pasta, tagId: newUuid(), value: 'Food/Il Gabbiano' },
      ]);

      const { meals } = await sut.findMeals(auth, { assetIds: [pasta] });

      expect(meals).toHaveLength(1);
      expect(meals[0].restaurant).toEqual({ name: 'Il Gabbiano', source: 'tag', confidence: 1, assetIds: [pasta] });
      expect(meals[0].saved).toEqual([{ assetId: pasta, restaurant: 'Il Gabbiano', dish: 'Spaghetti', menu: false }]);
    });

    it('should leave out videos', async () => {
      const [clip] = [newUuid()];
      mocks.assetJob.getForAgentEvents.mockResolvedValue([eventRow(clip, '2024-06-12T20:00:00')] as never);
      mocks.search.getEmbeddingSimilarities.mockResolvedValue([{ assetId: clip, similarities: dish }]);
      mocks.asset.getByIds.mockResolvedValue([{ id: clip, type: AssetType.Video, deletedAt: null }] as never);

      const result = await sut.findMeals(auth, { takenAfter: '2024-06-12' });

      expect(result.meals).toEqual([]);
      expect(mocks.assetJob.getForAgentEvents).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: [auth.user.id], takenAfter: new Date('2024-06-12') }),
      );
    });

    it('should find menus by their text when smart search is disabled', async () => {
      const menu = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { clip: { enabled: false } } });
      mocks.assetJob.getForAgentEvents.mockResolvedValue([eventRow(menu, '2024-06-12T20:00:00')] as never);
      const longMenu = [
        ...menuBoxes,
        ...['Arancini', 'Caponata', 'Parmigiana', 'Pesce spada', 'Granita'].flatMap((name, i) => [
          box(name, 0.1, 0.5 + i * 0.06),
          box(`${7 + i},00`, 0.8, 0.5 + i * 0.06),
        ]),
      ];
      mocks.ocr.getByAssetIds.mockResolvedValue(longMenu.map((ocr) => ({ assetId: menu, ...ocr })) as never);

      const result = await sut.findMeals(auth, { takenAfter: '2024-06-01', takenBefore: '2024-07-01' });

      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
      expect(result.meals.map(({ menuIds }) => menuIds)).toEqual([[menu]]);
      expect(result.warnings).toEqual([expect.stringContaining('Smart search is disabled')]);
    });

    it('should reject an invalid date', async () => {
      await expect(sut.findMeals(auth, { takenAfter: 'yesterday' })).rejects.toThrow('Invalid date');
    });
  });

  describe('matchMeal', () => {
    const embeddings: Record<string, string> = {
      'a photo of Carbonara': '[1,0,0,0]',
      'a photo of Tiramisù: mascarpone, savoiardi': '[0,1,0,0]',
    };

    beforeEach(() => {
      mocks.machineLearning.encodeText.mockImplementation((text: string) =>
        Promise.resolve(embeddings[text] ?? '[0,0,1,0]'),
      );
    });

    it('should match the dishes with the items given', async () => {
      const [carbonara, tiramisu, bread] = [newUuid(), newUuid(), newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([carbonara, tiramisu, bread]));
      mocks.assetJob.getForAgent.mockResolvedValue([
        agentRow(carbonara, { localDateTime: new Date('2024-06-12T20:30:00Z') }),
        agentRow(tiramisu, { localDateTime: new Date('2024-06-12T21:30:00Z') }),
        agentRow(bread, { localDateTime: new Date('2024-06-12T20:10:00Z') }),
      ]);
      mocks.search.getEmbeddings.mockResolvedValue([
        { assetId: carbonara, embedding: '[0.9,0.1,0.1,0.3]' },
        { assetId: tiramisu, embedding: '[0.1,0.9,0.1,0.3]' },
        { assetId: bread, embedding: '[0.1,0.1,0.9,0.3]' },
      ]);

      const result = await sut.matchMeal(auth, {
        dishIds: [carbonara, tiramisu, bread],
        items: [{ name: 'Carbonara' }, { name: 'Tiramisù', description: 'mascarpone, savoiardi' }],
      });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith('a photo of Carbonara', {
        modelName: 'ViT-B-32__openai',
      });
      expect(result.items).toEqual([
        { index: 0, name: 'Carbonara' },
        { index: 1, name: 'Tiramisù', description: 'mascarpone, savoiardi' },
      ]);
      expect(result.dishes.map(({ assetIds, name, unsure }) => ({ assetIds, name, unsure }))).toEqual([
        { assetIds: [bread], name: undefined, unsure: true },
        { assetIds: [carbonara], name: 'Carbonara', unsure: false },
        { assetIds: [tiramisu], name: 'Tiramisù', unsure: false },
      ]);
      expect(result.dishes[0].offMenu).toBeGreaterThan(0.5);
      expect(result.noEmbedding).toEqual([]);
    });

    it('should match the courses of a tasting menu in the order they were served', async () => {
      // six courses that CLIP tells apart only a little: each photo is almost as close to the course two later
      const courses = ['Oysters', 'Salad', 'Trout', 'Crab', 'Lamb', 'Desserts'];
      mocks.machineLearning.encodeText.mockImplementation((text: string) => {
        const index = courses.findIndex((course) => text === `a photo of ${course}`);
        return Promise.resolve(JSON.stringify(unit(index === -1 ? 6 : index)));
      });
      const ids = courses.map(() => newUuid());
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(ids));
      mocks.assetJob.getForAgent.mockResolvedValue(
        ids.map((id, index) => agentRow(id, { localDateTime: new Date(Date.UTC(2024, 5, 12, 19, 10 + index * 15)) })),
      );
      mocks.search.getEmbeddings.mockResolvedValue(
        ids.map((assetId, index) => {
          const embedding = unit(index).map((value) => value * 0.5);
          embedding[(index + 2) % 6] = 0.47;
          embedding[7] = 0.7;
          return { assetId, embedding: JSON.stringify(embedding) };
        }),
      );

      const result = await sut.matchMeal(auth, { dishIds: ids, items: courses.map((name) => ({ name })) });

      expect(result.ordered).toBe(true);
      expect(result.dishes.map(({ name }) => name)).toEqual(courses);
    });

    it('should read the items of the menu photos at full resolution', async () => {
      const [menu, carbonara] = [newUuid(), newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([menu, carbonara]));
      mocks.asset.getById.mockResolvedValue({
        id: menu,
        type: AssetType.Image,
        checksum: Buffer.from('menu'),
        originalPath: '/data/upload/menu.jpg',
        originalFileName: 'menu.jpg',
        deletedAt: null,
        exifInfo: {
          exifImageWidth: 2000,
          exifImageHeight: 1000,
          orientation: null,
          colorspace: null,
          profileDescription: null,
          bitsPerSample: null,
        },
        files: [{ type: AssetFileType.Preview, path: '/data/thumbs/menu.jpeg', isEdited: false }],
      } as never);
      // the stored OCR of the preview only read the headings
      mocks.ocr.getByAssetId.mockResolvedValue([box('PRIMI', 0.1, 0.12, 0.03), box('DOLCI', 0.1, 0.32, 0.03)] as never);
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.alloc(0),
        info: { width: 2000, height: 1000, channels: 3 },
      } as never);
      mocks.media.getJpegCrops.mockResolvedValue([Buffer.from('jpeg')]);
      mocks.machineLearning.ocr.mockResolvedValue(mlOcr(menuBoxes));
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(carbonara)]);
      mocks.search.getEmbeddings.mockResolvedValue([{ assetId: carbonara, embedding: '[0.1,0,0.9,0.1]' }]);

      const result = await sut.matchMeal(auth, { dishIds: [carbonara], menuIds: [menu] });

      expect(mocks.machineLearning.ocr).toHaveBeenCalledWith(
        Buffer.from('jpeg'),
        expect.objectContaining({ modelName: 'PP-OCRv5_mobile', minRecognitionScore: 0.6, maxResolution: 1000 }),
      );
      expect(mocks.ocr.upsert).not.toHaveBeenCalled();
      expect(result.items.map(({ name, price, section, menuId }) => ({ name, price, section, menuId }))).toEqual([
        { name: 'Spaghetti alla carbonara', price: '12,00', section: 'PRIMI', menuId: menu },
        { name: 'Pasta alla Norma', price: '11,00', section: 'PRIMI', menuId: menu },
        { name: 'Tiramisù', price: '6,00', section: 'DOLCI', menuId: menu },
        { name: 'Cannolo', price: '5,00', section: 'DOLCI', menuId: menu },
      ]);
      expect(result.dishes).toHaveLength(1);
    });

    it('should say when there is no menu', async () => {
      const carbonara = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([carbonara]));
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(carbonara)]);
      mocks.search.getEmbeddings.mockResolvedValue([{ assetId: carbonara, embedding: '[1,0,0,0]' }]);

      const result = await sut.matchMeal(auth, { dishIds: [carbonara] });

      expect(result.items).toEqual([]);
      expect(result.dishes).toEqual([{ assetIds: [carbonara], score: 0, unsure: true, suggestions: [] }]);
      expect(result.warnings).toEqual(['No menu: name the dishes from what you see']);
      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
    });

    it('should list the dishes without an embedding', async () => {
      const carbonara = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([carbonara]));
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(carbonara)]);
      mocks.search.getEmbeddings.mockResolvedValue([]);

      const result = await sut.matchMeal(auth, { dishIds: [carbonara], items: [{ name: 'Carbonara' }] });

      expect(result.noEmbedding).toEqual([carbonara]);
      expect(result.dishes).toEqual([]);
    });
  });

  describe('lookupRestaurants', () => {
    it('should say when the lookup is disabled', async () => {
      const result = await sut.lookupRestaurants(auth, { latitude: 37.85, longitude: 15.28 });
      expect(result).toEqual({ enabled: false, message: expect.stringContaining('Ask the user') });
      expect(mocks.map.queryOverpass).not.toHaveBeenCalled();
    });

    it('should look up the places near the photos', async () => {
      const photo = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ food: { openStreetMap: { enabled: true } } });
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([photo]));
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(photo, { latitude: 37.8526, longitude: 15.2869 })]);
      mocks.map.queryOverpass.mockResolvedValue({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 37.8527,
            lon: 15.287,
            tags: { name: 'Trattoria da Nino', amenity: 'restaurant' },
          },
        ],
      });

      const result = await sut.lookupRestaurants(auth, { assetIds: [photo] });

      expect(mocks.map.queryOverpass).toHaveBeenCalledWith(
        'https://overpass-api.de/api/interpreter',
        expect.stringContaining('nwr(around:75,37.852600,15.286900)'),
      );
      expect(result).toEqual({
        enabled: true,
        latitude: 37.8526,
        longitude: 15.2869,
        radius: 75,
        places: [{ name: 'Trattoria da Nino', amenity: 'restaurant', distance: 14, osm: 'node/1' }],
      });
    });

    it('should need a location', async () => {
      const photo = newUuid();
      mocks.systemMetadata.get.mockResolvedValue({ food: { openStreetMap: { enabled: true } } });
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([photo]));
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(photo)]);

      await expect(sut.lookupRestaurants(auth, { assetIds: [photo] })).rejects.toThrow('no location');
      expect(mocks.map.queryOverpass).not.toHaveBeenCalled();
    });
  });

  describe('setDishNames', () => {
    let addAssets: ReturnType<typeof vi.spyOn>;
    let removeAssets: ReturnType<typeof vi.spyOn>;
    let update: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mocks.tag.upsertValue.mockImplementation(({ value }: { value: string }) =>
        Promise.resolve({ id: `tag:${value}`, value } as never),
      );
      addAssets = vi
        .spyOn(TagService.prototype, 'addAssets')
        .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));
      removeAssets = vi
        .spyOn(TagService.prototype, 'removeAssets')
        .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));
      update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);
    });

    it('should tag the photos, replace their old food tags and describe the dishes without a description', async () => {
      const [carbonara, menu, captioned, renamed] = [newUuid(), newUuid(), newUuid(), newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([carbonara, menu, captioned, renamed]));
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([
        { assetId: renamed, tagId: 'tag:old', value: 'Food/Old name/Pasta' },
      ]);
      mocks.assetJob.getForAgent.mockResolvedValue([
        agentRow(carbonara, { description: '' }),
        agentRow(menu, { description: '' }),
        agentRow(captioned, { description: 'Best dinner ever' }),
        agentRow(renamed, { description: 'Pasta · Old name' }),
      ]);

      const result = await sut.setDishNames(auth, {
        restaurant: 'Trattoria da Nino',
        photos: [
          { id: carbonara, dish: 'Spaghetti alla carbonara' },
          { id: menu, dish: 'Menu' },
          { id: captioned, dish: 'Cannolo' },
          { id: renamed, dish: 'Pasta alla Norma' },
        ],
      });

      expect(mocks.tag.upsertValue.mock.calls.map(([{ value }]) => value)).toEqual([
        'Food',
        'Food/Trattoria da Nino',
        'Food/Trattoria da Nino/Spaghetti alla carbonara',
        'Food',
        'Food/Trattoria da Nino',
        'Food/Trattoria da Nino/Menu',
        'Food',
        'Food/Trattoria da Nino',
        'Food/Trattoria da Nino/Cannolo',
        'Food',
        'Food/Trattoria da Nino',
        'Food/Trattoria da Nino/Pasta alla Norma',
      ]);
      expect(removeAssets).toHaveBeenCalledWith(auth, 'tag:old', { ids: [renamed] });
      expect(addAssets).toHaveBeenCalledWith(auth, 'tag:Food/Trattoria da Nino/Menu', { ids: [menu] });
      expect(update.mock.calls).toEqual([
        [auth, carbonara, { description: 'Spaghetti alla carbonara · Trattoria da Nino' }],
        [auth, renamed, { description: 'Pasta alla Norma · Trattoria da Nino' }],
      ]);
      expect(result).toEqual({
        restaurant: 'Trattoria da Nino',
        results: [
          {
            id: carbonara,
            success: true,
            tag: 'Food/Trattoria da Nino/Spaghetti alla carbonara',
            description: 'Spaghetti alla carbonara · Trattoria da Nino',
          },
          { id: menu, success: true, tag: 'Food/Trattoria da Nino/Menu' },
          { id: captioned, success: true, tag: 'Food/Trattoria da Nino/Cannolo' },
          {
            id: renamed,
            success: true,
            tag: 'Food/Trattoria da Nino/Pasta alla Norma',
            previousTags: ['Food/Old name/Pasta'],
            description: 'Pasta alla Norma · Trattoria da Nino',
          },
        ],
      });
    });

    it('should change nothing when run again', async () => {
      const carbonara = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([carbonara]));
      mocks.tag.getAssetTagsByPrefix.mockResolvedValue([
        { assetId: carbonara, tagId: 'tag:Food/Nino/Carbonara', value: 'Food/Nino/Carbonara' },
      ]);
      addAssets.mockResolvedValue([{ id: carbonara, success: false, error: 'duplicate' }]);
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(carbonara, { description: 'Carbonara · Nino' })]);

      const result = await sut.setDishNames(auth, {
        restaurant: 'Nino',
        photos: [{ id: carbonara, dish: 'Carbonara' }],
      });

      expect(removeAssets).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(result.results).toEqual([{ id: carbonara, success: true, tag: 'Food/Nino/Carbonara' }]);
    });

    it('should skip photos the user cannot change', async () => {
      const [mine, partners] = [newUuid(), newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([mine]));
      mocks.assetJob.getForAgent.mockResolvedValue([agentRow(mine)]);

      const result = await sut.setDishNames(auth, {
        restaurant: 'Nino',
        photos: [
          { id: mine, menu: true },
          { id: partners, dish: 'Carbonara' },
        ],
      });

      expect(addAssets).toHaveBeenCalledWith(auth, 'tag:Food/Nino/Menu', { ids: [mine] });
      expect(result.results).toEqual([
        { id: mine, success: true, tag: 'Food/Nino/Menu' },
        { id: partners, success: false, error: 'no_permission' },
      ]);
    });

    it('should require a dish name or a menu', async () => {
      await expect(sut.setDishNames(auth, { restaurant: 'Nino', photos: [{ id: newUuid() }] })).rejects.toThrow(
        'needs a dish name',
      );
      await expect(
        sut.setDishNames(auth, { restaurant: ' / ', photos: [{ id: newUuid(), menu: true }] }),
      ).rejects.toThrow('The restaurant needs a name');
    });

    it('should report photos without permission without tagging anything', async () => {
      const partners = newUuid();
      mocks.assetJob.getForAgent.mockResolvedValue([]);

      const result = await sut.setDishNames(auth, {
        restaurant: 'Nino',
        photos: [{ id: partners, dish: 'Carbonara' }],
      });

      expect(result.results).toEqual([{ id: partners, success: false, error: 'no_permission' }]);
      expect(addAssets).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });
});

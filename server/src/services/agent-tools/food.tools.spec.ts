import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { FoodAgentTools } from 'src/services/agent-tools/food.tools.js';
import { FoodService, MenuReading } from 'src/services/food.service.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return JSON.parse((result.content[0] as { text: string }).text);
};

const reading = (items: MenuReading['items']): MenuReading => ({
  assetId: 'menu',
  items,
  title: 'Trattoria da Nino',
  sections: ['PRIMI'],
  columns: 1,
  lines: 5,
  ocr: 'tiles',
  restaurant: [{ name: 'Trattoria da Nino', source: 'menu', confidence: 0.8, assetIds: ['menu'] }],
  warnings: [],
  previewPath: '/p.jpeg',
  width: 4000,
  height: 3000,
});

describe(FoodAgentTools.name, () => {
  let sut: FoodAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FoodAgentTools));
    auth = AuthFactory.create();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should expose the food tools, with approval for the lookup and the names', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'find_meals', mutating: false },
      { name: 'read_menu', mutating: false },
      { name: 'match_dishes', mutating: false },
      { name: 'lookup_restaurant', mutating: true },
      { name: 'set_dish_names', mutating: true },
    ]);
    const lookup = sut.getTools().find(({ name }) => name === 'lookup_restaurant')!;
    expect(lookup.description).toMatch(/ask the user before/);
    expect(lookup.description).toMatch(/public service/);
  });

  describe('find_meals', () => {
    it('should return compact meals', async () => {
      const [dish, menu] = [newUuid(), newUuid()];
      const findMeals = vi.spyOn(FoodService.prototype, 'findMeals').mockResolvedValue({
        count: 10,
        truncated: false,
        foodPhotos: 2,
        meals: [
          {
            index: 0,
            start: '2024-06-12T20:00:00',
            end: '2024-06-12T21:00:00',
            day: '2024-06-12',
            type: 'Dinner',
            city: 'Taormina',
            dishIds: [dish],
            menuIds: [menu],
            signIds: [],
            receiptIds: [],
            restaurant: { name: 'Trattoria da Nino', source: 'menu', confidence: 0.7, assetIds: [menu] },
            candidates: [],
            saved: [],
          },
        ],
        warnings: [],
      });

      const result = parse(await call('find_meals', { albumId: newUuid() }));

      expect(findMeals).toHaveBeenCalledWith(auth, expect.objectContaining({ albumId: expect.any(String) }));
      expect(result).toEqual({
        count: 10,
        foodPhotos: 2,
        meals: [
          {
            index: 0,
            start: '2024-06-12T20:00:00',
            end: '2024-06-12T21:00:00',
            type: 'Dinner',
            city: 'Taormina',
            restaurant: { name: 'Trattoria da Nino', source: 'menu', confidence: 0.7 },
            dishIds: [dish],
            menuIds: [menu],
          },
        ],
      });
    });

    it('should turn client errors into tool errors', async () => {
      vi.spyOn(FoodService.prototype, 'findMeals').mockRejectedValue(new BadRequestException('Give an album'));
      const result = await call('find_meals', {});
      expect(result).toEqual({ content: [{ type: 'text', text: 'Give an album' }], isError: true });
    });
  });

  describe('read_menu', () => {
    it('should return the items and the menu image', async () => {
      const id = newUuid();
      vi.spyOn(FoodService.prototype, 'readMenu').mockResolvedValue(
        reading([
          { name: 'Carbonara', price: '12,00', section: 'PRIMI', column: 0, box: [0, 0, 1, 1] },
          { name: 'Norma', column: 0, box: [0, 0, 1, 1] },
          { name: 'Cannolo', column: 0, box: [0, 0, 1, 1] },
        ]),
      );
      const images = vi.spyOn(FoodService.prototype, 'getMenuImages').mockResolvedValue([Buffer.from('menu')]);

      const result = await call('read_menu', { id });

      expect(images).toHaveBeenCalledWith(auth, id, { zoom: false });
      expect(parse(result)).toEqual({
        id,
        title: 'Trattoria da Nino',
        restaurant: [{ name: 'Trattoria da Nino', confidence: 0.8 }],
        sections: ['PRIMI'],
        items: [
          { i: 0, name: 'Carbonara', price: '12,00', section: 'PRIMI' },
          { i: 1, name: 'Norma' },
          { i: 2, name: 'Cannolo' },
        ],
        ocr: 'tiles',
      });
      expect(result.content[1]).toEqual({
        type: 'image',
        data: Buffer.from('menu').toString('base64'),
        mimeType: 'image/jpeg',
      });
    });

    it('should zoom in when few items were read', async () => {
      const id = newUuid();
      vi.spyOn(FoodService.prototype, 'readMenu').mockResolvedValue(reading([]));
      const images = vi
        .spyOn(FoodService.prototype, 'getMenuImages')
        .mockResolvedValue([Buffer.from('whole'), Buffer.from('top'), Buffer.from('bottom')]);

      const result = await call('read_menu', { id });

      expect(images).toHaveBeenCalledWith(auth, id, { zoom: true });
      expect(result.content.filter(({ type }) => type === 'image')).toHaveLength(3);
    });
  });

  describe('match_dishes', () => {
    it('should return the suggestions and a captioned contact sheet', async () => {
      const [carbonara, bread] = [newUuid(), newUuid()];
      vi.spyOn(FoodService.prototype, 'matchMeal').mockResolvedValue({
        items: [{ index: 0, name: 'Carbonara', price: '12,00' }],
        dishes: [
          {
            assetIds: [carbonara],
            index: 0,
            name: 'Carbonara',
            score: 0.9,
            unsure: false,
            offMenu: 0.05,
            suggestions: [{ index: 0, name: 'Carbonara', score: 0.9 }],
          },
          { assetIds: [bread], score: 0, unsure: true, offMenu: 0.8, suggestions: [] },
        ],
        noEmbedding: [],
        warnings: [],
      });
      mocks.assetJob.getForAgent.mockResolvedValue([
        { id: carbonara, previewPath: '/carbonara.jpeg' },
        { id: bread, previewPath: '/bread.jpeg' },
      ] as never);
      mocks.media.createContactSheet.mockResolvedValue(Buffer.from('sheet'));

      const result = await call('match_dishes', { dishIds: [carbonara, bread], items: [{ name: 'Carbonara' }] });

      expect(parse(result)).toEqual({
        items: [{ i: 0, name: 'Carbonara', price: '12,00' }],
        dishes: [
          {
            assetIds: [carbonara],
            match: 'Carbonara',
            i: 0,
            score: 0.9,
            suggestions: [{ i: 0, name: 'Carbonara', score: 0.9 }],
          },
          { assetIds: [bread], match: null, score: 0, unsure: true, offMenu: 0.8, suggestions: [] },
        ],
        sheet: { 1: carbonara, 2: bread },
      });
      expect(mocks.media.createContactSheet).toHaveBeenCalledWith(
        [
          { input: '/carbonara.jpeg', label: '1', caption: 'Carbonara 90%' },
          { input: '/bread.jpeg', label: '2', caption: 'no menu item' },
        ],
        { tileSize: 320 },
      );
      expect(result.content[1]).toMatchObject({ type: 'image' });
    });
  });

  describe('lookup_restaurant', () => {
    it('should say when the lookup is disabled', async () => {
      const result = parse(await call('lookup_restaurant', { latitude: 37.85, longitude: 15.28 }));
      expect(result).toEqual({ enabled: false, message: expect.stringContaining('Ask the user') });
    });

    it('should list the places nearby', async () => {
      vi.spyOn(FoodService.prototype, 'lookupRestaurants').mockResolvedValue({
        enabled: true,
        latitude: 37.85,
        longitude: 15.28,
        radius: 75,
        places: [{ name: 'Trattoria da Nino', amenity: 'restaurant', distance: 14, osm: 'node/1' }],
      });

      const result = parse(await call('lookup_restaurant', { assetIds: [newUuid()] }));

      expect(result).toEqual({
        location: [37.85, 15.28],
        radius: 75,
        places: [{ name: 'Trattoria da Nino', amenity: 'restaurant', distance: 14 }],
      });
    });
  });

  describe('set_dish_names', () => {
    it('should report the named photos and the failures', async () => {
      const [dish, other] = [newUuid(), newUuid()];
      const setDishNames = vi.spyOn(FoodService.prototype, 'setDishNames').mockResolvedValue({
        restaurant: 'Nino',
        results: [
          { id: dish, success: true, tag: 'Food/Nino/Carbonara', description: 'Carbonara · Nino' },
          { id: other, success: false, error: 'no_permission' },
        ],
      });

      const result = parse(
        await call('set_dish_names', {
          restaurant: 'Nino',
          photos: [
            { id: dish, dish: 'Carbonara' },
            { id: other, menu: true },
          ],
        }),
      );

      expect(setDishNames).toHaveBeenCalledWith(auth, {
        restaurant: 'Nino',
        photos: [
          { id: dish, dish: 'Carbonara' },
          { id: other, menu: true },
        ],
      });
      expect(result).toEqual({
        restaurant: 'Nino',
        photos: [{ id: dish, tag: 'Food/Nino/Carbonara', description: 'Carbonara · Nino' }],
        failed: [{ id: other, error: 'no_permission' }],
      });
    });
  });
});

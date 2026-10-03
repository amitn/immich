import { WorkflowTrigger } from '@immich/plugin-sdk';
import { AssetType } from 'src/enum.js';
import {
  RuleActions,
  RuleActionsSchema,
  RuleAsset,
  RuleFilters,
  RuleFiltersSchema,
  RuleMethod,
  RuleTargets,
  buildWorkflowSteps,
  explainWorkflow,
  getRuleTrigger,
  getRuleWarnings,
  getUnsupportedFilters,
  isExactInSearch,
  matchesRuleFilters,
  parseWorkflowSteps,
  validateRule,
  withoutUnsupported,
} from 'src/utils/agent/workflow-rules.js';

const albumId = '0b0b0b0b-0000-4000-8000-000000000001';
const spaceId = '0b0b0b0b-0000-4000-8000-000000000002';
const tagId = '0b0b0b0b-0000-4000-8000-000000000003';

/** the structured filters and actions the agent passes for a request, as the tool input parses them */
const rule = (filters: Record<string, unknown>, actions: Record<string, unknown>) => ({
  filters: RuleFiltersSchema.parse(filters),
  actions: RuleActionsSchema.parse(actions),
});

const toWorkflow = (filters: RuleFilters, actions: RuleActions, targets: RuleTargets) => ({
  trigger: getRuleTrigger(filters),
  steps: buildWorkflowSteps(filters, targets, actions).map(({ method, config }) => ({ method, config })),
});

const valid = (filters: Record<string, unknown>, actions?: Record<string, unknown>) => {
  const parsed = rule(filters, actions ?? { album: 'A' });
  return validateRule(parsed.filters, parsed.actions);
};

/** the condition of a workflow with a single date filter */
const date = (startDate: object, endDate: object, recurring = false) =>
  explainWorkflow({
    trigger: WorkflowTrigger.AssetMetadataExtraction,
    enabled: true,
    steps: [{ method: RuleMethod.Date, config: { startDate, endDate, recurring } }],
  }).conditions[0];

const asset = (values: Partial<RuleAsset> = {}, exif: RuleAsset['exifInfo'] = {}): RuleAsset => ({
  originalFileName: 'Screenshot 2025-03-01.png',
  type: AssetType.Image,
  localDateTime: '2025-03-01T10:00:00.000Z',
  exifInfo: exif,
  ...values,
});

describe('smart album rules (#11)', () => {
  describe('example requests', () => {
    it('"screenshots from 2025" waits for the date of the photo, then fills a new album', () => {
      const { filters, actions } = rule(
        { fileName: { pattern: 'screenshot' }, takenFrom: '2025-01-01', takenTo: '2025-12-31' },
        { album: 'Screenshots 2025' },
      );

      expect(toWorkflow(filters, actions, { album: { id: null, name: 'Screenshots 2025' } })).toEqual({
        trigger: WorkflowTrigger.AssetMetadataExtraction,
        steps: [
          {
            method: 'immich-plugin-core#assetFileFilter',
            config: { pattern: 'screenshot', matchType: 'contains', caseSensitive: false },
          },
          {
            method: 'immich-plugin-core#assetDateFilter',
            config: {
              startDate: { year: 2025, month: 1, day: 1 },
              endDate: { year: 2025, month: 12, day: 31 },
              recurring: false,
            },
          },
          {
            method: 'immich-plugin-core#assetAddToAlbums',
            config: { albumIds: [], albumName: 'Screenshots 2025' },
          },
        ],
      });
    });

    it('"every dish from Italy" waits for the journal to name the dish', () => {
      const { filters, actions } = rule({ tags: ['Food'], place: { country: 'Italy' } }, { album: albumId });

      expect(toWorkflow(filters, actions, { album: { id: albumId, name: 'Italian food' } })).toEqual({
        trigger: WorkflowTrigger.AssetTagged,
        steps: [
          { method: 'immich-plugin-core#assetLocationFilter', config: { region: { country: 'Italy' } } },
          { method: 'gallery-core#assetTagPathFilter', config: { tag: 'Food', inverse: false } },
          {
            method: 'immich-plugin-core#assetAddToAlbums',
            config: { albumIds: [albumId], albumName: 'Italian food' },
          },
        ],
      });
    });

    it('"videos from Rome go to the Family space" adds them to the space', () => {
      const { filters, actions } = rule({ type: 'video', place: { city: 'Rome' } }, { space: 'Family' });

      expect(toWorkflow(filters, actions, { space: { id: spaceId, name: 'Family' } })).toEqual({
        trigger: WorkflowTrigger.AssetMetadataExtraction,
        steps: [
          { method: 'immich-plugin-core#assetTypeFilter', config: { allowedTypes: [AssetType.Video] } },
          { method: 'immich-plugin-core#assetLocationFilter', config: { region: { city: 'Rome' } } },
          { method: 'gallery-core#addToSpace', config: { spaceIds: [spaceId] } },
        ],
      });
    });

    it('"the wines of Noma go to the Trips album of the Family space" uses an album of the space', () => {
      const { filters, actions } = rule(
        { tags: ['/Wine / Noma/'] },
        { spaceAlbum: { space: 'Family', album: 'Trips' } },
      );

      expect(
        toWorkflow(filters, actions, { spaceAlbum: { spaceId, spaceName: 'Family', albumName: 'Trips' } }),
      ).toEqual({
        trigger: WorkflowTrigger.AssetTagged,
        steps: [
          { method: 'gallery-core#assetTagPathFilter', config: { tag: 'Wine/Noma', inverse: false } },
          { method: 'gallery-core#addToSpaceAlbum', config: { spaceId, albumName: 'Trips' } },
        ],
      });
    });

    it('"archive the screenshots I upload" runs at upload', () => {
      const { filters, actions } = rule({ fileName: { pattern: 'screenshot' } }, { archive: true });

      expect(toWorkflow(filters, actions, {})).toEqual({
        trigger: WorkflowTrigger.AssetCreate,
        steps: [
          {
            method: 'immich-plugin-core#assetFileFilter',
            config: { pattern: 'screenshot', matchType: 'contains', caseSensitive: false },
          },
          { method: 'immich-plugin-core#assetArchive', config: { inverse: false } },
        ],
      });
    });

    it('"photos of my Fuji near home, every Christmas" combine camera, place and a recurring date', () => {
      const { filters, actions } = rule(
        {
          camera: { make: 'Fujifilm', lens: 'XF23' },
          near: { latitude: 52.37, longitude: 4.89, radiusKm: 2 },
          takenFrom: '2000-12-24',
          takenTo: '2000-12-26',
          everyYear: true,
        },
        { favorite: true, addTags: ['Christmas'] },
      );

      expect(toWorkflow(filters, actions, { addTags: [{ id: tagId, value: 'Christmas' }] })).toEqual({
        trigger: WorkflowTrigger.AssetMetadataExtraction,
        steps: [
          {
            method: 'immich-plugin-core#assetDateFilter',
            config: {
              startDate: { year: 2000, month: 12, day: 24 },
              endDate: { year: 2000, month: 12, day: 26 },
              recurring: true,
            },
          },
          {
            method: 'immich-plugin-core#assetLocationFilter',
            config: { coordinate: { latitude: 52.37, longitude: 4.89, radius: 2 } },
          },
          {
            method: 'immich-plugin-core#assetExifFilter',
            config: { property: 'make', pattern: 'Fujifilm', matchType: 'contains', caseSensitive: false },
          },
          {
            method: 'immich-plugin-core#assetExifFilter',
            config: { property: 'lensModel', pattern: 'XF23', matchType: 'contains', caseSensitive: false },
          },
          { method: 'immich-plugin-core#assetAddTags', config: { tags: [tagId] } },
          { method: 'immich-plugin-core#assetFavorite', config: { inverse: false } },
        ],
      });
    });

    it('an open-ended date range uses the open ends of the core date filter', () => {
      const { filters, actions } = rule({ takenFrom: '2024-06-01' }, { album: 'Since June' });

      expect(buildWorkflowSteps(filters, { album: { id: null, name: 'Since June' } }, actions)[0]).toMatchObject({
        config: { startDate: { year: 2024, month: 6, day: 1 }, endDate: { year: 9999, month: 12, day: 31 } },
      });
    });
  });

  describe('unsupported filters', () => {
    it('"all photos of Mia at the beach" needs people and smart search, which workflows lack', () => {
      const { filters } = rule({ personIds: [albumId], query: 'at the beach' }, { album: 'Mia at the beach' });

      expect(getUnsupportedFilters(filters)).toEqual([
        { filter: 'personIds', reason: expect.stringMatching(/before the faces in it are recognized/) },
        { filter: 'query', reason: expect.stringMatching(/smart search/) },
      ]);
      expect(withoutUnsupported(filters)).toEqual({});
    });

    it('"every photo of Mia goes to the Family space" keeps the supported rest', () => {
      const { filters } = rule({ personIds: [albumId], takenFrom: '2025-01-01' }, { space: 'Family' });

      expect(getUnsupportedFilters(filters).map(({ filter }) => filter)).toEqual(['personIds']);
      expect(withoutUnsupported(filters)).toEqual({ takenFrom: '2025-01-01' });
    });

    it('albums and favorites are not filters of workflows', () => {
      const { filters } = rule({ albumId, favorite: true }, { album: 'x' });
      expect(getUnsupportedFilters(filters).map(({ filter }) => filter)).toEqual(['albumId', 'favorite']);
    });

    it('an empty list of people is no filter', () => {
      expect(getUnsupportedFilters({ personIds: [] })).toEqual([]);
    });
  });

  describe('validateRule', () => {
    it('accepts a valid rule', () => {
      expect(valid({ takenFrom: '2024-02-29', takenTo: '2024-03-01' })).toEqual([]);
    });

    it('rejects dates that do not exist, and a range that ends before it starts', () => {
      expect(valid({ takenFrom: '2025-02-30' })).toEqual(['takenFrom 2025-02-30 is not a date']);
      expect(valid({ takenFrom: '2025-06-01', takenTo: '2025-01-01' })).toEqual(['takenFrom is after takenTo']);
    });

    it('lets a recurring range wrap the new year, but needs both of its ends', () => {
      expect(valid({ takenFrom: '2000-12-30', takenTo: '2000-01-02', everyYear: true })).toEqual([]);
      expect(valid({ takenFrom: '2000-12-30', everyYear: true })).toEqual([
        'everyYear needs both takenFrom and takenTo',
      ]);
    });

    it('rejects an empty place or camera, a broken pattern, and a rule without an action', () => {
      expect(valid({ place: {}, camera: {}, fileName: { pattern: '(', match: 'regex' } }, {})).toEqual([
        'place needs a city, state or country',
        'camera needs a make, model or lens',
        'fileName.pattern is not a valid regular expression: (',
        'a workflow needs an action, e.g. album',
      ]);
    });

    it('rejects an empty tag', () => {
      expect(valid({ tags: ['Food', ' / '] })).toEqual(['a tag is empty']);
    });

    it('validates the shape of the input', () => {
      expect(RuleFiltersSchema.safeParse({ takenFrom: '1 Jan 2025' }).success).toBe(false);
      expect(RuleFiltersSchema.safeParse({ near: { latitude: 100, longitude: 0, radiusKm: 1 } }).success).toBe(false);
      expect(RuleFiltersSchema.safeParse({ fileName: { pattern: 'x', match: 'glob' } }).success).toBe(false);
      expect(RuleActionsSchema.safeParse({ archive: false }).success).toBe(false);
    });

    it('warns that a rule without a filter applies to every new photo', () => {
      expect(getRuleWarnings({})).toEqual([expect.stringMatching(/every new photo/)]);
      expect(getRuleWarnings({ type: 'video' })).toEqual([]);
    });
  });

  describe('parseWorkflowSteps', () => {
    it('reads back the rule a workflow was built from', () => {
      const { filters, actions } = rule(
        {
          fileName: { pattern: 'IMG_', match: 'startsWith', caseSensitive: true },
          type: 'image',
          takenFrom: '2025-01-01',
          place: { city: 'Rome', country: 'Italy' },
          tags: ['Food', 'Food/Noma'],
          camera: { model: 'X100' },
          missingTimeZone: false,
        },
        { album: albumId, addTags: ['Christmas'], archive: true },
      );
      const steps = buildWorkflowSteps(
        filters,
        { album: { id: albumId, name: 'Rome' }, addTags: [{ id: tagId, value: 'Christmas' }] },
        actions,
      );

      expect(parseWorkflowSteps(steps)).toEqual({
        filters,
        actions: { albumIds: [albumId], albumName: 'Rome', tagIds: [tagId], archive: true },
        other: [],
      });
    });

    it('keeps the steps a rule cannot express', () => {
      const webhook = { method: RuleMethod.Webhook, config: { url: 'https://example.com' } };
      const off = { method: RuleMethod.Archive, config: { inverse: false }, enabled: false };
      const path = { method: RuleMethod.FileName, config: { pattern: 'x', usePath: true } };
      const secondType = { method: RuleMethod.Type, config: { allowedTypes: ['VIDEO'] } };

      const parsed = parseWorkflowSteps([
        { method: RuleMethod.Type, config: { allowedTypes: ['IMAGE'] } },
        secondType,
        webhook,
        off,
        path,
        { method: RuleMethod.AddToSpace, config: { spaceIds: [spaceId] } },
      ]);

      expect(parsed.filters).toEqual({ type: 'image' });
      expect(parsed.actions).toEqual({ spaceIds: [spaceId] });
      expect(parsed.other).toEqual([secondType, webhook, off, path]);
    });

    it('reads the upstream templates', () => {
      expect(
        parseWorkflowSteps([
          { method: RuleMethod.MissingTimeZone, config: {} },
          { method: RuleMethod.Location, config: { region: { city: 'Vancouver', country: 'Canada' } } },
          { method: RuleMethod.AddToAlbums, config: { albumName: 'Missing time zone', albumIds: [] } },
        ]),
      ).toEqual({
        filters: { missingTimeZone: true, place: { city: 'Vancouver', country: 'Canada' } },
        actions: { albumIds: [], albumName: 'Missing time zone' },
        other: [],
      });
    });
  });

  describe('explainWorkflow', () => {
    const names = {
      albums: new Map([[albumId, 'Italian food']]),
      spaces: new Map([[spaceId, 'Family']]),
      tags: new Map([[tagId, 'Christmas']]),
      methods: new Map([['someone-plugin#resize', 'Resize']]),
    };

    it('says a smart album in one sentence', () => {
      const { filters, actions } = rule({ tags: ['Food'], place: { country: 'Italy' } }, { album: albumId });
      const workflow = {
        ...toWorkflow(filters, actions, { album: { id: albumId, name: 'Italian food' } }),
        enabled: true,
      };

      expect(explainWorkflow(workflow, names)).toEqual({
        summary:
          'When a photo or video gets a tag (e.g. when a journal names it), if it was taken in Italy and it has the ' +
          'tag "Food" or a tag under it: add it to the album "Italian food".',
        when: 'When a photo or video gets a tag (e.g. when a journal names it)',
        conditions: ['it was taken in Italy', 'it has the tag "Food" or a tag under it'],
        actions: ['add it to the album "Italian food"'],
        notes: [],
      });
    });

    it('names whole years, open ranges and recurring days', () => {
      expect(date({ year: 2025, month: 1, day: 1 }, { year: 2025, month: 12, day: 31 })).toBe('it was taken in 2025');
      expect(date({ year: 2024, month: 6, day: 1 }, { year: 9999, month: 12, day: 31 })).toBe(
        'it was taken on or after 1 June 2024',
      );
      expect(date({ year: 1900, month: 1, day: 1 }, { year: 2020, month: 3, day: 5 })).toBe(
        'it was taken on or before 5 March 2020',
      );
      expect(date({ year: 2000, month: 12, day: 24 }, { year: 2000, month: 12, day: 26 }, true)).toBe(
        'it was taken between 24 December and 26 December of any year',
      );
    });

    it('explains the actions of spaces, tags and other plugins, and what is wrong with a workflow', () => {
      const explanation = explainWorkflow(
        {
          trigger: WorkflowTrigger.AssetCreate,
          enabled: false,
          steps: [
            { method: RuleMethod.Location, config: { region: { city: 'Rome' } } },
            { method: RuleMethod.AddToSpaceAlbum, config: { spaceId, albumName: 'Trips' } },
            { method: RuleMethod.AddTags, config: { tags: [tagId, 'gone'] } },
            { method: 'someone-plugin#resize', config: {}, enabled: false },
          ],
        },
        names,
      );

      expect(explanation.actions).toEqual([
        'add it to the album "Trips" of the shared space "Family" (created there if needed)',
        'tag it "Christmas", a tag that no longer exists',
        'run the step "Resize" (this step is turned off)',
      ]);
      expect(explanation.notes).toEqual([
        expect.stringMatching(/turned off/),
        expect.stringMatching(/before the date, place and camera of the photo are read/),
      ]);
    });

    it('notes a workflow that changes nothing', () => {
      expect(explainWorkflow({ trigger: WorkflowTrigger.AssetCreate, enabled: true, steps: [] }).summary).toBe(
        'When a photo or video is uploaded: nothing happens.',
      );
    });
  });

  describe('matchesRuleFilters', () => {
    it('matches file names as the core plugin does', () => {
      expect(
        matchesRuleFilters(asset(), { fileName: { pattern: 'SCREENSHOT', match: 'contains', caseSensitive: false } }),
      ).toBe(true);
      expect(
        matchesRuleFilters(asset(), { fileName: { pattern: 'SCREENSHOT', match: 'contains', caseSensitive: true } }),
      ).toBe(false);
      expect(
        matchesRuleFilters(asset(), { fileName: { pattern: 'screenshot', match: 'startsWith', caseSensitive: false } }),
      ).toBe(true);
      expect(
        matchesRuleFilters(asset(), { fileName: { pattern: 'screenshot', match: 'exact', caseSensitive: false } }),
      ).toBe(false);
      expect(
        matchesRuleFilters(asset(), {
          fileName: { pattern: String.raw`\.png$`, match: 'regex', caseSensitive: false },
        }),
      ).toBe(true);
    });

    it('compares the local date of a photo with the days of the range, both ends included', () => {
      const filters = { takenFrom: '2025-01-01', takenTo: '2025-12-31' };
      expect(matchesRuleFilters(asset({ localDateTime: '2025-01-01T00:00:00.000Z' }), filters)).toBe(true);
      expect(matchesRuleFilters(asset({ localDateTime: '2025-12-31T23:59:59.000Z' }), filters)).toBe(true);
      expect(matchesRuleFilters(asset({ localDateTime: '2024-12-31T23:59:59.000Z' }), filters)).toBe(false);
      expect(matchesRuleFilters(asset({ localDateTime: new Date('2026-01-01T00:00:00.000Z') }), filters)).toBe(false);
    });

    it('matches a recurring range in any year, also across the new year', () => {
      const christmas = { takenFrom: '2000-12-24', takenTo: '2000-12-26', everyYear: true };
      expect(matchesRuleFilters(asset({ localDateTime: '2017-12-25T18:00:00.000Z' }), christmas)).toBe(true);
      expect(matchesRuleFilters(asset({ localDateTime: '2017-12-27T00:00:00.000Z' }), christmas)).toBe(false);

      const newYear = { takenFrom: '2000-12-31', takenTo: '2000-01-01', everyYear: true };
      expect(matchesRuleFilters(asset({ localDateTime: '2019-01-01T08:00:00.000Z' }), newYear)).toBe(true);
      expect(matchesRuleFilters(asset({ localDateTime: '2019-12-31T08:00:00.000Z' }), newYear)).toBe(true);
      expect(matchesRuleFilters(asset({ localDateTime: '2019-06-01T08:00:00.000Z' }), newYear)).toBe(false);
    });

    it('matches places exactly, distances, cameras as text, time zones and types', () => {
      const exif = {
        city: 'Rome',
        country: 'Italy',
        latitude: 41.9,
        longitude: 12.5,
        make: 'FUJIFILM',
        timeZone: null,
      };
      expect(matchesRuleFilters(asset({}, exif), { place: { country: 'Italy', city: 'Rome' } })).toBe(true);
      expect(matchesRuleFilters(asset({}, exif), { place: { country: 'italy' } })).toBe(false);
      expect(matchesRuleFilters(asset({}, exif), { near: { latitude: 41.89, longitude: 12.49, radiusKm: 2 } })).toBe(
        true,
      );
      expect(matchesRuleFilters(asset({}, exif), { near: { latitude: 45.46, longitude: 9.19, radiusKm: 100 } })).toBe(
        false,
      );
      expect(matchesRuleFilters(asset({}, {}), { near: { latitude: 41.9, longitude: 12.5, radiusKm: 100 } })).toBe(
        false,
      );
      expect(matchesRuleFilters(asset({}, exif), { camera: { make: 'fujifilm' } })).toBe(true);
      expect(matchesRuleFilters(asset({}, exif), { camera: { model: 'X100' } })).toBe(false);
      expect(matchesRuleFilters(asset({}, exif), { missingTimeZone: true })).toBe(true);
      expect(matchesRuleFilters(asset({}, exif), { missingTimeZone: false })).toBe(false);
      expect(matchesRuleFilters(asset({}, exif), { type: 'video' })).toBe(false);
      expect(matchesRuleFilters(asset({ exifInfo: null }), { type: 'image' })).toBe(true);
    });

    it('knows which rules the search applies exactly', () => {
      expect(isExactInSearch({ type: 'video', place: { country: 'Italy' }, tags: ['Food'] })).toBe(true);
      expect(isExactInSearch({ takenFrom: '2025-01-01' })).toBe(false);
      expect(isExactInSearch({ fileName: { pattern: 'x', match: 'contains', caseSensitive: false } })).toBe(false);
    });
  });
});

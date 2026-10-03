import { IntlMessageFormat } from 'intl-messageformat';
import { init, register, t, waitLocale, type MessageFormatter } from 'svelte-i18n';
import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { explainWorkflow } from '$lib/utils/workflow-explain';

const albumId = 'album-1';
const spaceId = 'space-1';
const names = {
  albums: new Map([[albumId, 'Italian food']]),
  spaces: new Map([[spaceId, 'Family']]),
  tags: new Map([['tag-1', 'Christmas']]),
  methodTitle: (method: string) => (method === 'someone#resize' ? 'Resize' : method),
};

describe('explainWorkflow (#11)', () => {
  let $t: MessageFormatter;

  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
    $t = get(t);
  });

  it('should say "every dish from Italy" in plain words', () => {
    expect(
      explainWorkflow(
        $t,
        {
          trigger: 'AssetTagged',
          enabled: true,
          steps: [
            { method: 'immich-plugin-core#assetLocationFilter', config: { region: { country: 'Italy' } } },
            { method: 'gallery-core#assetTagPathFilter', config: { tag: 'Food', inverse: false } },
            { method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [albumId], albumName: 'x' } },
          ],
        },
        names,
        'en-US',
      ),
    ).toEqual({
      when: 'When a photo or video gets a tag, e.g. when a journal names it',
      conditions: ['it was taken in Italy', 'it has the tag “Food” or a tag under it'],
      actions: ['add it to the album “Italian food”'],
      notes: [],
    });
  });

  it('should say "screenshots from 2025" and the album it creates', () => {
    const explanation = explainWorkflow(
      $t,
      {
        trigger: 'AssetMetadataExtraction',
        enabled: true,
        steps: [
          { method: 'immich-plugin-core#assetFileFilter', config: { pattern: 'screenshot', matchType: 'contains' } },
          {
            method: 'immich-plugin-core#assetDateFilter',
            config: { startDate: { year: 2025, month: 1, day: 1 }, endDate: { year: 2025, month: 12, day: 31 } },
          },
          { method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [], albumName: 'Screenshots 2025' } },
        ],
      },
      names,
      'en-US',
    );

    expect(explanation.when).toBe('When the date, place and camera of a new photo or video are read');
    expect(explanation.conditions).toEqual(['its file name contains “screenshot”', 'it was taken in 2025']);
    expect(explanation.actions).toEqual(['add it to the album “Screenshots 2025”, created if there is none']);
  });

  it('should name open, recurring and other date ranges', () => {
    const date = (startDate: object, endDate: object, recurring = false) =>
      explainWorkflow(
        $t,
        {
          trigger: 'AssetMetadataExtraction',
          enabled: true,
          steps: [{ method: 'immich-plugin-core#assetDateFilter', config: { startDate, endDate, recurring } }],
        },
        {},
        'en-US',
      ).conditions[0];

    expect(date({ year: 2024, month: 6, day: 1 }, { year: 9999, month: 12, day: 31 })).toBe(
      'it was taken on or after June 1, 2024',
    );
    expect(date({ year: 1900, month: 1, day: 1 }, { year: 2020, month: 3, day: 5 })).toBe(
      'it was taken on or before March 5, 2020',
    );
    expect(date({ year: 2000, month: 12, day: 24 }, { year: 2000, month: 12, day: 26 }, true)).toBe(
      'it was taken between December 24 and December 26, in any year',
    );
  });

  it('should explain spaces, other actions, steps that are off, and what is wrong with the workflow', () => {
    expect(
      explainWorkflow(
        $t,
        {
          trigger: 'AssetCreate',
          enabled: false,
          steps: [
            { method: 'immich-plugin-core#assetTypeFilter', config: { allowedTypes: ['VIDEO'] } },
            { method: 'immich-plugin-core#assetLocationFilter', config: { region: { city: 'Rome' } } },
            { method: 'gallery-core#addToSpace', config: { spaceIds: [spaceId, 'gone'] } },
            { method: 'gallery-core#addToSpaceAlbum', config: { spaceId, albumName: 'Trips' } },
            { method: 'immich-plugin-core#assetAddTags', config: { tags: ['tag-1'] } },
            { method: 'immich-plugin-core#assetArchive', config: { inverse: true }, enabled: false },
            { method: 'someone#resize', config: {} },
          ],
        },
        names,
        'en-US',
      ),
    ).toEqual({
      when: 'When a photo or video is uploaded',
      conditions: ['it is a video', 'it was taken in Rome'],
      actions: [
        'add it to the shared space “Family”, a space that no longer exists',
        'add it to the album “Trips” of the shared space “Family”',
        'tag it “Christmas”',
        'take it out of the archive (this step is turned off)',
        'run the step “Resize”',
      ],
      notes: [
        'The workflow is turned off, so it does nothing until you turn it on.',
        'It runs at upload, before the date, place and camera of a photo are read, so filters on them may not match yet.',
      ],
    });
  });

  it('should name a filter it has no sentence for by its title', () => {
    expect(
      explainWorkflow($t, {
        trigger: 'AssetCreate',
        enabled: true,
        steps: [{ method: 'immich-plugin-core#assetFileFilter', config: { pattern: 'x', usePath: true } }],
      }).conditions,
    ).toEqual(['it passes the filter “immich-plugin-core#assetFileFilter”']);
  });

  it('should have the messages in every locale the fork translates, with valid placeholders', () => {
    const en = JSON.parse(readFileSync('../i18n/en.json', 'utf8')) as Record<string, string>;
    const keys = Object.keys(en).filter(
      (key) =>
        key.startsWith('workflow_explain') ||
        key.startsWith('workflow_describe') ||
        ['activity_log_action_space_add_assets', 'activity_log_action_workflow_create'].includes(key),
    );
    expect(keys.length).toBeGreaterThan(30);

    for (const locale of ['de', 'fr', 'it', 'nl', 'pl', 'es', 'ru', 'zh_Hans', 'zh_Hant']) {
      const messages = JSON.parse(readFileSync(`../i18n/${locale}.json`, 'utf8')) as Record<string, string>;
      for (const key of keys) {
        expect(messages[key], `${locale} ${key}`).toBeTypeOf('string');
        const values = {
          kind: 'year',
          match: 'contains',
          inverse: 'true',
          matching: 'any',
          type: 'VIDEO',
          property: 'make',
          trigger: 'AssetTagged',
          tags: 'a',
          tag: 'a',
          album: 'a',
          space: 'a',
          step: 'a',
          url: 'a',
          name: 'a',
          id: 'a',
          pattern: 'a',
          start: 'a',
          end: 'a',
          place: 'a',
          text: 'a',
          radius: 2,
          latitude: 1,
          longitude: 2,
        };
        expect(() => new IntlMessageFormat(messages[key], locale.replace('_', '-')).format(values)).not.toThrow();
      }
    }
  });
});

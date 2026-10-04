import { getActiveTagPath, getExploreTags, getTagLink, getTagPathLink } from '$lib/utils/tag-links';

const tags = [
  { id: 'edits', value: 'Edits' },
  { id: 'enhanced', value: 'Edits/Enhanced' },
  { id: 'auto-food', value: 'Auto/Food' },
  { id: 'noma', value: 'Food/Noma Australia' },
  { id: 'dish', value: 'Food/Noma Australia/Wattleseed' },
];

describe('tag links', () => {
  it("should keep ours and noodle's Auto/ tags in the Explore row, by name, without the dishes", () => {
    expect(getExploreTags(tags).map(({ value }) => value)).toEqual([
      'Auto/Food',
      'Edits',
      'Edits/Enhanced',
      'Food/Noma Australia',
    ]);
  });

  it('should link a tag to the timeline filtered by it', () => {
    expect(getTagLink({ id: 'noma' })).toBe('/photos?tags=noma');
  });

  it('should link a node of the tag tree by its path, or to the Tags page while the tag is not known', () => {
    expect(getTagPathLink(tags, 'Edits/Enhanced')).toBe('/photos?tags=enhanced');
    expect(getTagPathLink([], 'Edits/Enhanced')).toBe('/tags?path=Edits%2FEnhanced');
  });

  it('should highlight the tag the timeline is filtered by, or the Tags page shows', () => {
    const url = (path: string) => new URL(path, 'http://localhost');
    expect(getActiveTagPath(url('/photos?tags=enhanced'), tags)).toBe('Edits/Enhanced');
    expect(getActiveTagPath(url('/photos/asset-1?tags=enhanced'), tags)).toBe('Edits/Enhanced');
    expect(getActiveTagPath(url('/photos?tags=enhanced%2Cnoma'), tags)).toBe('');
    expect(getActiveTagPath(url('/photos'), tags)).toBe('');
    expect(getActiveTagPath(url('/tags?path=Edits'), tags)).toBe('Edits');
    expect(getActiveTagPath(url('/albums?tags=enhanced'), tags)).toBe('');
  });
});

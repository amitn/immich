import { artStyles, buildArtPrompt, getArtStyle } from 'src/utils/agent/art-styles.js';

describe('art styles', () => {
  it('should have unique ids', () => {
    const ids = artStyles.map((style) => style.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should only use the caption placeholder in styles that declare it', () => {
    for (const style of artStyles) {
      expect(style.prompt.includes('{caption}')).toBe(style.usesCaption);
    }
  });

  it('should replace the caption', () => {
    const prompt = buildArtPrompt({ style: getArtStyle('watercolor-editorial-split'), caption: 'a quiet afternoon' });
    expect(prompt).toContain('reading "a quiet afternoon"');
    expect(prompt).not.toContain('{caption}');
  });

  it('should fall back to a default caption', () => {
    expect(buildArtPrompt({ style: getArtStyle('vintage-postcard') })).toContain('"summer days"');
  });

  it('should prefer a custom prompt', () => {
    expect(buildArtPrompt({ style: getArtStyle('watercolor'), prompt: 'make it {caption}', caption: 'blue' })).toBe(
      'make it blue',
    );
  });

  it('should require a style or prompt', () => {
    expect(() => buildArtPrompt({})).toThrow();
  });
});

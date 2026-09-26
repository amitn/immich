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

  it('should let the agent choose a caption when there is none', () => {
    for (const caption of [undefined, '', '  ']) {
      const prompt = buildArtPrompt({ style: getArtStyle('vintage-lithograph'), caption });
      expect(prompt).toContain('lettering a short caption of your choice');
      expect(prompt).not.toContain('{caption}');
      expect(prompt).not.toContain('"');
    }
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

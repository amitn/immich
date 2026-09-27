import {
  ART_PROMPT_LIMITS,
  artStyles,
  buildArtPrompt,
  checkArtPrompt,
  getArtStyle,
} from 'src/utils/agent/art-styles.js';

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

describe('checkArtPrompt', () => {
  const prompt =
    'Transform the reference photograph into a stained-glass window of the exact same scene. Preserve the ' +
    'recognizable composition, subjects, people, poses and perspective of the reference photograph. Bold lead ' +
    'lines, jewel-toned glass, light shining through. No text.';

  it.each(artStyles.map((style) => [style.id, style]))('should accept the built-in style %s as it is', (_, style) => {
    expect(checkArtPrompt(style.prompt, style)).toEqual({ errors: [], warnings: [] });
  });

  it('should accept a prompt written like the built-in ones', () => {
    expect(checkArtPrompt(prompt, { usesCaption: false })).toEqual({ errors: [], warnings: [] });
  });

  it('should limit the length', () => {
    expect(checkArtPrompt('Make it pretty', { usesCaption: false }).errors.join(' ')).toContain(
      `${ART_PROMPT_LIMITS.min} to ${ART_PROMPT_LIMITS.max} characters`,
    );
    expect(checkArtPrompt(prompt.repeat(20), { usesCaption: false }).errors).toHaveLength(1);
  });

  it('should only allow {caption}, and only with usesCaption', () => {
    expect(checkArtPrompt(prompt + ' Title "{caption}".', { usesCaption: false }).errors.join(' ')).toContain(
      'only replaced in styles with usesCaption',
    );
    expect(checkArtPrompt(prompt, { usesCaption: true }).errors.join(' ')).toContain('where the caption goes');
    expect(checkArtPrompt(prompt + ' Title "{caption}".', { usesCaption: true }).errors).toEqual([]);
    expect(checkArtPrompt(prompt + ' Signed {artist}.', { usesCaption: false }).errors.join(' ')).toContain(
      'Unknown placeholder {artist}',
    );
  });

  it('should remind to keep the subject recognizable', () => {
    const { errors, warnings } = checkArtPrompt(
      'A dreamy abstract composition of swirling colours and shapes inspired by the mood of a summer evening.',
      { usesCaption: false },
    );
    expect(errors).toEqual([]);
    expect(warnings.join(' ')).toContain('reference photograph');
    expect(warnings.join(' ')).toContain('recognizable');
  });

  it('should remind a photoAbove style to paint only the lower half', () => {
    expect(checkArtPrompt(prompt, { usesCaption: false, photoAbove: true }).warnings.join(' ')).toContain('lower half');
  });
});

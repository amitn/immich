export type ArtStyle = {
  id: string;
  name: string;
  description: string;
  /** image-generation prompt; `{caption}` is replaced with the caption, or a caption chosen by the agent */
  prompt: string;
  /** whether the style renders a handwritten caption into the image */
  usesCaption: boolean;
};

const WATERCOLOR_EDITORIAL_SPLIT =
  'Create a refined editorial travel-art composition based on the reference photograph. The image is divided vertically into two parts: the upper section is a realistic cinematic travel photograph, while the lower section transforms the exact same scene into a delicate hand-painted watercolor illustration. Upper section: authentic candid travel photography, natural daylight, soft shadows, subtle film grain, realistic textures, sophisticated European atmosphere, documentary-style composition, people naturally walking through the scene, beautiful architectural details, slightly muted elegant colors, high-end travel magazine photography. Lower section: a minimalist handmade watercolor painting of the exact same scene, preserving the recognizable composition, architecture, people, poses, perspective and major visual elements from the photograph. Loose translucent watercolor washes, delicate ink details, visible paper texture, soft edges, imperfect brushwork, subtle pigment bleeding, airy negative space, understated pastel tones, artistic but realistic. Leave generous warm ivory/off-white textured paper space surrounding the watercolor illustration. Add a small elegant handwritten caption near the bottom reading "{caption}", with a thin minimalist horizontal line underneath. Overall aesthetic: luxury travel journal, fine-art watercolor postcard, contemporary editorial design, nostalgic.';

export const artStyles: ArtStyle[] = [
  {
    id: 'watercolor-editorial-split',
    name: 'Editorial watercolor split',
    description:
      'Top half: the photo as cinematic travel photography. Bottom half: the same scene as a delicate watercolor on ivory paper, with a handwritten caption.',
    prompt: WATERCOLOR_EDITORIAL_SPLIT,
    usesCaption: true,
  },
  {
    id: 'watercolor',
    name: 'Watercolor',
    description: 'The whole scene as a loose, airy watercolor painting on textured paper.',
    prompt:
      'Transform the reference photograph into a delicate hand-painted watercolor illustration of the exact same scene. Preserve the composition, people, poses, perspective and recognizable details. Loose translucent washes, soft edges, subtle pigment bleeding, visible cold-press paper texture, airy negative space, understated natural palette. Fine-art, gallery quality. No text.',
    usesCaption: false,
  },
  {
    id: 'ink-travel-journal',
    name: 'Ink travel journal',
    description: 'A fine-liner ink sketch with light watercolor accents, like a page from a travel sketchbook.',
    prompt:
      'Redraw the reference photograph as a page from an illustrated travel sketchbook: confident fine-liner ink linework of the exact same scene, light watercolor accents in a few muted colors, visible off-white sketchbook paper, slightly imperfect hand-drawn perspective, generous margins. Add a small handwritten note "{caption}" in the corner.',
    usesCaption: true,
  },
  {
    id: 'pencil-sketch',
    name: 'Pencil sketch',
    description: 'A detailed graphite drawing with soft shading.',
    prompt:
      'Transform the reference photograph into a detailed graphite pencil drawing of the exact same scene. Preserve the composition, faces and proportions. Soft cross-hatching and blended shading, visible pencil strokes, white drawing paper, fine-art portfolio quality. No text.',
    usesCaption: false,
  },
  {
    id: 'oil-painting',
    name: 'Oil painting',
    description: 'A classic impressionist oil painting with visible brushstrokes.',
    prompt:
      'Transform the reference photograph into an impressionist oil painting of the exact same scene. Preserve the composition and people. Visible textured brushstrokes, rich but natural colors, soft natural light, canvas texture, museum-quality fine art. No text.',
    usesCaption: false,
  },
  {
    id: 'vintage-postcard',
    name: 'Vintage postcard',
    description: 'A mid-century illustrated travel postcard with a printed title.',
    prompt:
      'Transform the reference photograph into a mid-century illustrated travel postcard of the exact same scene: flat gouache-style shapes, limited warm color palette, subtle halftone print texture, slightly faded paper, rounded white border. Add a bold retro hand-lettered title "{caption}" at the bottom.',
    usesCaption: true,
  },
];

export const getArtStyle = (id: string) => artStyles.find((style) => style.id === id);

export const buildArtPrompt = ({
  style,
  prompt,
  caption,
}: {
  style?: ArtStyle;
  prompt?: string;
  caption?: string;
}): string => {
  const template = prompt || style?.prompt;
  if (!template) {
    throw new Error('Either a style or a prompt is required');
  }

  const text = caption?.trim() || 'summer days';
  return template.replaceAll('{caption}', () => text);
};

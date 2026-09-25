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
      'Transform the reference photograph into a delicate hand-painted watercolor illustration of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Loose translucent washes, soft edges, subtle pigment bleeding, visible cold-press paper texture, airy negative space, understated natural palette. Fine-art, gallery quality. No text.',
    usesCaption: false,
  },
  {
    id: 'gouache-travel-poster',
    name: 'Gouache travel poster',
    description: 'Flat, rich blocks of matte gouache color with slightly simplified shapes. Graphic and premium.',
    prompt:
      'Repaint the reference photograph as a gouache travel poster of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Flat, rich blocks of opaque matte pigment, slightly simplified shapes, crisp edges between color areas, subtle brush texture, a harmonious palette of 5 to 7 colors, strong graphic composition, premium print quality. Add an elegant hand-lettered poster title "{caption}" integrated into the design.',
    usesCaption: true,
  },
  {
    id: 'vintage-lithograph',
    name: 'Vintage lithograph',
    description: 'A 1920s–1950s travel poster: limited palette, soft grain, elegant simplification.',
    prompt:
      'Transform the reference photograph into a vintage 1920s to 1950s lithographic travel poster of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Limited palette of 4 to 6 inks, elegant simplification of forms, soft stone-lithography grain, gentle gradients, slightly aged cream paper, Art Deco sensibility, collectible museum-print quality. Add period-style lettering "{caption}" at the bottom.',
    usesCaption: true,
  },
  {
    id: 'colored-pencil-ink',
    name: 'Colored pencil + ink',
    description: 'Fine ink linework with layered colored pencil. Lots of texture and detail, handmade and personal.',
    prompt:
      'Redraw the reference photograph as a colored pencil and ink illustration of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Fine confident ink outlines, layered colored-pencil shading with visible directional strokes, rich texture and detail, warm off-white drawing paper showing through, handmade and personal feeling. No text.',
    usesCaption: false,
  },
  {
    id: 'pen-and-wash',
    name: 'Pen-and-wash sketch',
    description: 'Loose architectural travel-journal linework with restrained watercolor accents.',
    prompt:
      'Redraw the reference photograph as a pen-and-wash travel-journal sketch of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Loose, lively fine-liner linework with architectural confidence, restrained watercolor washes in a few muted colors, lots of white paper, slightly imperfect hand-drawn perspective, sketchbook page feeling. No text.',
    usesCaption: false,
  },
  {
    id: 'oil-pastel',
    name: 'Oil pastel',
    description: 'Soft, tactile and slightly dreamy, with creamy edges and expressive color.',
    prompt:
      'Transform the reference photograph into an oil pastel drawing of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Soft, tactile, creamy blended strokes, waxy texture, expressive saturated color, slightly dreamy atmosphere, visible toned paper grain at the edges. No text.',
    usesCaption: false,
  },
  {
    id: 'impressionist',
    name: 'Impressionist painting',
    description: 'Keeps the scene but emphasizes light, atmosphere and brushwork over precise detail.',
    prompt:
      'Transform the reference photograph into an impressionist oil painting of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Emphasize light, atmosphere and color over precise detail, broken visible brushstrokes, vibrant natural light, soft edges, canvas texture, in the spirit of late 19th-century plein-air painting. No text.',
    usesCaption: false,
  },
  {
    id: 'japanese-woodblock',
    name: 'Japanese woodblock',
    description: 'Simplified composition, clean outlines, flattened perspective and restrained colors.',
    prompt:
      'Transform the reference photograph into a Japanese ukiyo-e woodblock print of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Simplified composition, clean confident outlines, flattened perspective, restrained traditional pigments, bokashi gradient skies, subtle wood-grain and washi paper texture. No text, no seals.',
    usesCaption: false,
  },
  {
    id: 'cyanotype',
    name: 'Cyanotype',
    description: 'A monochrome Prussian-blue photographic print with a botanical, scientific feel.',
    prompt:
      'Transform the reference photograph into a cyanotype print of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Monochrome Prussian blue and white only, sun-print tonality with soft highlights, subtle brush marks at the edges of the coated area, textured watercolor paper, botanical and scientific archival feeling. No text.',
    usesCaption: false,
  },
  {
    id: 'vintage-polaroid',
    name: 'Vintage Polaroid',
    description: 'Still photographic, with faded colors, grain, light leaks and nostalgic imperfection.',
    prompt:
      'Recreate the reference photograph as a vintage instant photo on expired film. Keep it photographic and keep the exact same scene, people and framing. Faded, shifted colors, soft focus, visible grain, gentle light leaks, slightly lifted blacks, nostalgic imperfection, inside a classic white instant-film border. No text.',
    usesCaption: false,
  },
  {
    id: '35mm-editorial-film',
    name: '35mm editorial film',
    description: 'A subtle film look: muted Kodak/Fuji palette, grain, soft highlights, lifted blacks.',
    prompt:
      'Regrade the reference photograph as 35mm editorial film photography. Keep it photographic and keep the exact same scene, people and framing. Muted Kodak Portra and Fuji-like palette, visible fine film grain, soft rolled-off highlights, slightly lifted blacks, gentle halation, magazine-quality subtlety rather than a painted look. No text, no borders.',
    usesCaption: false,
  },
  {
    id: 'risograph',
    name: 'Risograph print',
    description:
      '2–4 overlapping ink colors, halftone texture and slight misregistration. A contemporary art-book look.',
    prompt:
      'Transform the reference photograph into a risograph print of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Two to four overlapping spot ink colors, visible halftone and grain texture, slight misregistration between layers, flat uncoated paper, contemporary art-book aesthetic. No text.',
    usesCaption: false,
  },
  {
    id: 'linocut',
    name: 'Linocut',
    description: 'Bold handmade contours and reduced detail. Striking for trees, landscapes and buildings.',
    prompt:
      'Transform the reference photograph into a linocut block print of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Bold carved contours, reduced detail, expressive gouge marks, one or two ink colors on textured paper, slightly uneven ink coverage, handmade printmaking character. No text.',
    usesCaption: false,
  },
  {
    id: 'charcoal-pastel',
    name: 'Charcoal + pastel',
    description: 'Atmospheric and sophisticated: charcoal structure with selective muted color.',
    prompt:
      'Transform the reference photograph into a charcoal and soft pastel drawing of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Atmospheric charcoal structure and smudged shadows, selective muted pastel color accents, visible paper tooth, sophisticated fine-art studio feeling. No text.',
    usesCaption: false,
  },
  {
    id: 'graphite-field-sketch',
    name: 'Graphite field sketch',
    description: 'Mostly monochrome pencil with one or two colored accents. Refined and minimal.',
    prompt:
      'Redraw the reference photograph as a refined graphite field sketch of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Mostly monochrome pencil with delicate hatching and generous white space, with just one or two subtle colored accents on the key subject, naturalist sketchbook feeling. No text.',
    usesCaption: false,
  },
  {
    id: 'cut-paper-collage',
    name: 'Cut-paper collage',
    description: 'Layered paper shapes with visible fibers and shadows. Playful but elegant.',
    prompt:
      'Transform the reference photograph into a cut-paper collage of the exact same scene. Preserve the recognizable composition, subjects, people, poses and perspective of the reference photograph. Layered hand-cut paper shapes, visible paper fibers and torn edges, soft drop shadows between layers giving gentle depth, a refined harmonious palette, playful but elegant. No text.',
    usesCaption: false,
  },
  {
    id: 'botanical-plate',
    name: 'Botanical plate',
    description: 'A natural-history plate: detailed subject on warm paper with fine annotations.',
    prompt:
      'Transform the reference photograph into a botanical and natural-history illustration plate of its main subject. Keep the subject recognizable and anatomically faithful. Detailed scientific-illustration rendering in fine ink and watercolor, the subject isolated on warm aged paper, restrained palette, small numbered detail studies, fine handwritten annotations, and an elegant caption "{caption}" in period typography.',
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

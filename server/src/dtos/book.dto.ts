import z from 'zod';

export const NormalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1).describe('Left edge, as a fraction of the image width'),
    y: z.number().min(0).max(1).describe('Top edge, as a fraction of the image height'),
    width: z.number().gt(0).max(1).describe('Width, as a fraction of the image width'),
    height: z.number().gt(0).max(1).describe('Height, as a fraction of the image height'),
  })
  .refine((rect) => rect.x + rect.width <= 1.0001 && rect.y + rect.height <= 1.0001, {
    error: 'Rectangle must be inside the image',
  })
  .describe('Rectangle normalized to the 0..1 range of the source image')
  .meta({ id: 'NormalizedRect' });

export type NormalizedRect = z.infer<typeof NormalizedRectSchema>;

export const BookStyleSchema = z
  .object({
    marginMm: z.number().min(0).max(50).describe('Outer page margin in millimeters'),
    gutterMm: z.number().min(0).max(30).describe('Space between photos in millimeters'),
    background: z.string().describe('Page background color (CSS color)'),
    textColor: z.string().describe('Caption and title color (CSS color)'),
    fontFamily: z.string().describe('Font family used for captions and titles'),
  })
  .describe('Visual style of a book')
  .meta({ id: 'BookStyle' });

export type BookStyle = z.infer<typeof BookStyleSchema>;

export const defaultBookStyle: BookStyle = Object.freeze({
  marginMm: 12,
  gutterMm: 4,
  background: '#ffffff',
  textColor: '#222222',
  fontFamily: 'serif',
});

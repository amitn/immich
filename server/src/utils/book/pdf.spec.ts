import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { createBookPdf, getPdfPageSize } from 'src/utils/book/pdf.js';

describe('getPdfPageSize', () => {
  it('should convert millimeters to points', () => {
    const { width, height } = getPdfPageSize({ pageWidthMm: 210, pageHeightMm: 297 });
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);
  });

  it('should handle square pages', () => {
    expect(getPdfPageSize({ pageWidthMm: 254, pageHeightMm: 254 })).toEqual({ width: 720, height: 720 });
  });
});

const jpeg = (background: string) =>
  sharp({ create: { width: 210, height: 150, channels: 3, background } })
    .jpeg({ quality: 90 })
    .toBuffer();

async function* pages() {
  yield await jpeg('#ff0000');
  yield await jpeg('#0000ff');
}

describe('createBookPdf', () => {
  it('should create a PDF with one page per image and the exact page size', async () => {
    const pdf = await createBookPdf(
      pages(),
      { pageWidthMm: 210, pageHeightMm: 150 },
      { title: 'My book', subject: 'Sub' },
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBe(2);
    expect(document.getTitle()).toBe('My book');
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      expect(width).toBeCloseTo((210 * 72) / 25.4, 3);
      expect(height).toBeCloseTo((150 * 72) / 25.4, 3);
    }
  });

  it('should reject images that are not JPEG', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
    await expect(createBookPdf([png], { pageWidthMm: 100, pageHeightMm: 100 }, { title: 'x' })).rejects.toThrow();
  });
});

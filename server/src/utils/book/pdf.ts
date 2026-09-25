import { PDFDocument } from 'pdf-lib';
import { PageSize, mmToPt } from 'src/utils/book/layouts.js';

/** PDF page size in points (1/72 inch) */
export const getPdfPageSize = (size: PageSize) => ({
  width: mmToPt(size.pageWidthMm),
  height: mmToPt(size.pageHeightMm),
});

/** Builds a PDF with one full-page JPEG per page; pages are consumed one at a time */
export const createBookPdf = async (
  pages: AsyncIterable<Buffer> | Iterable<Buffer>,
  size: PageSize,
  metadata: { title: string; subject?: string | null },
): Promise<Buffer> => {
  const document = await PDFDocument.create();
  document.setTitle(metadata.title);
  if (metadata.subject) {
    document.setSubject(metadata.subject);
  }
  document.setCreator('Immich');
  document.setProducer('Immich');

  const { width, height } = getPdfPageSize(size);
  for await (const jpeg of pages) {
    const image = await document.embedJpg(jpeg);
    const page = document.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }

  return Buffer.from(await document.save());
};

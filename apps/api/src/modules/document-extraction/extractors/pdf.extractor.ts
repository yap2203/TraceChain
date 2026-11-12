import { MAX_EXTRACTED_TEXT_LENGTH, MAX_PDF_PAGES } from '../document-extraction.schema.js';
import { DocumentContentError } from '../document-extraction.errors.js';
import type { DocumentTextExtractor, ExtractedDocumentText } from '../document-extraction.types.js';

interface PdfTextItem {
  str?: string;
  transform?: number[];
}

export class PdfTextExtractor implements DocumentTextExtractor {
  async extract(buffer: Buffer): Promise<ExtractedDocumentText> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    try {
      const document = await loadingTask.promise;
      if (document.numPages > MAX_PDF_PAGES) {
        throw new DocumentContentError(
          'DOCUMENT_LIMIT_EXCEEDED',
          `PDF documents must not exceed ${MAX_PDF_PAGES} pages.`,
        );
      }
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(reconstructLines(content.items as PdfTextItem[]));
        page.cleanup();
      }
      const text = pages.join('\n').trim();
      if (text.length > MAX_EXTRACTED_TEXT_LENGTH) {
        throw new DocumentContentError(
          'DOCUMENT_LIMIT_EXCEEDED',
          'The extracted PDF text exceeds the supported processing limit.',
        );
      }
      if (text.replace(/\s/g, '').length < 12) {
        throw new ScannedPdfUnsupportedError();
      }
      return { pageCount: document.numPages, text, warnings: [] };
    } finally {
      await loadingTask.destroy();
    }
  }
}

export class ScannedPdfUnsupportedError extends Error {
  constructor() {
    super(
      'This PDF does not contain enough extractable text. Upload its pages as PNG or JPG for local OCR, or enter the values manually.',
    );
  }
}

function reconstructLines(items: PdfTextItem[]) {
  const positioned = items
    .filter((item) => item.str?.trim())
    .map((item, index) => ({
      index,
      text: item.str!.trim(),
      x: item.transform?.[4] ?? index,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((left, right) => (Math.abs(right.y - left.y) > 2 ? right.y - left.y : left.x - right.x));
  const lines: Array<{ y: number; items: typeof positioned }> = [];
  for (const item of positioned) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines
    .map((line) =>
      line.items
        .sort((left, right) => left.x - right.x)
        .map((item) => item.text)
        .join('\t'),
    )
    .join('\n');
}

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { imageSize } from 'image-size';
import { createWorker, OEM } from 'tesseract.js';

import { DocumentContentError } from '../document-extraction.errors.js';
import {
  MAX_EXTRACTED_TEXT_LENGTH,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
} from '../document-extraction.schema.js';
import type { DocumentTextExtractor, ExtractedDocumentText } from '../document-extraction.types.js';

const require = createRequire(import.meta.url);

export class ImageOcrExtractor implements DocumentTextExtractor {
  async extract(buffer: Buffer): Promise<ExtractedDocumentText> {
    const dimensions = imageSize(buffer);
    const width = dimensions.width ?? 0;
    const height = dimensions.height ?? 0;
    if (
      !width ||
      !height ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      throw new DocumentContentError(
        'DOCUMENT_LIMIT_EXCEEDED',
        `Images must not exceed ${MAX_IMAGE_DIMENSION} pixels per side or ${MAX_IMAGE_PIXELS.toLocaleString()} total pixels.`,
      );
    }

    const languageRoot = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      cacheMethod: 'none',
      langPath: join(languageRoot, '4.0.0_best_int'),
    });
    try {
      const result = await worker.recognize(buffer);
      const text = result.data.text.trim();
      if (!text)
        throw new DocumentContentError(
          'DOCUMENT_TEXT_NOT_FOUND',
          'No readable text was found in the image. Enter the values manually instead.',
        );
      if (text.length > MAX_EXTRACTED_TEXT_LENGTH)
        throw new DocumentContentError(
          'DOCUMENT_LIMIT_EXCEEDED',
          'The extracted image text exceeds the supported processing limit.',
        );
      return {
        text,
        warnings:
          result.data.confidence < 75
            ? ['Image OCR confidence is low. Review all extracted values carefully.']
            : [],
      };
    } finally {
      await worker.terminate();
    }
  }
}

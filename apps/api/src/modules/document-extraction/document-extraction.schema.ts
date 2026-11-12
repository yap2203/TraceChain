import { extname } from 'node:path';

import { z } from 'zod';

import type { SupportedDocumentFormat, UploadedDocument } from './document-extraction.types.js';

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;
export const MAX_IMAGE_DIMENSION = 12_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_EXTRACTED_TEXT_LENGTH = 2_000_000;

const extensionFormats: Record<string, SupportedDocumentFormat> = {
  '.docx': 'docx',
  '.jpeg': 'jpeg',
  '.jpg': 'jpeg',
  '.pdf': 'pdf',
  '.png': 'png',
};

const mimeFormats: Record<string, SupportedDocumentFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
};

const uploadSchema = z.object({
  buffer: z.instanceof(Buffer),
  mimeType: z.string().trim().min(1).max(160),
  originalName: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_DOCUMENT_SIZE),
});

export function validateUploadMetadata(input: UploadedDocument) {
  const upload = uploadSchema.parse(input);
  const extension = extname(upload.originalName).toLowerCase();
  const extensionFormat = extensionFormats[extension];
  if (!extensionFormat) {
    throw new Error(
      'Choose a PDF, DOCX, PNG or JPG/JPEG file. Legacy DOC and macro-enabled files are not supported.',
    );
  }
  const mimeFormat = mimeFormats[upload.mimeType.toLowerCase()];
  if (!mimeFormat || mimeFormat !== extensionFormat) {
    throw new Error('The document extension and declared content type do not match.');
  }
  return { extensionFormat, upload };
}

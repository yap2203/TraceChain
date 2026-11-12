import { basename } from 'node:path';

import { fileTypeFromBuffer } from 'file-type';

import type { IngredientBatchService } from '../ingredient-batches/ingredient-batch.service.js';
import { DocumentContentError } from './document-extraction.errors.js';
import { validateUploadMetadata } from './document-extraction.schema.js';
import type {
  DocumentExtractionResult,
  DocumentTextExtractor,
  SupportedDocumentFormat,
  UploadedDocument,
} from './document-extraction.types.js';
import { DocxTextExtractor } from './extractors/docx.extractor.js';
import { ImageOcrExtractor } from './extractors/image-ocr.extractor.js';
import { PdfTextExtractor, ScannedPdfUnsupportedError } from './extractors/pdf.extractor.js';
import { mapIngredientFields } from './mapping/ingredient-field.mapper.js';

export class DocumentExtractionApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Dependencies {
  access: Pick<IngredientBatchService, 'requireSupplierDocumentAccess'>;
  detectFileType?: typeof fileTypeFromBuffer;
  extractors?: Record<SupportedDocumentFormat, DocumentTextExtractor>;
  mapper?: typeof mapIngredientFields;
}

export class DocumentExtractionService {
  private readonly detectFileType: typeof fileTypeFromBuffer;
  private readonly extractors: Record<SupportedDocumentFormat, DocumentTextExtractor>;
  private readonly mapper: typeof mapIngredientFields;

  constructor(private readonly dependencies: Dependencies) {
    this.detectFileType = dependencies.detectFileType ?? fileTypeFromBuffer;
    this.extractors =
      dependencies.extractors ??
      ({
        docx: new DocxTextExtractor(),
        jpeg: new ImageOcrExtractor(),
        pdf: new PdfTextExtractor(),
        png: new ImageOcrExtractor(),
      } satisfies Record<SupportedDocumentFormat, DocumentTextExtractor>);
    this.mapper = dependencies.mapper ?? mapIngredientFields;
  }

  async extract(
    sessionId: string | undefined,
    input: UploadedDocument,
  ): Promise<DocumentExtractionResult> {
    await this.dependencies.access.requireSupplierDocumentAccess(sessionId);
    let declared: ReturnType<typeof validateUploadMetadata>;
    try {
      declared = validateUploadMetadata(input);
    } catch (error) {
      throw new DocumentExtractionApiError(
        'UNSUPPORTED_DOCUMENT',
        error instanceof Error ? error.message : 'The document is not supported.',
        400,
      );
    }

    const detected = await this.detectFileType(input.buffer);
    const detectedFormat = detected ? detectedFormatFromExtension(detected.ext) : undefined;
    if (!detectedFormat || detectedFormat !== declared.extensionFormat) {
      throw new DocumentExtractionApiError(
        'DOCUMENT_TYPE_MISMATCH',
        'The file contents do not match its extension and content type.',
        400,
      );
    }

    try {
      const extracted = await this.extractors[detectedFormat].extract(input.buffer);
      const mapped = this.mapper(
        extracted.text,
        detectedFormat === 'png' || detectedFormat === 'jpeg' ? 'ocr' : 'document',
      );
      return {
        document: {
          filename: safeFilename(input.originalName),
          format: detectedFormat,
          mimeType: declared.upload.mimeType,
          ...(extracted.pageCount ? { pageCount: extracted.pageCount } : {}),
          size: input.size,
        },
        fields: mapped.fields,
        warnings: [...new Set([...extracted.warnings, ...mapped.warnings])],
      };
    } catch (error) {
      if (error instanceof ScannedPdfUnsupportedError) {
        throw new DocumentExtractionApiError('SCANNED_PDF_UNSUPPORTED', error.message, 422);
      }
      if (error instanceof DocumentContentError) {
        throw new DocumentExtractionApiError(error.code, error.message, 422);
      }
      if (error instanceof DocumentExtractionApiError) throw error;
      throw new DocumentExtractionApiError(
        'DOCUMENT_EXTRACTION_FAILED',
        'The document could not be processed safely. Check that it is not password-protected or corrupted, then try again or enter the values manually.',
        422,
      );
    }
  }
}

function detectedFormatFromExtension(extension: string): SupportedDocumentFormat | undefined {
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'png' || extension === 'pdf' || extension === 'docx') return extension;
  return undefined;
}

function safeFilename(filename: string) {
  return basename(filename)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 255);
}

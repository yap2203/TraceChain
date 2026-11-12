import mammoth from 'mammoth';

import { DocumentContentError } from '../document-extraction.errors.js';
import { MAX_EXTRACTED_TEXT_LENGTH } from '../document-extraction.schema.js';
import type { DocumentTextExtractor, ExtractedDocumentText } from '../document-extraction.types.js';

export class DocxTextExtractor implements DocumentTextExtractor {
  async extract(buffer: Buffer): Promise<ExtractedDocumentText> {
    validateDocxArchive(buffer);
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (!text)
      throw new DocumentContentError(
        'DOCUMENT_TEXT_NOT_FOUND',
        'The DOCX document does not contain extractable text.',
      );
    if (text.length > MAX_EXTRACTED_TEXT_LENGTH)
      throw new DocumentContentError(
        'DOCUMENT_LIMIT_EXCEEDED',
        'The extracted DOCX text exceeds the supported processing limit.',
      );
    return {
      text,
      warnings: result.messages.map(
        () => 'Some DOCX content could not be represented as plain text.',
      ),
    };
  }
}

const MAX_DOCX_ENTRIES = 500;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

function validateDocxArchive(buffer: Buffer) {
  if (buffer.length < 22) throw unsafeDocx();
  const endSearch = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= endSearch; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw unsafeDocx();
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  let offset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount > MAX_DOCX_ENTRIES || offset + directorySize > buffer.length) throw unsafeDocx();

  let totalUncompressed = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw unsafeDocx();
    const flags = buffer.readUInt16LE(offset + 8);
    if ((flags & 1) !== 0)
      throw new DocumentContentError(
        'PASSWORD_PROTECTED_DOCUMENT',
        'Password-protected documents are not supported.',
      );
    totalUncompressed += buffer.readUInt32LE(offset + 24);
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw unsafeDocx();
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + filenameLength + extraLength + commentLength;
  }
}

function unsafeDocx() {
  return new DocumentContentError(
    'UNSAFE_DOCX_ARCHIVE',
    'The DOCX archive is invalid or exceeds the safe processing limit.',
  );
}

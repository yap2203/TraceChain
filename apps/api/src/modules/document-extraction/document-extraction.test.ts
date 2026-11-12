import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FileTypeResult } from 'file-type';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { AuthError } from '../auth/auth.service.js';
import { IngredientBatchApiError } from '../ingredient-batches/ingredient-batch.service.js';
import { MAX_DOCUMENT_SIZE } from './document-extraction.schema.js';
import { DocumentExtractionService } from './document-extraction.service.js';
import type {
  DocumentTextExtractor,
  SupportedDocumentFormat,
} from './document-extraction.types.js';
import { mapIngredientFields } from './mapping/ingredient-field.mapper.js';

const COOKIE = 'tracechain_session=test-session';
const COMPLETE_TEXT = `
Ingredient Name: Cocoa Powder
Batch No: COCOA-2026-001
Category: Cocoa
Country of Origin: Ghana
MFG Date: 2026-10-01
EXP Date: 2030-01-01
Quantity: 500 kg
Indicative Price: MYR 12.50
Certification: Organic, Halal
Allergens: None
`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Supplier ingredient document extraction API', () => {
  it.each([
    ['pdf', 'application/pdf', 'supply.pdf'],
    [
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'supply.docx',
    ],
  ] as const)('extracts labelled text from a valid %s document', async (format, mime, filename) => {
    const { app, access, extractor } = testApp(format, COMPLETE_TEXT);
    const response = await request(app)
      .post('/api/ingredients/extract-document')
      .set('Cookie', COOKIE)
      .attach('document', Buffer.from('valid document bytes'), { contentType: mime, filename })
      .expect(200);

    expect(response.body.document).toMatchObject({ filename, format, mimeType: mime });
    expect(response.body.fields).toMatchObject({
      batchReference: { confidence: 'High', value: 'COCOA-2026-001' },
      ingredientName: { confidence: 'High', value: 'Cocoa Powder' },
      origin: { confidence: 'High', value: 'Ghana' },
      quantity: { confidence: 'High', value: '500' },
      unit: { confidence: 'High', value: 'kg' },
    });
    expect(access).toHaveBeenCalledWith('test-session');
    expect(extractor).toHaveBeenCalledOnce();
  });

  it.each([
    ['png', 'image/png', 'label.png'],
    ['jpeg', 'image/jpeg', 'label.jpg'],
  ] as const)(
    'uses local OCR output for %s and marks values for review',
    async (format, mime, filename) => {
      const { app } = testApp(format, COMPLETE_TEXT, ['Image OCR confidence is low.']);
      const response = await request(app)
        .post('/api/ingredients/extract-document')
        .set('Cookie', COOKIE)
        .attach('document', Buffer.from('valid image bytes'), { contentType: mime, filename })
        .expect(200);

      expect(response.body.fields.ingredientName).toEqual({
        confidence: 'Review required',
        value: 'Cocoa Powder',
      });
      expect(response.body.warnings).toContain('Image OCR confidence is low.');
    },
  );

  it('rejects unsupported file types and MIME or extension mismatches', async () => {
    const unsupported = testApp('pdf', COMPLETE_TEXT).app;
    const unsupportedResponse = await request(unsupported)
      .post('/api/ingredients/extract-document')
      .set('Cookie', COOKIE)
      .attach('document', Buffer.from('plain text'), {
        contentType: 'text/plain',
        filename: 'supply.txt',
      })
      .expect(400);
    expect(unsupportedResponse.body.error.code).toBe('UNSUPPORTED_DOCUMENT');

    const mismatch = testApp('png', COMPLETE_TEXT).app;
    const mismatchResponse = await request(mismatch)
      .post('/api/ingredients/extract-document')
      .set('Cookie', COOKIE)
      .attach('document', Buffer.from('png bytes'), {
        contentType: 'application/pdf',
        filename: 'supply.pdf',
      })
      .expect(400);
    expect(mismatchResponse.body.error.code).toBe('DOCUMENT_TYPE_MISMATCH');
  });

  it('rejects documents over 10 MB before extraction', async () => {
    const { app, extractor } = testApp('pdf', COMPLETE_TEXT);
    const response = await request(app)
      .post('/api/ingredients/extract-document')
      .set('Cookie', COOKIE)
      .attach('document', Buffer.alloc(MAX_DOCUMENT_SIZE + 1), {
        contentType: 'application/pdf',
        filename: 'large.pdf',
      })
      .expect(413);
    expect(response.body.error.code).toBe('DOCUMENT_TOO_LARGE');
    expect(extractor).not.toHaveBeenCalled();
  });

  it('requires a SIWE session and current Supplier authorization', async () => {
    const unauthenticated = testApp('pdf', COMPLETE_TEXT, [], async () => {
      throw new AuthError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
    }).app;
    const missingSession = await request(unauthenticated)
      .post('/api/ingredients/extract-document')
      .attach('document', Buffer.from('pdf bytes'), {
        contentType: 'application/pdf',
        filename: 'supply.pdf',
      })
      .expect(401);
    expect(missingSession.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    const wrongRole = testApp('pdf', COMPLETE_TEXT, [], async () => {
      throw new IngredientBatchApiError(
        'SUPPLIER_AUTHORIZATION_REQUIRED',
        'Current on-chain Supplier authorization is required.',
        403,
      );
    }).app;
    const forbidden = await request(wrongRole)
      .post('/api/ingredients/extract-document')
      .set('Cookie', COOKIE)
      .attach('document', Buffer.from('pdf bytes'), {
        contentType: 'application/pdf',
        filename: 'supply.pdf',
      })
      .expect(403);
    expect(forbidden.body.error.code).toBe('SUPPLIER_AUTHORIZATION_REQUIRED');
  });

  it('returns missing confidence without inventing absent values', async () => {
    const { app } = testApp('pdf', 'Batch Number: LOT-42\nOrigin: Malaysia');
    const response = await request(app)
      .post('/api/ingredients/extract-document')
      .set('Cookie', COOKIE)
      .attach('document', Buffer.from('pdf bytes'), {
        contentType: 'application/pdf',
        filename: 'partial.pdf',
      })
      .expect(200);
    expect(response.body.fields.batchReference).toEqual({ confidence: 'High', value: 'LOT-42' });
    expect(response.body.fields.ingredientName).toEqual({ confidence: 'Missing', value: '' });
    expect(response.body.fields.quantity).toEqual({ confidence: 'Missing', value: '' });
  });

  it('maps aliases and rejects invalid dates, quantities, units and currencies', () => {
    const result = mapIngredientFields(`
      Product Name: Cocoa Mass
      Lot No: LOT-99
      Produced In: Malaysia
      Manufactured On: 2030-05-10
      Best Before: 2029-05-10
      Quantity: -4 tonnes
      Price: XYZ 4.00
    `);
    expect(result.fields.ingredientName.value).toBe('Cocoa Mass');
    expect(result.fields.batchReference.value).toBe('LOT-99');
    expect(result.fields.origin.value).toBe('Malaysia');
    expect(result.fields.expiryDate).toEqual({ confidence: 'Missing', value: '' });
    expect(result.fields.quantity).toEqual({ confidence: 'Missing', value: '' });
    expect(result.fields.unit).toEqual({ confidence: 'Missing', value: '' });
    expect(result.fields.currency).toEqual({ confidence: 'Missing', value: '' });
    expect(result.warnings.join(' ')).toMatch(/Quantity|currency|Expiry/);
  });

  it('processes in memory, creates no temporary files and returns no registration side effects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-document-extraction-'));
    try {
      vi.stubEnv('TEMP', directory);
      vi.stubEnv('TMP', directory);
      const { app } = testApp('pdf', COMPLETE_TEXT);
      const response = await request(app)
        .post('/api/ingredients/extract-document')
        .set('Cookie', COOKIE)
        .attach('document', Buffer.from('pdf bytes'), {
          contentType: 'application/pdf',
          filename: 'supply.pdf',
        })
        .expect(200);
      expect(await readdir(directory)).toEqual([]);
      expect(response.body).not.toHaveProperty('transaction');
      expect(response.body).not.toHaveProperty('credential');
      expect(JSON.stringify(response.body)).not.toMatch(
        /registerIngredient|issueCredential|calldata/i,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function testApp(
  format: SupportedDocumentFormat,
  text: string,
  warnings: string[] = [],
  authorize: () => Promise<unknown> = async () => ({ supplierWallet: '0x2' }),
) {
  const access = vi.fn(authorize);
  const extractor = vi.fn(async () => ({ text, warnings }));
  const extractors = {
    docx: { extract: extractor },
    jpeg: { extract: extractor },
    pdf: { extract: extractor },
    png: { extract: extractor },
  } satisfies Record<SupportedDocumentFormat, DocumentTextExtractor>;
  const detected: FileTypeResult = {
    ext: format === 'jpeg' ? 'jpg' : format,
    mime:
      format === 'pdf'
        ? 'application/pdf'
        : format === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : format === 'png'
            ? 'image/png'
            : 'image/jpeg',
  };
  const service = new DocumentExtractionService({
    access: { requireSupplierDocumentAccess: access },
    detectFileType: vi.fn(async () => detected),
    extractors,
  });
  return { access, app: createApp({ documentExtractionService: service }), extractor };
}

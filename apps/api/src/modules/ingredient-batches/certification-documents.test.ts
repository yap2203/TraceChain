import { expect, it } from 'vitest';
import {
  decodeCertificationFile,
  validateCertificationStructure,
} from './certification-documents.js';
it('parses a real PDF and rejects a corrupt PDF despite matching magic bytes', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    'xref\n0 5\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const { bytes } = decodeCertificationFile({
    fileName: 'certificate.pdf',
    mimeType: 'application/pdf',
    data: Buffer.from(pdf).toString('base64'),
  });
  await expect(validateCertificationStructure(bytes, 'application/pdf')).resolves.toBeUndefined();
  await expect(
    validateCertificationStructure(
      Buffer.from('%PDF-1.4 not actually a PDF %%EOF'),
      'application/pdf',
    ),
  ).rejects.toBeDefined();
});

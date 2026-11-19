import { createHash } from 'node:crypto';
import { z } from 'zod';
import { imageSize } from 'image-size';
export const certificationUploadSchema = z
  .object({
    id: z.uuid(),
    operationId: z.uuid(),
    certificationId: z.uuid(),
    fileName: z
      .string()
      .min(1)
      .max(180)
      .regex(/^[^\x00-\x1f/\\]+$/),
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    data: z
      .string()
      .min(4)
      .max(13981016)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
  .superRefine((file, ctx) => {
    try {
      decodeCertificationFile(file);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['data'],
        message:
          'Use a valid PDF, PNG or JPEG document up to 10 MB. The file signature and extension must match.',
      });
    }
  });
export function decodeCertificationFile(file: {
  fileName: string;
  mimeType: string;
  data: string;
}) {
  const bytes = Buffer.from(file.data, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.toString('base64') !== file.data)
    throw new Error('Invalid file size or encoding.');
  if (file.mimeType === 'application/pdf') {
    if (
      !/\.pdf$/i.test(file.fileName) ||
      bytes.subarray(0, 5).toString() !== '%PDF-' ||
      !bytes.subarray(-1024).toString().includes('%%EOF')
    )
      throw new Error('Invalid PDF.');
  } else {
    const png = file.mimeType === 'image/png';
    if (
      png
        ? !/\.png$/i.test(file.fileName) ||
          bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
          !bytes.subarray(-12).toString('hex').includes('49454e44')
        : !/\.jpe?g$/i.test(file.fileName) ||
          bytes[0] !== 255 ||
          bytes[1] !== 216 ||
          bytes.at(-2) !== 255 ||
          bytes.at(-1) !== 217
    )
      throw new Error('Invalid image.');
    const size = imageSize(bytes);
    if (!size.width || !size.height || size.width * size.height > 40_000_000)
      throw new Error('Invalid image dimensions.');
  }
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function validateCertificationStructure(bytes: Buffer, mimeType: string) {
  if (mimeType !== 'application/pdf') return;
  const { MAX_PDF_PAGES } = await import('../document-extraction/document-extraction.schema.js');
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdf.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    stopAtErrors: true,
    maxImageSize: 40_000_000,
    disableFontFace: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const document = await task.promise;
        if (document.numPages > MAX_PDF_PAGES) throw new Error('Too many PDF pages.');
        for (let page = 1; page <= document.numPages; page++) {
          const item = await document.getPage(page);
          await item.getOperatorList();
          item.cleanup();
        }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('PDF validation timed out.')), 15000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await task.destroy();
  }
}

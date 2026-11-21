import { z } from 'zod';

const applicationDocumentKinds = [
  'registrationProof',
  'businessProof',
  'authorisationProof',
  'certifications',
] as const;

export const applicationDocumentsSchema = z
  .array(
    z
      .object({
        kind: z.enum(applicationDocumentKinds),
        fileName: z
          .string()
          .min(1)
          .max(180)
          .regex(/^[^\x00-\x1f/\\]+$/),
        mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
        data: z
          .string()
          .min(4)
          .max(13981016)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict(),
  )
  .min(3)
  .max(4)
  .superRefine((files, context) => {
    if (
      new Set(files.map((file) => file.kind)).size !== files.length ||
      applicationDocumentKinds.slice(0, 3).some((kind) => !files.some((file) => file.kind === kind))
    )
      context.addIssue({
        code: 'custom',
        message: 'Include registration, business and authorisation documents once each.',
      });
    for (const file of files) {
      const bytes = Buffer.from(file.data, 'base64');
      const valid =
        file.mimeType === 'application/pdf'
          ? bytes.subarray(0, 5).toString() === '%PDF-'
          : file.mimeType === 'image/png'
            ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const extension =
        file.mimeType === 'application/pdf'
          ? /\.pdf$/i
          : file.mimeType === 'image/png'
            ? /\.png$/i
            : /\.jpe?g$/i;
      if (
        !valid ||
        !extension.test(file.fileName) ||
        bytes.length > 10 * 1024 * 1024 ||
        bytes.toString('base64') !== file.data
      )
        context.addIssue({
          code: 'custom',
          message: 'Use valid PDF, PNG or JPEG documents up to 10 MB each.',
        });
    }
  });

export type ApplicationDocumentsInput = z.infer<typeof applicationDocumentsSchema>;

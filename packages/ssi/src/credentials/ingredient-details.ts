import { z } from 'zod';
import { ingredientCountryCodes } from '@tracechain/shared';
const text = (max: number) => z.string().trim().min(1).max(max);
export const certificationDocumentSchema = z
  .object({
    id: z.uuid(),
    fileName: text(180).regex(/^[^\x00-\x1f/\\]+$/),
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    size: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    cid: text(256),
  })
  .strict();
export const ingredientCertificationSchema = z
  .object({
    id: z.uuid(),
    name: text(120),
    issuer: text(160),
    reference: text(120),
    issueDate: z.iso.date().optional(),
    expiryDate: z.iso.date().optional(),
    noExpiry: z.boolean(),
    scope: z.enum(['Company', 'Facility', 'Ingredient', 'This batch']),
    scopeReference: text(160).optional(),
    documents: z.array(certificationDocumentSchema).max(3),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (!entry.noExpiry && !entry.expiryDate)
      ctx.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Enter expiry or select No expiry stated.',
      });
    if (entry.noExpiry && entry.expiryDate)
      ctx.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Clear expiry when no expiry is stated.',
      });
    if (entry.issueDate && entry.expiryDate && entry.expiryDate < entry.issueDate)
      ctx.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Certificate expiry must follow issue date.',
      });
    if (entry.scope !== 'Company' && !entry.scopeReference)
      ctx.addIssue({
        code: 'custom',
        path: ['scopeReference'],
        message: 'Identify the facility, ingredient or batch covered.',
      });
  });
export const ingredientOriginSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    countryName: text(100),
    region: text(160).optional(),
    city: text(160).optional(),
    facility: text(200).optional(),
    privateAddress: text(1000).optional(),
    processingLocation: text(1000).optional(),
    processingCountry: z
      .string()
      .refine((code) => (ingredientCountryCodes as readonly string[]).includes(code))
      .optional(),
  })
  .strict()
  .superRefine((origin, ctx) => {
    const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    if (
      !(ingredientCountryCodes as readonly string[]).includes(origin.countryCode) ||
      names.of(origin.countryCode) !== origin.countryName
    )
      ctx.addIssue({
        code: 'custom',
        path: ['countryCode'],
        message: 'Select an ISO country and its matching name.',
      });
  });
export const ingredientAllergenSchema = z
  .object({
    kind: z.enum(['contains', 'mayContain', 'declaresNone', 'unknown']),
    details: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((allergen, ctx) => {
    if (['contains', 'mayContain'].includes(allergen.kind) && !allergen.details)
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'Describe the allergens.' });
  });
export const ingredientQualityTestSchema = z
  .object({
    id: z.uuid(),
    laboratoryName: text(160),
    reportNumber: text(120),
    testDate: z.iso.date(),
    sampleReference: text(160),
    testedBatchReference: text(120),
    results: text(4000),
    documents: z.array(certificationDocumentSchema).max(3),
  })
  .strict();

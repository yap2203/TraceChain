import { z } from 'zod';
import { normalizeIngredientQuantity } from '@tracechain/shared';
import {
  ingredientOriginSchema,
  ingredientAllergenSchema,
  ingredientCertificationSchema,
} from '@tracechain/ssi';
import { requestDateSchema } from '../../config/input-validation.js';

export const ingredientBatchRequestSchema = z
  .object({
    operationId: z.uuid().optional(),
    originDetails: ingredientOriginSchema
      .safeExtend({
        processingCountry: z.never().optional(),
        processingLocation: z.never().optional(),
      })
      .optional(),
    allergen: ingredientAllergenSchema.optional(),
    certificationEntries: z
      .array(
        ingredientCertificationSchema.refine((entry) => entry.documents.length > 0, {
          message: 'Attach at least one supporting document to each certification.',
          path: ['documents'],
        }),
      )
      .max(20)
      .optional(),
    priceBasis: z.enum(['kg', 'g', 'litre', 'mL', 'each']).optional(),
    price: z
      .string()
      .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('MYR'),
    allergenInformation: z.string().trim().max(500).default(''),
    batchReference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._:/-]+$/),
    category: z.string().trim().min(1).max(80),
    certifications: z.array(z.string().trim().min(1).max(120)).max(20),
    expiryDate: requestDateSchema,
    ingredientName: z.string().trim().min(1).max(160),
    origin: z.string().trim().min(1).max(160),
    productionDate: requestDateSchema,
    quantity: z.string().regex(/^(0|[1-9]\d{0,38})(\.\d{1,3})?$/),
    unit: z
      .string()
      .trim()
      .min(1)
      .max(31)
      .regex(/^[A-Za-z0-9._/-]+$/),
  })
  .strict()
  .superRefine((input, context) => {
    try {
      if (input.originDetails) normalizeIngredientQuantity(input.quantity, input.unit);
      else if (!/^[1-9]\d{0,38}$/.test(input.quantity))
        throw new Error('Legacy quantities must be positive whole units.');
    } catch (error) {
      context.addIssue({ code: 'custom', path: ['quantity'], message: (error as Error).message });
    }
    const files = (input.certificationEntries ?? []).flatMap((entry) => entry.documents);
    if (
      files.length > 20 ||
      files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024 ||
      new Set(files.map((file) => file.id)).size !== files.length ||
      (new Set(input.certificationEntries?.map((entry) => entry.id)).size !==
        input.certificationEntries?.length &&
        input.certificationEntries !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['certificationEntries'],
        message: 'Use unique entries/files, at most 20 documents and 20 MB total.',
      });
    if (input.originDetails && (!input.allergen || !input.operationId))
      context.addIssue({
        code: 'custom',
        path: ['allergen'],
        message: 'Choose an explicit allergen declaration and a stable operation ID.',
      });
    if (
      input.price &&
      input.priceBasis &&
      ((['g', 'kg'].includes(input.unit) && !['g', 'kg'].includes(input.priceBasis)) ||
        (['litre', 'mL'].includes(input.unit) && !['litre', 'mL'].includes(input.priceBasis)) ||
        (['unit', 'each'].includes(input.unit) && input.priceBasis !== 'each'))
    )
      context.addIssue({
        code: 'custom',
        path: ['priceBasis'],
        message: 'Price basis must match the batch quantity dimension.',
      });
    const now = Date.now();
    if (input.productionDate.getTime() > now) {
      context.addIssue({
        code: 'custom',
        path: ['productionDate'],
        message: 'Production date cannot be in the future.',
      });
    }
    if (input.expiryDate.getTime() <= now) {
      context.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Expiry date must be in the future.',
      });
    }
    if (input.expiryDate.getTime() <= input.productionDate.getTime()) {
      context.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Expiry date must follow production date.',
      });
    }
  })
  .transform((input) =>
    input.originDetails
      ? { ...input, ...normalizeIngredientQuantity(input.quantity, input.unit) }
      : input,
  );

export type IngredientBatchRequest = z.infer<typeof ingredientBatchRequestSchema>;

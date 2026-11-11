import { z } from 'zod';
import { requestDateSchema } from '../../config/input-validation.js';

export const ingredientBatchRequestSchema = z
  .object({
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
    quantity: z.string().regex(/^[1-9]\d{0,38}$/),
    unit: z
      .string()
      .trim()
      .min(1)
      .max(31)
      .regex(/^[A-Za-z0-9._/-]+$/),
  })
  .strict()
  .superRefine((input, context) => {
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
  });

export type IngredientBatchRequest = z.infer<typeof ingredientBatchRequestSchema>;

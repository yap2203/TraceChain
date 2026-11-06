import { z } from 'zod';

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
    expiryDate: z.coerce.date(),
    ingredientName: z.string().trim().min(1).max(160),
    origin: z.string().trim().min(1).max(160),
    productionDate: z.coerce.date(),
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
      context.addIssue({ code: 'custom', message: 'Production date cannot be in the future.' });
    }
    if (input.expiryDate.getTime() <= now) {
      context.addIssue({ code: 'custom', message: 'Expiry date must be in the future.' });
    }
    if (input.expiryDate.getTime() <= input.productionDate.getTime()) {
      context.addIssue({ code: 'custom', message: 'Expiry date must follow production date.' });
    }
  });

export type IngredientBatchRequest = z.infer<typeof ingredientBatchRequestSchema>;

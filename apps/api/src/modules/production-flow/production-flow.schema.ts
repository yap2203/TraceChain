import { z } from 'zod';
import { CURRENT_INGREDIENT_REQUEST_CLAIMS } from '@tracechain/shared';
import { requestDateSchema } from '../../config/input-validation.js';

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const positiveInteger = z.string().regex(/^[1-9]\d{0,38}$/);
export const companyProofRequestSchema = z
  .object({
    purpose: z.string().trim().min(1).max(500).optional(),
    expiresAt: z.number().int().positive().optional(),
    requiredClaims: z
      .array(
        z.enum([
          'companyName',
          'role',
          'walletAddress',
          'id',
          'companyRegistrationNumber',
          'registrationCountry',
          'companyId',
        ]),
      )
      .max(7)
      .default([]),
    optionalClaims: z
      .array(z.enum(['companyRegistrationNumber', 'registrationCountry', 'companyId']))
      .max(3)
      .default([]),
  })
  .strict();
export const productionIngredientsQuerySchema = z
  .object({ location: bytes32.optional(), purpose: z.literal('production').optional() })
  .strict();

export const evidenceRequestSchema = z
  .object({
    batchId: bytes32,
    policy: z
      .object({
        policyVersion: z.literal(2),
        template: z.enum(['custom', 'basic', 'food', 'certification']).default('custom'),
        allowUnknownAllergens: z.boolean().default(false),
        certificationRequirement: z
          .object({
            name: z.string().trim().min(1).max(120).optional(),
            scope: z.enum(['Company', 'Facility', 'Ingredient', 'This batch']).optional(),
            scopeReference: z.string().trim().min(1).max(160).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    claims: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    requiredClaims: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    dueAt: requestDateSchema,
    operationId: z.string().uuid(),
    productBatchId: bytes32.optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.claims.some(
        (key) => !CURRENT_INGREDIENT_REQUEST_CLAIMS.some(([claim]) => claim === key),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['claims'],
        message: 'Use the supported claims in the version 2 request policy.',
      });
    if (input.requiredClaims.some((key) => !input.claims.includes(key)))
      ctx.addIssue({
        code: 'custom',
        path: ['requiredClaims'],
        message: 'Required claims must be selected from the supported requested claims.',
      });
  });

export const productRequestSchema = z
  .object({
    price: z
      .string()
      .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('MYR'),
    productionLocation: bytes32.optional(),
    productionLocationName: z.string().trim().min(1).max(160).optional(),
    batchReference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._:/-]+$/),
    category: z.string().trim().max(100).default(''),
    origin: z.string().trim().max(120).default(''),
    description: z.string().trim().max(1_000).default(''),
    expiresAt: requestDateSchema,
    ingredientLinks: z
      .array(z.object({ batchId: bytes32, quantity: positiveInteger }).strict())
      .min(1)
      .max(50),
    privateMetadata: z.record(z.string(), z.string().max(500)).default({}),
    producedAt: requestDateSchema,
    productName: z.string().trim().min(1).max(160),
    quantity: positiveInteger,
    unit: z
      .string()
      .trim()
      .min(1)
      .max(31)
      .regex(/^[A-Za-z0-9._/-]+$/),
  })
  .strict();

export const transferRequestSchema = z
  .object({
    expectedAt: requestDateSchema,
    productBatchId: bytes32,
    quantity: positiveInteger,
    recipient: wallet,
    shipmentReference: z.string().trim().min(1).max(120),
  })
  .strict();

export const distributorTransferRequestSchema = z
  .object({
    expectedAt: requestDateSchema,
    handlingNotes: z.string().trim().max(1_000).default(''),
    operationId: z.string().uuid(),
    productBatchId: bytes32,
    quantity: positiveInteger,
    recipient: wallet,
    shipmentReference: z.string().trim().min(1).max(120),
  })
  .strict();

export const requestIdSchema = z.object({ requestId: bytes32 }).strict();
export const evidencePresentationSchema = z
  .object({ presentation: z.string().min(100).max(200_000) })
  .strict()
  .optional();
export const companyIdentityPresentationSchema = z
  .object({ presentation: z.string().min(100).max(300_000) })
  .strict();
export const evidenceCloseSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    status: z.enum(['DECLINED', 'REJECTED', 'CANCELLED']),
  })
  .strict();

export type EvidenceRequestInput = z.infer<typeof evidenceRequestSchema>;
export type EvidenceCloseInput = z.infer<typeof evidenceCloseSchema>;
export type ProductRequestInput = z.infer<typeof productRequestSchema>;
export type TransferRequestInput = z.infer<typeof transferRequestSchema>;
export type DistributorTransferRequestInput = z.infer<typeof distributorTransferRequestSchema>;

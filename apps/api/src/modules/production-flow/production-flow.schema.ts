import { z } from 'zod';

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const positiveInteger = z.string().regex(/^[1-9]\d{0,38}$/);

export const evidenceRequestSchema = z
  .object({
    batchId: bytes32,
    claims: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    dueAt: z.coerce.date(),
    operationId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const productRequestSchema = z
  .object({
    batchReference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._:/-]+$/),
    category: z.string().trim().min(1).max(100),
    expiresAt: z.coerce.date(),
    ingredientLinks: z
      .array(z.object({ batchId: bytes32, quantity: positiveInteger }).strict())
      .min(1)
      .max(50),
    privateMetadata: z.record(z.string(), z.string().max(500)).default({}),
    producedAt: z.coerce.date(),
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
    expectedAt: z.coerce.date(),
    productBatchId: bytes32,
    quantity: positiveInteger,
    recipient: wallet,
    shipmentReference: z.string().trim().min(1).max(120),
  })
  .strict();

export const distributorTransferRequestSchema = z
  .object({
    expectedAt: z.coerce.date(),
    handlingNotes: z.string().trim().max(1_000).default(''),
    operationId: z.string().uuid(),
    productBatchId: bytes32,
    quantity: positiveInteger,
    recipient: wallet,
    shipmentReference: z.string().trim().min(1).max(120),
  })
  .strict();

export const requestIdSchema = z.object({ requestId: bytes32 }).strict();

export type EvidenceRequestInput = z.infer<typeof evidenceRequestSchema>;
export type ProductRequestInput = z.infer<typeof productRequestSchema>;
export type TransferRequestInput = z.infer<typeof transferRequestSchema>;
export type DistributorTransferRequestInput = z.infer<typeof distributorTransferRequestSchema>;

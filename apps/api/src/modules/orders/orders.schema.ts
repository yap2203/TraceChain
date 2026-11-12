import { z } from 'zod';
import { catalogueImageMimeTypes } from './catalogue-media.js';
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const quantity = z.string().regex(/^[1-9]\d{0,38}$/);
const count = z.string().regex(/^(0|[1-9]\d{0,38})$/);
const time = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const base = { operationId: z.string().uuid() };
export const orderActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...base,
      action: z.literal('approved-receipt'),
      orderId: hash,
      quantity,
      location: hash,
      occurredAt: time,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('ingredient-update'),
      batchId: hash,
      expectedHash: hash,
      name: z.string().trim().min(1).max(160),
      category: z.string().trim().min(1).max(80),
      description: z.string().trim().max(1000),
      price: z
        .string()
        .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/)
        .optional(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('ingredient-archive'),
      batchId: hash,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('decide-request'),
      orderId: hash,
      decision: z.union([z.literal(1), z.literal(2)]),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({ ...base, action: z.literal('bind-evidence'), orderId: hash, evidenceId: hash })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('recall'),
      batchId: hash,
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({ ...base, action: z.literal('location'), label: z.string().trim().min(1).max(160) })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('list'),
      name: z.string().trim().min(1).max(160),
      kind: z.union([z.literal(1), z.literal(2)]),
      batchId: hash,
      itemId: hash.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('request'),
      requestOnly: z.boolean().optional(),
      itemId: hash,
      batchId: hash.optional(),
      kind: z.union([z.literal(1), z.literal(2)]).optional(),
      quantity,
      unit: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._/-]{1,31}$/),
      location: hash.optional(),
      expiresAt: time,
      evidenceRequired: z.boolean(),
      note: z.string().trim().max(500),
    })
    .strict(),
  z
    .object({ ...base, action: z.literal('propose'), orderId: hash, batchId: hash, location: hash })
    .strict(),
  z.object({ ...base, action: z.literal('allocate'), orderId: hash, quantity }).strict(),
  z.object({ ...base, action: z.literal('close'), orderId: hash }).strict(),
  z.object({ ...base, action: z.literal('evidence'), orderId: hash, evidenceId: hash }).strict(),
  z
    .object({
      ...base,
      action: z.literal('dispatch'),
      orderId: hash,
      quantity,
      occurredAt: time,
      distributor: wallet.optional(),
      transitLocation: hash.optional(),
      expectedAt: time,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('receipt'),
      shipmentId: hash,
      accepted: count,
      damaged: count,
      rejected: count,
      missing: count,
      occurredAt: time,
      product: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('forward'),
      shipmentId: hash,
      quantity,
      expectedAt: time,
      occurredAt: time,
      fromLocation: hash,
      toLocation: hash,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('correction'),
      shipmentId: hash,
      reason: z.string().trim().min(1).max(1000),
      correctedValues: z.string().trim().min(1).max(2000),
      occurredAt: time,
      reduceStock: z.boolean(),
      correctedUsable: count,
    })
    .strict(),
]);
export type OrderAction = z.infer<typeof orderActionSchema>;

export const catalogueImageSchema = z
  .object({
    data: z.string().min(4).max(2_800_000),
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(catalogueImageMimeTypes),
  })
  .strict();

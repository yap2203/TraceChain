import { z } from 'zod';
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const quantity = z.string().regex(/^[1-9]\d{0,38}$/),
  time = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const base = { operationId: z.string().uuid() };
const vehicleRegex = /^(?=.*[A-Z0-9])[A-Z0-9 -]+$/;
const vehicleSchema = z.string().trim().toUpperCase().min(2).max(32).regex(vehicleRegex);
const road = {
  quantity,
  fromLocation: hash,
  toLocation: hash,
  vehicle: vehicleSchema,
  occurredAt: time,
  expectedAt: time,
};
const optionalVehicle = z
  .string()
  .max(32)
  .refine(
    (raw) =>
      raw === '' || (raw.trim().length >= 2 && /^(?=.*[A-Z0-9])[A-Z0-9 -]+$/i.test(raw.trim())),
    { message: 'Vehicle registration must be between 2 and 32 valid characters' },
  )
  .transform((v) => v.trim().toUpperCase())
  .optional()
  .default('');
export const logisticsActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...base,
      action: z.literal('arrange-from-custody'),
      orderId: hash,
      positionId: hash,
      receivingLocation: hash,
    })
    .strict(),
  z.object({ ...base, action: z.literal('arrange-delivery'), orderId: hash }).strict(),
  z
    .object({
      ...base,
      action: z.literal('warehouse-decision'),
      shipmentId: hash,
      decision: z.union([z.literal(1), z.literal(2)]),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('shipment-return'),
      shipmentId: hash,
      occurredAt: time,
      qrPayload: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('warehouse'),
      location: hash,
      name: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      ...base,
      quantity,
      fromLocation: hash,
      toLocation: hash,
      vehicle: optionalVehicle,
      occurredAt: time,
      expectedAt: time,
      action: z.literal('stock-dispatch'),
      batchId: hash,
    })
    .strict(),
  z.object({ ...base, ...road, action: z.literal('order-dispatch'), orderId: hash }).strict(),
  z
    .object({
      ...base,
      ...road,
      action: z.literal('product-dispatch'),
      batchId: hash,
      recipient: wallet,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('shipment-receive'),
      shipmentId: hash,
      quantity,
      occurredAt: time,
      qrPayload: z.string().min(1).max(1024),
      kind: z.enum(['ingredient', 'product']),
      vehicle: vehicleSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('shipment-vehicle'),
      shipmentId: hash,
      vehicle: vehicleSchema,
    })
    .strict(),
]);
export type LogisticsAction = z.infer<typeof logisticsActionSchema>;

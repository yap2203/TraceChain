import { z } from 'zod';

export const resolveTransferQrRequestSchema = z
  .object({
    qrPayload: z.string().min(1),
  })
  .strict();

export const transferIdParameterSchema = z.object({
  transferId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'A bytes32 transfer ID is required.'),
});

export const prepareReceiptConfirmationRequestSchema = z
  .object({
    actualArrivalAt: z.string().datetime().optional(),
    actualQuantity: quantity(),
    damagedQuantity: quantity(),
    evidence: z
      .array(
        z
          .object({
            dataBase64: z.string().min(1).max(7_000_000),
            mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    notes: z.string().trim().max(4_000).default(''),
    rejectedQuantity: quantity(),
    transferId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'A bytes32 transfer ID is required.'),
  })
  .strict();

export const rejectTransferRequestSchema = z
  .object({
    evidence: prepareReceiptConfirmationRequestSchema.shape.evidence,
    reason: z.string().trim().min(1).max(4_000),
    reasonType: z.enum(['WRONG_PRODUCT', 'SHIPMENT_REFUSED', 'COMPLETE_REJECTION']),
    transferId: transferIdParameterSchema.shape.transferId,
  })
  .strict();

export const resolveDiscrepancyRequestSchema = z
  .object({
    acceptActual: z.boolean(),
    reason: z.string().trim().min(1).max(4_000),
    transferId: transferIdParameterSchema.shape.transferId,
  })
  .strict();

function quantity() {
  return z
    .string()
    .regex(/^(0|[1-9]\d*)$/, 'Quantities must be non-negative integers.')
    .refine((value) => {
      try {
        return BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
      } catch {
        return false;
      }
    }, 'Quantities must be safe integers.');
}

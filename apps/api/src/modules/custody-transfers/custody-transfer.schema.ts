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
    transferId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'A bytes32 transfer ID is required.'),
  })
  .strict();

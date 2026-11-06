import { z } from 'zod';

export const resolveTransferQrRequestSchema = z
  .object({
    qrPayload: z.string().min(1),
  })
  .strict();

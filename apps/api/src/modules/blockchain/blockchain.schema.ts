import { z } from 'zod';

const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const applicationTransactionSchema = z
  .object({
    applicationId: bytes32Schema,
    encryptedProfileCid: z.string().min(1).max(512),
    previousApplicationId: bytes32Schema,
    profileHash: bytes32Schema,
    requestedRole: z.number().int().min(2).max(5),
  })
  .strict();

export const rejectionTransactionSchema = z
  .object({
    applicationId: bytes32Schema,
    reasonHash: bytes32Schema,
  })
  .strict();

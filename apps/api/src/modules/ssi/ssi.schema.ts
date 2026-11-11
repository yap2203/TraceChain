import { z } from 'zod';
import { requestDateSchema } from '../../config/input-validation.js';

export const companyRoleVerificationRequestSchema = z
  .object({
    credential: z.record(z.string(), z.unknown()),
  })
  .strict();

export const companyRoleIssuanceRequestSchema = z
  .object({
    applicationId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    approvedRole: z.number().int().min(2).max(5),
    companyName: z.string().trim().min(1).max(200),
    companyRegistrationNumber: z.string().trim().min(1).max(120),
    expirationDate: requestDateSchema.refine((value) => value.getTime() > Date.now(), {
      message: 'The credential expiration date must be in the future.',
    }),
  })
  .strict();

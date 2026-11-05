import { z } from 'zod';

export const companyRoleVerificationRequestSchema = z
  .object({
    credential: z.record(z.string(), z.unknown()),
  })
  .strict();

export const companyRoleIssuanceRequestSchema = z
  .object({
    applicationId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    companyId: z.string().trim().min(1).max(120),
    companyName: z.string().trim().min(1).max(200),
    expirationDate: z.coerce.date().refine((value) => value.getTime() > Date.now(), {
      message: 'The credential expiration date must be in the future.',
    }),
  })
  .strict();

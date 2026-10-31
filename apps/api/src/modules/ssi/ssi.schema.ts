import { z } from 'zod';

export const companyRoleVerificationRequestSchema = z
  .object({
    credential: z.record(z.string(), z.unknown()),
  })
  .strict();

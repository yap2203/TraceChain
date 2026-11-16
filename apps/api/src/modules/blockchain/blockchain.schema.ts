import { z } from 'zod';
import { catalogueImageSchema } from '../orders/orders.schema.js';

const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const personalPermissionTransactionSchema = z
  .object({
    account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    permission: bytes32Schema,
    setting: z.number().int().min(0).max(2),
  })
  .strict();

export const applicationTransactionSchema = z
  .object({
    applicationId: bytes32Schema,
    applicantWallet: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    companyName: z.string().trim().min(1).max(200),
    companyRegistrationNumber: z.string().trim().min(1).max(120),
    initialLocationName: z.string().trim().min(1).max(160).optional(),
    encryptedProfileCid: z.string().min(1).max(512),
    previousApplicationId: bytes32Schema,
    profileHash: bytes32Schema,
    requestedRole: z.number().int().min(2).max(5),
    logo: catalogueImageSchema.optional(),
    logoSignature: z
      .string()
      .regex(/^0x[0-9a-fA-F]{130}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const brandingFields = [value.applicantWallet, value.logo, value.logoSignature].filter(Boolean);
    if (brandingFields.length !== 0 && brandingFields.length !== 3)
      context.addIssue({
        code: 'custom',
        message: 'Applicant wallet, logo and logo signature must be provided together.',
        path: ['logo'],
      });
  });

export const rejectionTransactionSchema = z
  .object({
    applicationId: bytes32Schema,
    reasonHash: bytes32Schema,
  })
  .strict();

export const credentialLifecycleTransactionSchema = z
  .object({
    action: z.enum(['suspend', 'reactivate', 'revoke']),
    credentialId: bytes32Schema,
    reasonHash: bytes32Schema.optional(),
  })
  .superRefine((value, context) => {
    if (value.action !== 'reactivate' && !value.reasonHash) {
      context.addIssue({
        code: 'custom',
        message: 'A reason hash is required.',
        path: ['reasonHash'],
      });
    }
  });

export const stakeholderLifecycleTransactionSchema = z
  .object({
    action: z.enum(['suspend', 'reactivate', 'revoke']),
    account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    reasonHash: bytes32Schema.optional(),
  })
  .superRefine((value, context) => {
    if (value.action !== 'reactivate' && !value.reasonHash)
      context.addIssue({
        code: 'custom',
        message: 'A reason hash is required.',
        path: ['reasonHash'],
      });
  });

export const rolePermissionTransactionSchema = z
  .object({
    allowed: z.boolean(),
    permission: bytes32Schema,
    role: z.number().int().min(2).max(5),
  })
  .strict();

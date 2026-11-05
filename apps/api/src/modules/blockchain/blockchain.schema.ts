import { z } from 'zod';

const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const applicationTransactionSchema = z
  .object({
    applicationId: bytes32Schema,
    companyName: z.string().trim().min(1).max(200),
    companyRegistrationNumber: z.string().trim().min(1).max(120),
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

export const credentialLifecycleTransactionSchema = z
  .object({
    action: z.enum(['suspend', 'reactivate', 'revoke']),
    credentialId: bytes32Schema,
    reasonHash: bytes32Schema.optional(),
  })
  .superRefine((value, context) => {
    if (value.action !== 'reactivate' && !value.reasonHash) {
      context.addIssue({ code: 'custom', message: 'A reason hash is required.', path: ['reasonHash'] });
    }
  });

export const stakeholderLifecycleTransactionSchema = z
  .object({ action: z.enum(['suspend', 'reactivate', 'revoke']), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), reasonHash: bytes32Schema.optional() })
  .superRefine((value, context) => { if (value.action !== 'reactivate' && !value.reasonHash) context.addIssue({ code: 'custom', message: 'A reason hash is required.', path: ['reasonHash'] }); });

export const rolePermissionTransactionSchema = z.object({
  allowed: z.boolean(),
  permission: bytes32Schema,
  role: z.number().int().min(2).max(5),
}).strict();

import { getAddress } from 'ethers';
import { z } from 'zod';

import './load-env.js';

const blockchainEnvironmentSchema = z.object({
  CHAIN_RPC_URL: z.string().url(),
  CUSTODY_TRANSFER_ADDRESS: z.string().transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid Ethereum address' });
      return z.NEVER;
    }
  }),
  EVIDENCE_REGISTRY_ADDRESS: z.string().transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid Ethereum address' });
      return z.NEVER;
    }
  }),
  INGREDIENT_REGISTRY_ADDRESS: z.string().transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid Ethereum address' });
      return z.NEVER;
    }
  }),
  PRODUCT_REGISTRY_ADDRESS: z.string().transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid Ethereum address' });
      return z.NEVER;
    }
  }),
  CREDENTIAL_REGISTRY_ADDRESS: z.string().transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid Ethereum address' });
      return z.NEVER;
    }
  }),
  STAKEHOLDER_REGISTRY_ADDRESS: z.string().transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid Ethereum address' });
      return z.NEVER;
    }
  }),
});

export function loadBlockchainEnvironment() {
  return blockchainEnvironmentSchema.parse(process.env);
}

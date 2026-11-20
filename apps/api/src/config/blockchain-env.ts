import { getAddress } from 'ethers';
import { z } from 'zod';

import './load-env.js';

const blockchainEnvironmentSchema = z.object({
  CHAIN_EVENT_CONFIRMATIONS: z.coerce.number().int().min(0).max(1000).default(2),
  CHAIN_EVENT_PAGE_SIZE: z.coerce.number().int().min(1).max(100_000).default(5000),
  CHAIN_RPC_URL: z.string().url(),
  OPERATIONAL_READ_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  RPC_BATCH_MAX_COUNT: z.coerce.number().int().min(1).max(100).default(20),
  RPC_BATCH_STALL_TIME_MS: z.coerce.number().int().min(0).max(1000).default(10),
  RPC_BULK_READ_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(6),
  RPC_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).default(10),
  RPC_READ_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  RPC_READ_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  RPC_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1).max(60_000).default(1000),
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

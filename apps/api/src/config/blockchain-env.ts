import { getAddress } from 'ethers';
import { z } from 'zod';

import './load-env.js';

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
  z.string().url().optional(),
);
const optionalBlock = z.preprocess(
  (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
  z.coerce.number().int().min(0).optional(),
);

const blockchainEnvironmentSchema = z
  .object({
    CHAIN_EVENT_CONFIRMATIONS: z.coerce.number().int().min(0).max(1000).default(2),
    CHAIN_EVENT_FALLBACK_PAGE_SIZE: z.coerce.number().int().min(1).max(100_000).default(10),
    CHAIN_EVENT_PAGE_SIZE: z.coerce.number().int().min(1).max(100_000).default(5000),
    CHAIN_EVENT_START_BLOCK: optionalBlock,
    CHAIN_RPC_URL: optionalUrl,
    CHAIN_RPC_PRIMARY_URL: optionalUrl,
    CHAIN_RPC_SECONDARY_URL: optionalUrl,
    CHAIN_RPC_EMERGENCY_URL: optionalUrl,
    CHAIN_LOG_RPC_URL: optionalUrl,
    CHAIN_LOG_FALLBACK_URL: optionalUrl,
    OPERATIONAL_READ_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
    RPC_BATCH_MAX_COUNT: z.coerce.number().int().min(1).max(100).default(10),
    RPC_BATCH_STALL_TIME_MS: z.coerce.number().int().min(0).max(1000).default(10),
    RPC_BULK_READ_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    RPC_BULK_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).default(1000),
    RPC_MULTICALL_ENABLED: z.enum(['true', 'false']).default('false'),
    RPC_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).default(100),
    RPC_READ_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    RPC_READ_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    RPC_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1).max(60_000).default(1000),
    RPC_ENDPOINT_COOLDOWN_MS: z.coerce.number().int().min(1000).max(3_600_000).default(30_000),
    RPC_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
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
  })
  .superRefine((value, context) => {
    if (!value.CHAIN_RPC_PRIMARY_URL && !value.CHAIN_RPC_URL)
      context.addIssue({
        code: 'custom',
        path: ['CHAIN_RPC_PRIMARY_URL'],
        message: 'CHAIN_RPC_PRIMARY_URL or legacy CHAIN_RPC_URL is required',
      });
    if (value.CHAIN_LOG_FALLBACK_URL && !value.CHAIN_LOG_RPC_URL)
      context.addIssue({
        code: 'custom',
        path: ['CHAIN_LOG_FALLBACK_URL'],
        message: 'CHAIN_LOG_FALLBACK_URL requires CHAIN_LOG_RPC_URL',
      });
  });

export function loadBlockchainEnvironment() {
  const parsed = blockchainEnvironmentSchema.parse(process.env);
  return {
    ...parsed,
    // Keep the existing gateway constructors working while the provider pool
    // reads the optional endpoint roles directly from the validated environment.
    CHAIN_RPC_URL: parsed.CHAIN_RPC_PRIMARY_URL ?? parsed.CHAIN_RPC_URL!,
  };
}

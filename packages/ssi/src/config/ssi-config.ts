import type { DIDResolver } from 'did-resolver';
import type { VeramoJsonStore } from '@veramo/data-store-json';
import { z } from 'zod';

export const SEPOLIA_CHAIN_ID = 11_155_111;
export const SEPOLIA_NETWORK_NAME = 'sepolia';
export const SEPOLIA_ETHR_DID_REGISTRY = '0x03d5003bf0e79C5F5223588F347ebA39AfbC3818';

const traceChainSsiConfigSchema = z
  .object({
    chainId: z.literal(SEPOLIA_CHAIN_ID),
    kmsSecretKey: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, 'kmsSecretKey must be a 32-byte hexadecimal SecretBox key'),
    networkName: z.literal(SEPOLIA_NETWORK_NAME),
    privateKeyStorePath: z.string().min(1).optional(),
    privateKeyStore: z.custom<VeramoJsonStore>().optional(),
    publicStorePath: z.string().min(1),
    rpcUrl: z.string().url(),
  })
  .refine((config) => Boolean(config.privateKeyStorePath) !== Boolean(config.privateKeyStore), {
    message: 'Provide exactly one private Veramo key store source',
    path: ['privateKeyStorePath'],
  })
  .refine(
    (config) =>
      !config.privateKeyStorePath || config.publicStorePath !== config.privateKeyStorePath,
    {
      message: 'Public and private Veramo stores must use different files',
      path: ['privateKeyStorePath'],
    },
  );

export interface TraceChainSsiConfig {
  chainId: typeof SEPOLIA_CHAIN_ID;
  kmsSecretKey: string;
  networkName: typeof SEPOLIA_NETWORK_NAME;
  privateKeyStorePath?: string;
  /** Optional injected store for isolated agents/tests; normal API runtime uses the encrypted file store. */
  privateKeyStore?: VeramoJsonStore;
  publicStorePath: string;
  rpcUrl: string;
  /** Test-only resolver overrides avoid live RPC access in the automated suite. */
  resolverOverrides?: Record<string, DIDResolver>;
}

export function validateTraceChainSsiConfig(config: TraceChainSsiConfig): TraceChainSsiConfig {
  traceChainSsiConfigSchema.parse(config);
  return config;
}

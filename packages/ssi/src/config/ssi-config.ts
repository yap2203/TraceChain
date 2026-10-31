import type { DIDResolver } from 'did-resolver';
import { z } from 'zod';

export const SEPOLIA_CHAIN_ID = 11_155_111;
export const SEPOLIA_NETWORK_NAME = 'sepolia';

const traceChainSsiConfigSchema = z
  .object({
    chainId: z.literal(SEPOLIA_CHAIN_ID),
    kmsSecretKey: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, 'kmsSecretKey must be a 32-byte hexadecimal SecretBox key'),
    networkName: z.literal(SEPOLIA_NETWORK_NAME),
    privateKeyStorePath: z.string().min(1),
    publicStorePath: z.string().min(1),
    rpcUrl: z.string().url(),
  })
  .refine((config) => config.publicStorePath !== config.privateKeyStorePath, {
    message: 'Public and private Veramo stores must use different files',
    path: ['privateKeyStorePath'],
  });

export interface TraceChainSsiConfig {
  chainId: typeof SEPOLIA_CHAIN_ID;
  kmsSecretKey: string;
  networkName: typeof SEPOLIA_NETWORK_NAME;
  privateKeyStorePath: string;
  publicStorePath: string;
  rpcUrl: string;
  /** Test-only resolver overrides avoid live RPC access in the automated suite. */
  resolverOverrides?: Record<string, DIDResolver>;
}

export function validateTraceChainSsiConfig(config: TraceChainSsiConfig): TraceChainSsiConfig {
  traceChainSsiConfigSchema.parse(config);
  return config;
}

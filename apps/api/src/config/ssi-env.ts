import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEPOLIA_CHAIN_ID, SEPOLIA_NETWORK_NAME, type TraceChainSsiConfig } from '@tracechain/ssi';
import { ZeroAddress, getAddress } from 'ethers';
import { z } from 'zod';

import './load-env.js';

const ssiEnvironmentSchema = z.object({
  SEPOLIA_RPC_URL: z.string().url(),
  TRACECHAIN_AUTHORITY_DID_ALIAS: z.string().min(1),
  VERAMO_KMS_SECRET_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'VERAMO_KMS_SECRET_KEY must be a 32-byte hexadecimal key'),
});

const ssiBootstrapEnvironmentSchema = ssiEnvironmentSchema.extend({
  BOOTSTRAP_ADMIN_WALLET: z.string().refine((value) => {
    try {
      return getAddress(value) !== ZeroAddress;
    } catch {
      return false;
    }
  }, 'BOOTSTRAP_ADMIN_WALLET must be a non-zero Ethereum address'),
});

export interface TraceChainSsiEnvironment {
  authorityDidAlias: string;
  config: TraceChainSsiConfig;
  storageDirectory: string;
}

/** SSI variables are validated only when an SSI route or command explicitly calls this function. */
export function loadTraceChainSsiEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TraceChainSsiEnvironment {
  const parsed = ssiEnvironmentSchema.parse(environment);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const storageDirectory = resolve(repositoryRoot, '.tracechain/veramo');

  return {
    authorityDidAlias: parsed.TRACECHAIN_AUTHORITY_DID_ALIAS,
    config: {
      chainId: SEPOLIA_CHAIN_ID,
      kmsSecretKey: parsed.VERAMO_KMS_SECRET_KEY,
      networkName: SEPOLIA_NETWORK_NAME,
      privateKeyStorePath: resolve(storageDirectory, 'private-keys.json'),
      publicStorePath: resolve(storageDirectory, 'public-data.json'),
      rpcUrl: parsed.SEPOLIA_RPC_URL,
    },
    storageDirectory,
  };
}

export function loadSsiBootstrapEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = ssiBootstrapEnvironmentSchema.parse(environment);
  return {
    ...loadTraceChainSsiEnvironment(environment),
    adminWalletAddress: getAddress(parsed.BOOTSTRAP_ADMIN_WALLET),
  };
}

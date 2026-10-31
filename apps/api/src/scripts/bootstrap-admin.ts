import 'dotenv/config';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bootstrapSystemAdmin,
  createTraceChainAgent,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_NETWORK_NAME,
} from '@tracechain/ssi';

import { loadSsiBootstrapEnvironment } from '../config/ssi-env.js';

async function main(): Promise<void> {
  const environment = loadSsiBootstrapEnvironment();
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const storageDirectory = resolve(repositoryRoot, '.tracechain/veramo');

  const agent = await createTraceChainAgent({
    chainId: SEPOLIA_CHAIN_ID,
    kmsSecretKey: environment.kmsSecretKey,
    networkName: SEPOLIA_NETWORK_NAME,
    privateKeyStorePath: resolve(storageDirectory, 'private-keys.json'),
    publicStorePath: resolve(storageDirectory, 'public-data.json'),
    rpcUrl: environment.rpcUrl,
  });

  const result = await bootstrapSystemAdmin(agent, {
    adminWalletAddress: environment.adminWalletAddress,
    authorityDidAlias: environment.authorityDidAlias,
  });

  // The result contains identifiers and status only. It never prints credentials or key material.
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap error';
  console.error(`SSI bootstrap failed: ${message}`);
  process.exitCode = 1;
});

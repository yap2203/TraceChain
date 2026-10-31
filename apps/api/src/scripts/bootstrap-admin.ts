import 'dotenv/config';

import { bootstrapSystemAdmin, createTraceChainAgent } from '@tracechain/ssi';

import { loadSsiBootstrapEnvironment } from '../config/ssi-env.js';

async function main(): Promise<void> {
  const environment = loadSsiBootstrapEnvironment();
  const agent = await createTraceChainAgent(environment.config);

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

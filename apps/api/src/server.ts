import { app } from './app.js';
import { env } from './config/env.js';
import { openExistingIssuer, BackendStartupError } from './config/backend-runtime.js';
import { loadCredentialStoragePublicEnvironment } from './config/credential-storage-env.js';
import { loadBlockchainEnvironment } from './config/blockchain-env.js';
import { validateBlockchainRpcStartup } from './modules/blockchain/rpc-provider.js';
import { configureEventIndexStore } from './modules/blockchain/contract-events.js';
import { dataDirectory } from './config/data-directory.js';
import { configureReadModelStore } from './modules/orders/read-model.js';

try {
  configureReadModelStore(dataDirectory());
  configureEventIndexStore(dataDirectory());
  await openExistingIssuer();
  loadCredentialStoragePublicEnvironment();
  const blockchain = loadBlockchainEnvironment();
  await validateBlockchainRpcStartup(blockchain.CHAIN_RPC_URL, env.CHAIN_ID, [
    blockchain.STAKEHOLDER_REGISTRY_ADDRESS,
    blockchain.CREDENTIAL_REGISTRY_ADDRESS,
    blockchain.EVIDENCE_REGISTRY_ADDRESS,
    blockchain.INGREDIENT_REGISTRY_ADDRESS,
    blockchain.PRODUCT_REGISTRY_ADDRESS,
    blockchain.CUSTODY_TRANSFER_ADDRESS,
    ...[process.env.SUPPLY_ORDERS_ADDRESS, process.env.COMPANY_PROOF_REGISTRY_ADDRESS].filter(
      (address): address is string => !!address,
    ),
  ]);
  app.listen(env.PORT, () => console.log(`TraceChain API listening on port ${env.PORT}`));
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  console.error(
    error instanceof BackendStartupError
      ? `${error.code}: ${error.message}`
      : message.startsWith('RPC_')
        ? message
        : 'BACKEND_CONFIGURATION_INVALID: Check the IPFS provider and existing encrypted issuer-store configuration.',
  );
  process.exitCode = 1;
}

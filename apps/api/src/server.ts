import { app } from './app.js';
import { env } from './config/env.js';
import { openExistingIssuer, BackendStartupError } from './config/backend-runtime.js';
import { loadCredentialStoragePublicEnvironment } from './config/credential-storage-env.js';

try {
  await openExistingIssuer();
  loadCredentialStoragePublicEnvironment();
  app.listen(env.PORT, () => console.log(`TraceChain API listening on port ${env.PORT}`));
} catch (error) {
  console.error(
    error instanceof BackendStartupError
      ? `${error.code}: ${error.message}`
      : 'BACKEND_CONFIGURATION_INVALID: Check the IPFS provider and existing encrypted issuer-store configuration.',
  );
  process.exitCode = 1;
}

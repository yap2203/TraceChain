import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import './load-env.js';

const schema = z.object({
  IPFS_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'IPFS_ENCRYPTION_KEY must be a 32-byte hexadecimal key'),
  IPFS_PINNING_API_URL: z.string().url(),
  IPFS_PINNING_TOKEN: z.string().min(1),
});

export function loadCredentialStorageEnvironment() {
  const parsed = schema.parse(process.env);
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  return {
    encryptionKey: Buffer.from(parsed.IPFS_ENCRYPTION_KEY, 'hex'),
    pinningApiUrl: parsed.IPFS_PINNING_API_URL,
    pinningToken: parsed.IPFS_PINNING_TOKEN,
    workflowStorePath: resolve(repositoryRoot, '.tracechain/issuance/company-role.json'),
  };
}

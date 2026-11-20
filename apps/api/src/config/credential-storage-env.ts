import { dataFile } from './data-directory.js';

import { z } from 'zod';

import './load-env.js';

const schema = z.object({
  IPFS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'IPFS_ENCRYPTION_KEY must be a 32-byte hexadecimal key'),
  IPFS_PINNING_API_URL: z.string().url(),
  IPFS_PINNING_TOKEN: z.string().min(1),
  IPFS_GATEWAY_URL: z.string().url().default('https://gateway.pinata.cloud/ipfs'),
});

export function loadCredentialStorageEnvironment() {
  const parsed = schema.parse(process.env);
  return {
    encryptionKey: Buffer.from(parsed.IPFS_ENCRYPTION_KEY, 'hex'),
    pinningApiUrl: parsed.IPFS_PINNING_API_URL,
    pinningToken: parsed.IPFS_PINNING_TOKEN,
    gatewayUrl: parsed.IPFS_GATEWAY_URL,
    ingredientWorkflowStorePath: dataFile('issuance/ingredient-batches.json'),
    productionWorkflowStorePath: dataFile('issuance/production-flow.json'),
    workflowStorePath: dataFile('issuance/company-role.json'),
  };
}

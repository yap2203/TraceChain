import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { id } from 'ethers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonIngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import { JsonProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type {
  CredentialContentStore,
  EncryptedCredentialPayload,
} from '../ssi/encrypted-credential.store.js';
import { RepositoryTraceabilityMetadataReader } from './product-traceability.metadata.js';

describe('cross-device traceability metadata recovery', () => {
  let directory: string;
  const payload: EncryptedCredentialPayload = {
    algorithm: 'aes-256-gcm',
    authTag: 'test-tag',
    ciphertext: 'test-ciphertext',
    iv: 'test-iv',
    version: 1,
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tracechain-metadata-recovery-'));
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('lets API B recover API A product metadata without copying its local journal', async () => {
    const reference = 'CHOCOLATE-2026-050';
    const batchId = id(reference);
    const serialized = JSON.stringify({
      batchReference: reference,
      category: 'Confectionery',
      productName: 'Dark Chocolate Bar',
      unit: 'each',
    });
    const contentHash = hash(serialized);
    const deviceAProducts = new JsonProductionFlowRepository(
      join(directory, 'device-a', 'issuance', 'production-flow.json'),
    );
    const deviceBProducts = new JsonProductionFlowRepository(
      join(directory, 'device-b', 'issuance', 'production-flow.json'),
    );
    await deviceAProducts.savePrivate('products', {
      cid: 'bafy-portable-product',
      contentHash,
      id: batchId,
      owner: '0x3000000000000000000000000000000000000003',
      payload,
    });
    const contentStore: CredentialContentStore = {
      decrypt: async () => serialized,
      encryptAndStore: async () => ({ cid: 'unused', payload }),
      retrieveAndDecrypt: async (cid) => {
        if (cid !== 'bafy-portable-product') throw new Error('IPFS object unavailable');
        return serialized;
      },
    };
    const reader = new RepositoryTraceabilityMetadataReader(
      deviceBProducts,
      new JsonIngredientBatchWorkflowRepository(
        join(directory, 'device-b', 'issuance', 'ingredient-batches.json'),
      ),
      contentStore,
      {
        ingredient: async () => undefined,
        product: async (requestedId) =>
          requestedId === batchId ? { cid: 'bafy-portable-product', contentHash } : undefined,
      },
    );

    await expect(reader.product(batchId)).resolves.toMatchObject({
      category: 'Confectionery',
      name: 'Dark Chocolate Bar',
      reference,
    });
    expect(await deviceBProducts.listPrivate('products')).toEqual([]);
  });

  it('rejects an IPFS hash or record binding mismatch instead of returning stale metadata', async () => {
    const batchId = id('EXPECTED-PRODUCT');
    let serialized = JSON.stringify({
      batchReference: 'OTHER-PRODUCT',
      productName: 'Wrong product',
    });
    const contentStore: CredentialContentStore = {
      decrypt: async () => serialized,
      encryptAndStore: async () => ({ cid: 'unused', payload }),
      retrieveAndDecrypt: async () => serialized,
    };
    const reader = new RepositoryTraceabilityMetadataReader(
      new JsonProductionFlowRepository(join(directory, 'device-b', 'production.json')),
      new JsonIngredientBatchWorkflowRepository(join(directory, 'device-b', 'ingredients.json')),
      contentStore,
      {
        ingredient: async () => undefined,
        product: async () => ({ cid: 'bafy-product', contentHash: hash(serialized) }),
      },
    );

    await expect(reader.product(batchId)).rejects.toThrow('binding mismatch');
    serialized = JSON.stringify({
      batchReference: 'EXPECTED-PRODUCT',
      productName: 'Tampered product',
    });
    const expectedHash = hash('different bytes');
    const integrityReader = new RepositoryTraceabilityMetadataReader(
      new JsonProductionFlowRepository(join(directory, 'device-c', 'production.json')),
      new JsonIngredientBatchWorkflowRepository(join(directory, 'device-c', 'ingredients.json')),
      contentStore,
      {
        ingredient: async () => undefined,
        product: async () => ({ cid: 'bafy-product', contentHash: expectedHash }),
      },
    );
    await expect(integrityReader.product(batchId)).rejects.toThrow('integrity mismatch');
  });
});

function hash(value: string) {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

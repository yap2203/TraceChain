import { createHash } from 'node:crypto';
import { id } from 'ethers';
import type { IngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { TraceabilityMetadataReader } from './product-traceability.types.js';

export class RepositoryTraceabilityMetadataReader implements TraceabilityMetadataReader {
  constructor(
    private readonly products: ProductionFlowRepository,
    private readonly ingredients: IngredientBatchWorkflowRepository,
    private readonly contentStore: CredentialContentStore,
    private readonly references?: {
      ingredient(batchId: string): Promise<{ cid: string; contentHash: string } | undefined>;
      product(batchId: string): Promise<{ cid: string; contentHash: string } | undefined>;
    },
  ) {}

  async product(batchId: string) {
    const record = await this.products.findPrivate('products', batchId);
    const reference = !record ? await this.references?.product(batchId) : undefined;
    if (!record && !reference) return undefined;
    if (!record && !this.contentStore.retrieveAndDecrypt)
      throw new Error('Encrypted product metadata recovery is unavailable.');
    const serialized = record
      ? await this.contentStore.decrypt(record.payload)
      : await this.contentStore.retrieveAndDecrypt!(reference!.cid);
    const expectedHash = record?.contentHash ?? reference!.contentHash;
    if (
      `0x${createHash('sha256').update(serialized).digest('hex')}`.toLowerCase() !==
      expectedHash.toLowerCase()
    )
      throw new Error('Product metadata integrity mismatch.');
    const metadata = JSON.parse(serialized) as Record<string, unknown>;
    if (
      typeof metadata.batchReference !== 'string' ||
      id(metadata.batchReference).toLowerCase() !== batchId.toLowerCase()
    )
      throw new Error('Product metadata binding mismatch.');
    return {
      category: stringValue(metadata.category),
      currency: stringValue(metadata.currency),
      description: stringValue(metadata.description),
      name: stringValue(metadata.productName),
      price: stringValue(metadata.price),
      productionLocationName: stringValue(metadata.productionLocationName),
      reference: stringValue(metadata.batchReference),
      unit: stringValue(metadata.unit),
    };
  }

  async ingredientReference(batchId: string) {
    const record = await this.ingredients.find(batchId);
    const reference = !record ? await this.references?.ingredient(batchId) : undefined;
    if (!record && !reference) return undefined;
    if (!record && !this.contentStore.retrieveAndDecrypt)
      throw new Error('Encrypted ingredient metadata recovery is unavailable.');
    const serialized = record
      ? await this.contentStore.decrypt(record.encryptedPayload)
      : await this.contentStore.retrieveAndDecrypt!(reference!.cid);
    const envelope = JSON.parse(serialized) as {
      metadata?: Record<string, unknown>;
    };
    const metadata = envelope.metadata ?? {};
    const expectedHash = record?.metadataHash ?? reference!.contentHash;
    if (
      `0x${createHash('sha256').update(JSON.stringify(metadata)).digest('hex')}`.toLowerCase() !==
      expectedHash.toLowerCase()
    )
      throw new Error('Ingredient metadata integrity mismatch.');
    if (
      typeof metadata.batchId !== 'string' ||
      id(metadata.batchId).toLowerCase() !== batchId.toLowerCase()
    )
      throw new Error('Ingredient metadata binding mismatch.');
    return stringValue(metadata.batchId);
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

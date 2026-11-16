import type { IngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { TraceabilityMetadataReader } from './product-traceability.types.js';

export class RepositoryTraceabilityMetadataReader implements TraceabilityMetadataReader {
  constructor(
    private readonly products: ProductionFlowRepository,
    private readonly ingredients: IngredientBatchWorkflowRepository,
    private readonly contentStore: CredentialContentStore,
  ) {}

  async product(batchId: string) {
    const record = await this.products.findPrivate('products', batchId);
    if (!record) return undefined;
    try {
      const metadata = JSON.parse(await this.contentStore.decrypt(record.payload)) as Record<
        string,
        unknown
      >;
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
    } catch {
      return undefined;
    }
  }

  async ingredientReference(batchId: string) {
    const record = await this.ingredients.find(batchId);
    if (!record) return undefined;
    try {
      const envelope = JSON.parse(await this.contentStore.decrypt(record.encryptedPayload)) as {
        metadata?: Record<string, unknown>;
      };
      return stringValue(envelope.metadata?.batchId);
    } catch {
      return undefined;
    }
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

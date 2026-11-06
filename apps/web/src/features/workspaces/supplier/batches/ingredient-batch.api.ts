import type { PreparedTransaction } from '../../../blockchain/blockchain.api';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export interface IngredientBatchInput {
  allergenInformation: string;
  batchReference: string;
  category: string;
  certifications: string[];
  expiryDate: string;
  ingredientName: string;
  origin: string;
  productionDate: string;
  quantity: string;
  unit: string;
}

export interface IngredientBatchWorkflow {
  batchId: string;
  credentialId: string;
  state: 'CREDENTIAL_REGISTRATION_REQUIRED' | 'BATCH_REGISTRATION_REQUIRED' | 'COMPLETE';
  supplierWallet: string;
  transaction?: PreparedTransaction;
}

export interface RegisteredIngredientBatch {
  allergenInformation: string;
  availableQuantity: string;
  batchId: string;
  batchReference: string;
  category: string;
  certifications: string[];
  credentialId: string;
  encryptedCid: string;
  expiresAt: number;
  ingredientName: string;
  metadataHash: string;
  origin: string;
  producedAt: number;
  quantity: string;
  status: number;
  supplier: string;
  unit: string;
}

export class IngredientBatchRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function prepareIngredientBatch(input: IngredientBatchInput) {
  return ingredientBatchRequest<IngredientBatchWorkflow>('/prepare', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function getIngredientBatches() {
  return ingredientBatchRequest<{ batches: RegisteredIngredientBatch[] }>('/');
}

async function ingredientBatchRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/ingredient-batches${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new IngredientBatchRequestError(
      body.error?.code ?? 'INGREDIENT_BATCH_REQUEST_FAILED',
      body.error?.message ?? 'The ingredient batch request failed.',
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

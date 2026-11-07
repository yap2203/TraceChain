import type { CompanyRole } from '@tracechain/shared';

import type { PreparedTransaction } from '../blockchain/blockchain.api';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/production-flow${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'The production workflow request failed.');
  }
  return response.json() as Promise<T>;
}

export interface ProductionIngredient {
  accepted: boolean;
  availableQuantity: string;
  batchId: string;
  expiresAt: number;
  supplier: string;
  supplierName?: string;
  unit: string;
}

export interface ProductionEvidenceRequest {
  accepted: boolean;
  dueAt: number;
  ingredientBatchId: string;
  presentationExpiresAt: number;
  requestId: string;
  requester: string;
  manufacturerName?: string;
  status: number;
  supplier: string;
  supplierName?: string;
  updatedAt: number;
}

export interface WorkflowResponse {
  actorWallet: string;
  batchId?: string;
  requestId?: string;
  state: 'COMPLETE' | 'TRANSACTION_REQUIRED';
  status?: number;
  transaction?: PreparedTransaction;
  transferId?: string;
}

export const listProductionIngredients = () =>
  request<{ batches: ProductionIngredient[] }>('/ingredients');
export const listEvidenceRequests = () =>
  request<{ requests: ProductionEvidenceRequest[] }>('/evidence-requests');
export interface StakeholderRecipient {
  active: boolean;
  companyName: string;
  role: CompanyRole;
  walletAddress: string;
}

export const listDistributors = () =>
  request<{ distributors: StakeholderRecipient[] }>('/distributors');

export interface DistributorInventoryProduct {
  availableQuantity: string;
  productBatchId: string;
  productName?: string;
  productReference?: string;
  reservedQuantity: string;
  unit: string;
}

export const listDistributorInventory = () =>
  request<{ products: DistributorInventoryProduct[] }>('/distributor/inventory');
export const listRetailers = () => request<{ retailers: StakeholderRecipient[] }>('/retailers');

export const prepareEvidenceRequest = (input: {
  batchId: string;
  claims: string[];
  dueAt: string;
  operationId: string;
  reason: string;
}) =>
  request<WorkflowResponse>('/evidence-requests/prepare', {
    body: JSON.stringify(input),
    method: 'POST',
  });
export const prepareEvidenceResponse = (requestId: string) =>
  request<WorkflowResponse>(`/evidence-requests/${requestId}/respond/prepare`, { method: 'POST' });
export const prepareEvidenceAcceptance = (requestId: string) =>
  request<WorkflowResponse>(`/evidence-requests/${requestId}/accept/prepare`, { method: 'POST' });
export const prepareProduct = (input: {
  batchReference: string;
  category: string;
  expiresAt: string;
  ingredientLinks: Array<{ batchId: string; quantity: string }>;
  privateMetadata: Record<string, string>;
  producedAt: string;
  productName: string;
  quantity: string;
  unit: string;
}) =>
  request<WorkflowResponse>('/products/prepare', { body: JSON.stringify(input), method: 'POST' });
export const prepareTransfer = (input: {
  expectedAt: string;
  productBatchId: string;
  quantity: string;
  recipient: string;
  shipmentReference: string;
}) =>
  request<WorkflowResponse>('/transfers/prepare', { body: JSON.stringify(input), method: 'POST' });

export const prepareDistributorTransfer = (input: {
  expectedAt: string;
  handlingNotes: string;
  operationId: string;
  productBatchId: string;
  quantity: string;
  recipient: string;
  shipmentReference: string;
}) =>
  request<WorkflowResponse>('/distributor/transfers/prepare', {
    body: JSON.stringify(input),
    method: 'POST',
  });

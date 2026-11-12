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
  accepted?: boolean;
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
  requesterRole?: CompanyRole;
  manufacturerName?: string;
  requesterName?: string;
  status: number;
  supplier: string;
  supplierName?: string;
  updatedAt: number;
  verification?: { state: 'NOT_VERIFIED' | 'PASSED'; verifiedAt?: string };
}

export interface WorkflowResponse {
  production?: { location: string; recordedAt: number };
  actorWallet: string;
  batchId?: string;
  requestId?: string;
  holderSigning?: {
    audience: string;
    claims: string[];
    credential: string;
    holderDid: string;
    nonce: string;
    purpose: string;
    requiredClaims: string[];
  };
  state: 'COMPLETE' | 'HOLDER_SIGNATURE_REQUIRED' | 'TRANSACTION_REQUIRED';
  status?: number;
  transaction?: PreparedTransaction;
  transferId?: string;
}

export const listProductionIngredients = (location?: string, purpose?: 'production') =>
  request<{ batches: ProductionIngredient[] }>(
    `/ingredients${location || purpose ? '?' + new URLSearchParams({ ...(location ? { location } : {}), ...(purpose ? { purpose } : {}) }) : ''}`,
  );
export const listEvidenceRequests = () =>
  request<{ requests: ProductionEvidenceRequest[] }>('/evidence-requests');
export interface RetailerEvidenceOption {
  ingredientBatchId: string;
  productBatchId: string;
  quantity: string;
  supplier: string;
  supplierName?: string;
}
export const listRetailerEvidenceOptions = () =>
  request<{ options: RetailerEvidenceOption[] }>('/retailer/evidence-options');
export interface EvidenceDetails {
  batchId: string;
  claims: string[];
  requiredClaims: string[];
  dueAt: number;
  presentation?: unknown;
  presentationExpiresAt: number;
  reason: string;
  requestId: string;
  requester: string;
  status: number;
  supplier: string;
}
export const getEvidenceDetails = (requestId: string) =>
  request<EvidenceDetails>(`/evidence-requests/${requestId}`);
export interface EvidenceReview {
  batchId: string;
  credentialExpiry: string;
  credentialId: string;
  disclosure: 'FULL_INGREDIENT_CREDENTIAL' | 'SELECTIVE_SD_JWT';
  presentationExpiry: string;
  requestId: string;
  sharedClaims: Record<string, unknown>;
  supplier: string;
  supplierName?: string;
  status: number;
  verification: { state: 'NOT_VERIFIED' | 'PASSED'; verifiedAt?: string };
}
export const reviewEvidence = (requestId: string) =>
  request<EvidenceReview>(`/evidence-requests/${requestId}/review`);
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
  requiredClaims: string[];
  dueAt: string;
  operationId: string;
  productBatchId?: string;
  reason: string;
}) =>
  request<WorkflowResponse>('/evidence-requests/prepare', {
    body: JSON.stringify(input),
    method: 'POST',
  });
export const prepareEvidenceResponse = (requestId: string, presentation?: string) =>
  request<WorkflowResponse>(`/evidence-requests/${requestId}/respond/prepare`, {
    body: presentation ? JSON.stringify({ presentation }) : undefined,
    method: 'POST',
  });
export const prepareEvidenceAcceptance = (requestId: string) =>
  request<WorkflowResponse>(`/evidence-requests/${requestId}/accept/prepare`, { method: 'POST' });
export const prepareEvidenceClose = (
  requestId: string,
  input: { reason: string; status: 'DECLINED' | 'REJECTED' | 'CANCELLED' },
) =>
  request<WorkflowResponse>(`/evidence-requests/${requestId}/close/prepare`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
export interface EvidenceVerificationResult {
  checks: Array<{ code: string; passed: boolean }>;
  credentialId: string;
  requestId: string;
  verifiedAt: string;
}
export const verifyEvidence = (requestId: string) =>
  request<EvidenceVerificationResult>(`/evidence-requests/${requestId}/verify`, {
    method: 'POST',
  });
export interface CompanyIdentityProofStatus {
  expiresAt?: number;
  presenterRole?: string;
  presenterWallet?: string;
  purpose?: string;
  requestId: string;
  status: 'NOT_REQUESTED' | 'REQUESTED' | 'PRESENTED' | 'VERIFIED' | 'DECLINED' | 'EXPIRED';
  verifiedAt?: string;
  checks?: string[];
  credential?: {
    credentialHash: string;
    credentialId: string;
    credentialStatus: string;
    expirationDate: string;
    issuanceDate: string;
    issuer: string;
    issuerName?: string;
    subject: {
      companyId: string;
      companyName: string;
      companyRegistrationNumber: string;
      id: string;
      role: string;
      walletAddress: string;
    };
  };
}
export interface CompanyIdentityProofMaterial {
  audience: string;
  challenge: string;
  credential: Record<string, unknown>;
  credentialHash: string;
  expiresAt: number;
  holderDid: string;
  presenterRole: string;
  presenterWallet: string;
  purpose: string;
  requestId: string;
}
export const requestCompanyIdentityProof = (requestId: string) =>
  request<CompanyIdentityProofStatus>(`/evidence-requests/${requestId}/company-identity/request`, {
    method: 'POST',
  });
export const getCompanyIdentityProofStatus = (requestId: string) =>
  request<CompanyIdentityProofStatus>(`/evidence-requests/${requestId}/company-identity`);
export const getCompanyIdentityProofMaterial = (requestId: string) =>
  request<CompanyIdentityProofMaterial>(
    `/evidence-requests/${requestId}/company-identity/material`,
  );
export const presentCompanyIdentityProof = (requestId: string, presentation: string) =>
  request<CompanyIdentityProofStatus>(`/evidence-requests/${requestId}/company-identity/present`, {
    body: JSON.stringify({ presentation }),
    method: 'POST',
  });
export const declineCompanyIdentityProof = (requestId: string) =>
  request<CompanyIdentityProofStatus>(`/evidence-requests/${requestId}/company-identity/decline`, {
    method: 'POST',
  });
export const verifyCompanyIdentityProof = (requestId: string) =>
  request<CompanyIdentityProofStatus>(`/evidence-requests/${requestId}/company-identity/verify`, {
    method: 'POST',
  });
export const prepareProduct = (input: {
  price?: string;
  currency?: string;
  productionLocation?: string;
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

import type { PreparedTransaction } from '../blockchain/blockchain-gateway.service.js';

export interface ChainEvidenceRequest {
  challengeHash: string;
  claimsHash: string;
  dueAt: number;
  ingredientBatchId: string;
  presentationCid: string;
  presentationExpiresAt: number;
  presentationHash: string;
  requestCid: string;
  requester: string;
  status: number;
  supplier: string;
  updatedAt: number;
}

export interface ChainIngredientBatch {
  availableQuantity: string;
  credentialId: string;
  encryptedCid: string;
  expiresAt: number;
  metadataHash: string;
  producedAt: number;
  status: number;
  supplier: string;
  totalQuantity: string;
  unit: string;
}

export interface ChainProduct {
  expiresAt: number;
  manufacturer: string;
  metadataHash: string;
  producedAt: number;
  publicCid: string;
  status: number;
  totalQuantity: string;
  unit: string;
}

export interface ChainTransfer {
  expectedAt: number;
  productBatchId: string;
  quantity: string;
  recipient: string;
  sender: string;
  shipmentCid: string;
  shipmentHash: string;
  status: number;
  transferId: string;
}

export interface WorkflowResult {
  actorWallet: string;
  state: 'COMPLETE' | 'TRANSACTION_REQUIRED';
  transaction?: PreparedTransaction;
}

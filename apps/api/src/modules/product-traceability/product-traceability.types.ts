export interface TraceabilityProductRecord {
  expiresAt: number;
  manufacturer: string;
  producedAt: number;
  status: number;
}

export interface TraceabilityIngredientRecord {
  credentialId: string;
  expiresAt: number;
  status: number;
  supplier: string;
}

export interface TraceabilityCredentialRecord {
  credentialType: number;
  expiresAt: number;
  issuer: string;
  status: number;
  subject: string;
}

export interface TraceabilityTransferRecord {
  dispatchedAt: number;
  dispatchTransactionHash?: string;
  productBatchId: string;
  quantity: string;
  receiptTransactionHash?: string;
  receivedAt?: number;
  recipient: string;
  sender: string;
  status: number;
  transferId: string;
  lifecycleEvents?: Array<{
    status?: number;
    timestamp: number;
    transactionHash?: string;
    type: 'DISCREPANCY_REPORTED' | 'STATUS_CHANGED';
  }>;
}

export interface TraceabilityMetadataReader {
  ingredientReference(batchId: string): Promise<string | undefined>;
  product(batchId: string): Promise<{ name?: string; reference?: string } | undefined>;
}

export interface ProductTraceabilityConfiguration {
  chainId: number;
  productRegistryAddress: string;
  publicAppUrl: string;
}

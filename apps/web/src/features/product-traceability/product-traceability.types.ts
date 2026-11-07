export interface ProductTraceabilityResponse {
  accessLevel: 'PUBLIC' | 'AUTHORIZED';
  verificationMessage: string;
  disclaimer: string;
  product: {
    expiresAt: number;
    manufacturerName: string;
    name: string;
    producedAt: number;
    reference: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'RECALLED' | 'EXPIRED' | 'UNKNOWN';
  };
  ingredients: Array<{
    credentialStatus: string;
    reference: string;
    status: string;
    supplierName: string;
    verified: boolean;
    technical?: { batchId: string; credentialId: string; supplierWallet: string };
  }>;
  credentialSummary: { active: number; total: number; verified: boolean };
  currentCustodianName: string;
  timeline: Array<{
    action: string;
    organizationName: string;
    status: string;
    timestamp: number;
    type: string;
  }>;
  technical?: {
    batchId: string;
    chainId: number;
    currentCustodianWallet: string;
    manufacturerWallet: string;
    productRegistryAddress: string;
    transfers: Array<{
      dispatchTransactionHash?: string;
      quantity: string;
      receiptTransactionHash?: string;
      recipientWallet: string;
      senderWallet: string;
      transferId: string;
    }>;
  };
}

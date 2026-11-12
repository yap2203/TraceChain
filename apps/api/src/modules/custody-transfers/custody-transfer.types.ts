export interface CustodyTransferRecord {
  damaged: bigint;
  dispatchedAt: bigint;
  expectedAt: bigint;
  productBatchId: string;
  quantity: bigint;
  recipient: string;
  rejected: bigint;
  sender: string;
  status: number;
  usable: bigint;
}

export interface CustodyTransferSummary {
  actualArrivalAt?: string | null;
  damaged: string;
  dispatchedAt: number;
  expectedAt: number;
  productBatchId: string;
  productName: string;
  productReference: string;
  quantity: string;
  recipient: string;
  recipientName?: string;
  rejected: string;
  sender: string;
  senderName?: string;
  status: number;
  transferId: string;
  usable: string;
}

export interface CustodyEvidenceReference {
  cid?: string;
  contentHash: string;
}

export interface CustodyDiscrepancyRecord {
  actualQuantity: bigint;
  detailsHash: string;
  evidenceCid: string;
  expectedQuantity: bigint;
  kind: number;
  reportedAt: number;
  resolved: boolean;
  transferId: string;
}

export interface CustodyTransferConfiguration {
  chainId: number;
  contractAddress: string;
  publicAppUrl: string;
}

export interface PreparedCustodyTransferTransaction {
  chainId: number;
  data: string;
  to: string;
  value: string;
}

export interface ReceiptEvidenceInput {
  dataBase64: string;
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
}

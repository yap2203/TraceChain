export interface ResolvedCustodyTransfer {
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
  status: 1 | 2 | 3 | 4 | 5;
  transferId: string;
  usable: string;
}

export interface PreparedReceiptConfirmation {
  chainId: number;
  data: string;
  to: string;
  value: string;
}

export interface ReceiptEvidenceUpload {
  dataBase64: string;
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface PreparedReceiptAction {
  action: 'CONFIRM_RECEIPT' | 'REPORT_DISCREPANCY' | 'REJECT_TRANSFER';
  discrepancyType?: 'EXCESS' | 'SHORTAGE';
  transaction: PreparedReceiptConfirmation;
  usableQuantity?: string;
}

export interface AdminCustodyDiscrepancy extends ResolvedCustodyTransfer {
  actualQuantity: string;
  discrepancyType: 'DAMAGE' | 'EXCESS' | 'NONE' | 'OTHER' | 'SHORTAGE' | 'WRONG_PRODUCT';
  expectedQuantity: string;
  privateDetails?: {
    evidence?: ReceiptEvidenceUpload[];
    notes?: string;
  };
  reportedAt: number;
  resolved: boolean;
  technical: {
    detailsHash: string;
    evidenceCid: string;
    recipientWallet: string;
    senderWallet: string;
    transferId: string;
  };
}

export interface PreparedDiscrepancyResolution {
  actorWallet: string;
  decision: 'ACCEPT_ACTUAL' | 'CANCEL_TRANSFER';
  transaction: PreparedReceiptConfirmation;
}

export interface TransferQrConfiguration {
  chainId: number;
  contractAddress: string;
}

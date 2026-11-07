export interface ResolvedCustodyTransfer {
  dispatchedAt: number;
  expectedAt: number;
  productBatchId: string;
  quantity: string;
  recipient: string;
  recipientName?: string;
  sender: string;
  senderName?: string;
  status: 1 | 2;
  transferId: string;
}

export interface PreparedReceiptConfirmation {
  chainId: number;
  data: string;
  to: string;
  value: string;
}

export interface TransferQrConfiguration {
  chainId: number;
  contractAddress: string;
}

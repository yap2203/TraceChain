export interface ResolvedCustodyTransfer {
  dispatchedAt: number;
  expectedAt: number;
  productBatchId: string;
  quantity: string;
  recipient: string;
  sender: string;
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

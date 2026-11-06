export interface ResolvedCustodyTransfer {
  dispatchedAt: number;
  expectedAt: number;
  productBatchId: string;
  quantity: string;
  recipient: string;
  sender: string;
  status: 1;
  transferId: string;
}

export interface TransferQrConfiguration {
  chainId: number;
  contractAddress: string;
}

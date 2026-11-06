export interface CustodyTransferRecord {
  dispatchedAt: bigint;
  expectedAt: bigint;
  productBatchId: string;
  quantity: bigint;
  recipient: string;
  sender: string;
  status: number;
}

export interface CustodyTransferSummary {
  dispatchedAt: number;
  expectedAt: number;
  productBatchId: string;
  quantity: string;
  recipient: string;
  sender: string;
  status: 1;
  transferId: string;
}

export interface CustodyTransferConfiguration {
  chainId: number;
  contractAddress: string;
}

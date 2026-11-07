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
  recipientName?: string;
  sender: string;
  senderName?: string;
  status: number;
  transferId: string;
}

export interface CustodyTransferConfiguration {
  chainId: number;
  contractAddress: string;
}

export interface PreparedCustodyTransferTransaction {
  chainId: number;
  data: string;
  to: string;
  value: string;
}

import { Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';

import type {
  CustodyDiscrepancyRecord,
  CustodyTransferRecord,
  PreparedCustodyTransferTransaction,
} from './custody-transfer.types.js';

const custodyTransferAbi = [
  'error InvalidInput()',
  'event DiscrepancyReported(bytes32 indexed transferId,uint8 kind,uint256 expected,uint256 actual,bytes32 detailsHash,string evidenceCid)',
  'function getTransfer(bytes32 id) view returns (tuple(bytes32 productBatchId,address sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid,uint64 dispatchedAt,uint64 expectedAt,uint8 status,uint256 usable,uint256 damaged,uint256 rejected))',
  'function getDiscrepancy(bytes32 id) view returns (tuple(uint8 kind,uint256 actualQuantity,bytes32 detailsHash,string evidenceCid,bool resolved))',
  'function confirmReceipt(bytes32 transferId,uint256 totalReceived,uint256 damaged,uint256 rejectedQuantity,bytes32 receiptHash,string receiptCid)',
  'function reportDiscrepancy(bytes32 transferId,uint8 kind,uint256 actualQuantity,bytes32 detailsHash,string evidenceCid)',
  'function reject(bytes32 transferId,bytes32 reasonHash)',
  'function resolveDiscrepancy(bytes32 transferId,bool acceptActual,bytes32 reasonHash)',
] as const;

const custodyTransferInterface = new Interface(custodyTransferAbi);

export interface CustodyTransferGateway {
  getTransfer(transferId: string): Promise<CustodyTransferRecord | null>;
  getDiscrepancy(transferId: string): Promise<CustodyDiscrepancyRecord | null>;
  listDiscrepancies(): Promise<CustodyDiscrepancyRecord[]>;
  prepareReceiptConfirmation(input: {
    chainId: number;
    contractAddress: string;
    damaged: bigint;
    quantity: bigint;
    receiptCid: string;
    receiptHash: string;
    rejected: bigint;
    transferId: string;
  }): PreparedCustodyTransferTransaction;
  prepareDiscrepancyReport(input: {
    actualQuantity: bigint;
    chainId: number;
    contractAddress: string;
    detailsHash: string;
    evidenceCid: string;
    kind: number;
    transferId: string;
  }): PreparedCustodyTransferTransaction;
  prepareRejection(input: {
    chainId: number;
    contractAddress: string;
    reasonHash: string;
    transferId: string;
  }): PreparedCustodyTransferTransaction;
  prepareDiscrepancyResolution(input: {
    acceptActual: boolean;
    chainId: number;
    contractAddress: string;
    reasonHash: string;
    transferId: string;
  }): PreparedCustodyTransferTransaction;
}

export class EthersCustodyTransferGateway implements CustodyTransferGateway {
  private readonly provider: JsonRpcProvider;
  private readonly contract: Contract;

  constructor(chainId: number, rpcUrl: string, contractAddress: string) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.contract = new Contract(contractAddress, custodyTransferAbi, this.provider);
  }

  async getTransfer(transferId: string): Promise<CustodyTransferRecord | null> {
    try {
      const transfer = await this.contract.getTransfer(transferId);
      return {
        damaged: BigInt(transfer.damaged),
        dispatchedAt: BigInt(transfer.dispatchedAt),
        expectedAt: BigInt(transfer.expectedAt),
        productBatchId: String(transfer.productBatchId),
        quantity: BigInt(transfer.quantity),
        recipient: getAddress(String(transfer.recipient)),
        rejected: BigInt(transfer.rejected),
        sender: getAddress(String(transfer.sender)),
        status: Number(transfer.status),
        usable: BigInt(transfer.usable),
      };
    } catch (error) {
      if (isMissingTransferError(error)) return null;
      throw error;
    }
  }

  async getDiscrepancy(transferId: string): Promise<CustodyDiscrepancyRecord | null> {
    const events = await this.contract.queryFilter(
      this.contract.filters.DiscrepancyReported(transferId),
    );
    const event = events.at(-1);
    if (!event) return null;
    const record = await this.contract.getDiscrepancy(transferId);
    const args = (event as unknown as { args: { expected: bigint } }).args;
    const block = await this.provider.getBlock(event.blockNumber);
    return {
      actualQuantity: BigInt(record.actualQuantity),
      detailsHash: String(record.detailsHash),
      evidenceCid: String(record.evidenceCid),
      expectedQuantity: BigInt(args.expected),
      kind: Number(record.kind),
      reportedAt: Number(block?.timestamp ?? 0),
      resolved: Boolean(record.resolved),
      transferId,
    };
  }

  async listDiscrepancies() {
    const events = await this.contract.queryFilter(this.contract.filters.DiscrepancyReported());
    const transferIds = [
      ...new Set(
        events.map((event) =>
          String((event as unknown as { args: { transferId: string } }).args.transferId),
        ),
      ),
    ];
    return Promise.all(
      transferIds.map((transferId) => this.getDiscrepancy(transferId).then((record) => record!)),
    );
  }

  prepareReceiptConfirmation(input: {
    chainId: number;
    contractAddress: string;
    damaged: bigint;
    quantity: bigint;
    receiptCid: string;
    receiptHash: string;
    rejected: bigint;
    transferId: string;
  }): PreparedCustodyTransferTransaction {
    return {
      chainId: input.chainId,
      data: custodyTransferInterface.encodeFunctionData('confirmReceipt', [
        input.transferId,
        input.quantity,
        input.damaged,
        input.rejected,
        input.receiptHash,
        input.receiptCid,
      ]),
      to: getAddress(input.contractAddress),
      value: '0x0',
    };
  }

  prepareDiscrepancyReport(input: {
    actualQuantity: bigint;
    chainId: number;
    contractAddress: string;
    detailsHash: string;
    evidenceCid: string;
    kind: number;
    transferId: string;
  }) {
    return prepared(
      input.chainId,
      input.contractAddress,
      custodyTransferInterface.encodeFunctionData('reportDiscrepancy', [
        input.transferId,
        input.kind,
        input.actualQuantity,
        input.detailsHash,
        input.evidenceCid,
      ]),
    );
  }

  prepareRejection(input: {
    chainId: number;
    contractAddress: string;
    reasonHash: string;
    transferId: string;
  }) {
    return prepared(
      input.chainId,
      input.contractAddress,
      custodyTransferInterface.encodeFunctionData('reject', [input.transferId, input.reasonHash]),
    );
  }

  prepareDiscrepancyResolution(input: {
    acceptActual: boolean;
    chainId: number;
    contractAddress: string;
    reasonHash: string;
    transferId: string;
  }) {
    return prepared(
      input.chainId,
      input.contractAddress,
      custodyTransferInterface.encodeFunctionData('resolveDiscrepancy', [
        input.transferId,
        input.acceptActual,
        input.reasonHash,
      ]),
    );
  }
}

function prepared(chainId: number, contractAddress: string, data: string) {
  return { chainId, data, to: getAddress(contractAddress), value: '0x0' };
}

function isMissingTransferError(error: unknown) {
  const candidate = error as {
    data?: string;
    info?: { error?: { data?: string } };
    revert?: { name?: string };
  };
  if (candidate?.revert?.name === 'InvalidInput') return true;

  const data = candidate?.data ?? candidate?.info?.error?.data;
  if (typeof data !== 'string') return false;

  try {
    return custodyTransferInterface.parseError(data)?.name === 'InvalidInput';
  } catch {
    return false;
  }
}

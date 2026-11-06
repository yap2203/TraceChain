import { Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';

import type {
  CustodyTransferRecord,
  PreparedCustodyTransferTransaction,
} from './custody-transfer.types.js';

const custodyTransferAbi = [
  'error InvalidInput()',
  'function getTransfer(bytes32 id) view returns (tuple(bytes32 productBatchId,address sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid,uint64 dispatchedAt,uint64 expectedAt,uint8 status,uint256 usable,uint256 damaged,uint256 rejected))',
  'function confirmReceipt(bytes32 transferId,uint256 totalReceived,uint256 damaged,uint256 rejectedQuantity,bytes32 receiptHash,string receiptCid)',
] as const;

const custodyTransferInterface = new Interface(custodyTransferAbi);

export interface CustodyTransferGateway {
  getTransfer(transferId: string): Promise<CustodyTransferRecord | null>;
  prepareReceiptConfirmation(input: {
    chainId: number;
    contractAddress: string;
    quantity: bigint;
    receiptHash: string;
    transferId: string;
  }): PreparedCustodyTransferTransaction;
}

export class EthersCustodyTransferGateway implements CustodyTransferGateway {
  private readonly contract: Contract;

  constructor(chainId: number, rpcUrl: string, contractAddress: string) {
    const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.contract = new Contract(contractAddress, custodyTransferAbi, provider);
  }

  async getTransfer(transferId: string): Promise<CustodyTransferRecord | null> {
    try {
      const transfer = await this.contract.getTransfer(transferId);
      return {
        dispatchedAt: BigInt(transfer.dispatchedAt),
        expectedAt: BigInt(transfer.expectedAt),
        productBatchId: String(transfer.productBatchId),
        quantity: BigInt(transfer.quantity),
        recipient: getAddress(String(transfer.recipient)),
        sender: getAddress(String(transfer.sender)),
        status: Number(transfer.status),
      };
    } catch (error) {
      if (isMissingTransferError(error)) return null;
      throw error;
    }
  }

  prepareReceiptConfirmation(input: {
    chainId: number;
    contractAddress: string;
    quantity: bigint;
    receiptHash: string;
    transferId: string;
  }): PreparedCustodyTransferTransaction {
    return {
      chainId: input.chainId,
      data: custodyTransferInterface.encodeFunctionData('confirmReceipt', [
        input.transferId,
        input.quantity,
        0,
        0,
        input.receiptHash,
        '',
      ]),
      to: getAddress(input.contractAddress),
      value: '0x0',
    };
  }
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

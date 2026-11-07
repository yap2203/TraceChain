import { Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';

import type {
  TraceabilityCredentialRecord,
  TraceabilityIngredientRecord,
  TraceabilityProductRecord,
  TraceabilityTransferRecord,
} from './product-traceability.types.js';

const productAbi = [
  'error InvalidInput()',
  'function getProduct(bytes32) view returns (tuple(address manufacturer,bytes32 metadataHash,string publicCid,uint256 totalQuantity,bytes32 unit,uint64 producedAt,uint64 expiresAt,uint8 status))',
  'function getIngredientLinks(bytes32) view returns (tuple(bytes32 batchId,uint256 quantity)[])',
] as const;
const ingredientAbi = [
  'error InvalidInput()',
  'function getBatch(bytes32) view returns (tuple(address supplier,bytes32 metadataHash,string encryptedCid,bytes32 credentialId,uint256 totalQuantity,uint256 availableQuantity,bytes32 unit,uint64 producedAt,uint64 expiresAt,uint8 status))',
] as const;
const credentialAbi = [
  'error InvalidInput()',
  'function getCredential(bytes32) view returns (tuple(bytes32 credentialHash,string encryptedCid,address issuer,address subject,uint8 credentialType,uint8 status,uint64 issuedAt,uint64 expiresAt,uint64 updatedAt))',
] as const;
const custodyAbi = [
  'event TransferCreated(bytes32 indexed transferId,bytes32 indexed productBatchId,address indexed sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid)',
  'event ReceiptConfirmed(bytes32 indexed transferId,address indexed recipient,uint256 usable,uint256 damaged,uint256 rejected,bytes32 receiptHash,string receiptCid)',
  'function getTransfer(bytes32) view returns (tuple(bytes32 productBatchId,address sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid,uint64 dispatchedAt,uint64 expectedAt,uint8 status,uint256 usable,uint256 damaged,uint256 rejected))',
] as const;

const productInterface = new Interface(productAbi);
const ingredientInterface = new Interface(ingredientAbi);
const credentialInterface = new Interface(credentialAbi);

export interface ProductTraceabilityGateway {
  getProduct(batchId: string): Promise<TraceabilityProductRecord | null>;
  getIngredientLinks(batchId: string): Promise<string[]>;
  getIngredient(batchId: string): Promise<TraceabilityIngredientRecord | null>;
  getCredential(credentialId: string): Promise<TraceabilityCredentialRecord | null>;
  listTransfers(batchId: string): Promise<TraceabilityTransferRecord[]>;
}

export class EthersProductTraceabilityGateway implements ProductTraceabilityGateway {
  private readonly provider: JsonRpcProvider;
  private readonly products: Contract;
  private readonly ingredients: Contract;
  private readonly credentials: Contract;
  private readonly custody: Contract;

  constructor(
    chainId: number,
    rpcUrl: string,
    addresses: { product: string; ingredient: string; credential: string; custody: string },
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.products = new Contract(addresses.product, productAbi, this.provider);
    this.ingredients = new Contract(addresses.ingredient, ingredientAbi, this.provider);
    this.credentials = new Contract(addresses.credential, credentialAbi, this.provider);
    this.custody = new Contract(addresses.custody, custodyAbi, this.provider);
  }

  async getProduct(batchId: string) {
    try {
      const record = await this.products.getProduct(batchId);
      return {
        expiresAt: Number(record.expiresAt),
        manufacturer: getAddress(String(record.manufacturer)),
        producedAt: Number(record.producedAt),
        status: Number(record.status),
      };
    } catch (error) {
      if (isMissing(error, productInterface)) return null;
      throw error;
    }
  }

  async getIngredientLinks(batchId: string) {
    const records = await this.products.getIngredientLinks(batchId);
    return Array.from(records as ArrayLike<{ batchId: string }>).map((record) =>
      String(record.batchId),
    );
  }

  async getIngredient(batchId: string) {
    try {
      const record = await this.ingredients.getBatch(batchId);
      return {
        credentialId: String(record.credentialId),
        expiresAt: Number(record.expiresAt),
        status: Number(record.status),
        supplier: getAddress(String(record.supplier)),
      };
    } catch (error) {
      if (isMissing(error, ingredientInterface)) return null;
      throw error;
    }
  }

  async getCredential(credentialId: string) {
    try {
      const record = await this.credentials.getCredential(credentialId);
      return {
        credentialType: Number(record.credentialType),
        expiresAt: Number(record.expiresAt),
        issuer: getAddress(String(record.issuer)),
        status: Number(record.status),
        subject: getAddress(String(record.subject)),
      };
    } catch (error) {
      if (isMissing(error, credentialInterface)) return null;
      throw error;
    }
  }

  async listTransfers(batchId: string) {
    const events = await this.custody.queryFilter(
      this.custody.filters.TransferCreated(null, batchId),
    );
    return Promise.all(
      events.map(async (event) => {
        const args = (event as unknown as { args: { transferId: string } }).args;
        const transferId = String(args.transferId);
        const record = await this.custody.getTransfer(transferId);
        const receiptEvents = await this.custody.queryFilter(
          this.custody.filters.ReceiptConfirmed(transferId),
        );
        const receiptEvent = receiptEvents.at(-1);
        const receiptBlock = receiptEvent
          ? await this.provider.getBlock(receiptEvent.blockNumber)
          : undefined;
        return {
          dispatchedAt: Number(record.dispatchedAt),
          dispatchTransactionHash: event.transactionHash,
          productBatchId: String(record.productBatchId),
          quantity: String(record.quantity),
          receiptTransactionHash: receiptEvent?.transactionHash,
          receivedAt: receiptBlock ? Number(receiptBlock.timestamp) : undefined,
          recipient: getAddress(String(record.recipient)),
          sender: getAddress(String(record.sender)),
          status: Number(record.status),
          transferId,
        };
      }),
    );
  }
}

function isMissing(error: unknown, contractInterface: Interface) {
  const candidate = error as { data?: string; info?: { error?: { data?: string } } };
  const data = candidate.data ?? candidate.info?.error?.data;
  if (typeof data !== 'string') return false;
  try {
    return contractInterface.parseError(data)?.name === 'InvalidInput';
  } catch {
    return false;
  }
}

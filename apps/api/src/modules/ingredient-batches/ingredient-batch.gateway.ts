import { Contract, Interface, JsonRpcProvider, encodeBytes32String, getAddress, id } from 'ethers';

import type { PreparedTransaction } from '../blockchain/blockchain-gateway.service.js';

const stakeholderAbi = [
  'function getStakeholder(address) view returns (tuple(uint8 role,uint8 status,bytes32 credentialHash,string credentialCid,uint64 credentialExpiresAt,uint64 updatedAt))',
  'function roleHasPermission(uint8,bytes32) view returns (bool)',
] as const;
const credentialAbi = [
  'error InvalidInput()',
  'function credentialIdByHash(bytes32) view returns (bytes32)',
  'function effectiveStatus(bytes32) view returns (uint8)',
  'function getCredential(bytes32) view returns (tuple(bytes32 credentialHash,string encryptedCid,address issuer,address subject,uint8 credentialType,uint8 status,uint64 issuedAt,uint64 expiresAt,uint64 updatedAt))',
  'function registerCredential(bytes32,bytes32,string,address,uint8,uint64)',
] as const;
const ingredientAbi = [
  'error InvalidInput()',
  'event IngredientBatchRegistered(bytes32 indexed batchId,address indexed supplier,bytes32 indexed credentialId,uint256 quantity,bytes32 metadataHash,string encryptedCid)',
  'function stakeholders() view returns (address)',
  'function credentials() view returns (address)',
  'function getBatch(bytes32) view returns (tuple(address supplier,bytes32 metadataHash,string encryptedCid,bytes32 credentialId,uint256 totalQuantity,uint256 availableQuantity,bytes32 unit,uint64 producedAt,uint64 expiresAt,uint8 status))',
  'function registerBatch(bytes32,bytes32,string,bytes32,uint256,bytes32,uint64,uint64)',
] as const;

const credentialInterface = new Interface(credentialAbi);
const ingredientInterface = new Interface(ingredientAbi);

export interface IngredientBatchGateway {
  assertDeployment(): Promise<void>;
  getBatch(batchId: string): Promise<ChainIngredientBatch | null>;
  getCredential(credentialId: string): Promise<ChainIngredientCredential | null>;
  getSupplierAccess(
    wallet: string,
    companyRoleCredentialHash: string,
  ): Promise<{
    credentialAuthorized: boolean;
    issuePermission: boolean;
    registerPermission: boolean;
    role: number;
    status: number;
  }>;
  listBatchIds(supplierWallet: string): Promise<string[]>;
  prepareBatchRegistration(input: {
    batchId: string;
    credentialId: string;
    encryptedCid: string;
    expiresAt: number;
    metadataHash: string;
    producedAt: number;
    quantity: string;
    unit: string;
  }): PreparedTransaction;
  prepareIngredientCredentialRegistration(input: {
    credentialHash: string;
    credentialId: string;
    encryptedCid: string;
    expiresAt: number;
    supplierWallet: string;
  }): PreparedTransaction;
}

export interface ChainIngredientCredential {
  credentialHash: string;
  credentialType: number;
  encryptedCid: string;
  expiresAt: number;
  issuer: string;
  status: number;
  subject: string;
}

export interface ChainIngredientBatch {
  availableQuantity: string;
  credentialId: string;
  encryptedCid: string;
  expiresAt: number;
  metadataHash: string;
  producedAt: number;
  status: number;
  supplier: string;
  totalQuantity: string;
  unit: string;
}

export class EthersIngredientBatchGateway implements IngredientBatchGateway {
  private readonly provider: JsonRpcProvider;
  private readonly stakeholders: Contract;
  private readonly credentials: Contract;
  private readonly ingredients: Contract;

  constructor(
    private readonly chainId: number,
    rpcUrl: string,
    private readonly stakeholderAddress: string,
    private readonly credentialAddress: string,
    private readonly ingredientAddress: string,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.stakeholders = new Contract(stakeholderAddress, stakeholderAbi, this.provider);
    this.credentials = new Contract(credentialAddress, credentialAbi, this.provider);
    this.ingredients = new Contract(ingredientAddress, ingredientAbi, this.provider);
  }

  async assertDeployment() {
    const [rpcChainId, stakeholderCode, credentialCode, ingredientCode] = await Promise.all([
      this.provider.send('eth_chainId', []),
      this.provider.getCode(this.stakeholderAddress),
      this.provider.getCode(this.credentialAddress),
      this.provider.getCode(this.ingredientAddress),
    ]);
    if (BigInt(rpcChainId as string) !== BigInt(this.chainId)) {
      throw new Error('The ingredient workflow RPC is connected to the wrong chain.');
    }
    if ([stakeholderCode, credentialCode, ingredientCode].includes('0x')) {
      throw new Error('A configured ingredient workflow contract is not deployed.');
    }
    if (
      getAddress(await this.ingredients.stakeholders()) !== getAddress(this.stakeholderAddress) ||
      getAddress(await this.ingredients.credentials()) !== getAddress(this.credentialAddress)
    ) {
      throw new Error('The configured ingredient contracts do not belong to one deployment.');
    }
  }

  async getSupplierAccess(wallet: string, companyRoleCredentialHash: string) {
    const stakeholder = await this.stakeholders.getStakeholder(wallet);
    const expectedHash = `0x${companyRoleCredentialHash.replace(/^0x/, '')}`;
    const credentialId = await this.credentials.credentialIdByHash(expectedHash);
    const [credentialStatus, issuePermission, registerPermission] = await Promise.all([
      /^0x0{64}$/i.test(String(credentialId))
        ? Promise.resolve(0)
        : this.credentials.effectiveStatus(credentialId),
      this.stakeholders.roleHasPermission(2, id('ISSUE_INGREDIENT_CREDENTIAL')),
      this.stakeholders.roleHasPermission(2, id('REGISTER_INGREDIENT')),
    ]);
    return {
      credentialAuthorized:
        String(stakeholder.credentialHash).toLowerCase() === expectedHash.toLowerCase() &&
        Number(credentialStatus) === 1,
      issuePermission: Boolean(issuePermission),
      registerPermission: Boolean(registerPermission),
      role: Number(stakeholder.role),
      status: Number(stakeholder.status),
    };
  }

  async getCredential(credentialId: string) {
    try {
      const record = await this.credentials.getCredential(credentialId);
      return {
        credentialHash: String(record.credentialHash),
        credentialType: Number(record.credentialType),
        encryptedCid: String(record.encryptedCid),
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

  async getBatch(batchId: string) {
    try {
      const record = await this.ingredients.getBatch(batchId);
      return {
        availableQuantity: BigInt(record.availableQuantity).toString(),
        credentialId: String(record.credentialId),
        encryptedCid: String(record.encryptedCid),
        expiresAt: Number(record.expiresAt),
        metadataHash: String(record.metadataHash),
        producedAt: Number(record.producedAt),
        status: Number(record.status),
        supplier: getAddress(String(record.supplier)),
        totalQuantity: BigInt(record.totalQuantity).toString(),
        unit: String(record.unit),
      };
    } catch (error) {
      if (isMissing(error, ingredientInterface)) return null;
      throw error;
    }
  }

  async listBatchIds(supplierWallet: string) {
    const filter = this.ingredients.filters.IngredientBatchRegistered(null, supplierWallet);
    const logs = await this.ingredients.queryFilter(filter, 0, 'latest');
    return logs.map((log) =>
      String((log as unknown as { args: { batchId: string } }).args.batchId),
    );
  }

  prepareIngredientCredentialRegistration(input: {
    credentialHash: string;
    credentialId: string;
    encryptedCid: string;
    expiresAt: number;
    supplierWallet: string;
  }): PreparedTransaction {
    return {
      chainId: this.chainId,
      data: credentialInterface.encodeFunctionData('registerCredential', [
        input.credentialId,
        input.credentialHash,
        input.encryptedCid,
        input.supplierWallet,
        2,
        input.expiresAt,
      ]),
      to: this.credentialAddress,
      value: '0x0',
    };
  }

  prepareBatchRegistration(input: {
    batchId: string;
    credentialId: string;
    encryptedCid: string;
    expiresAt: number;
    metadataHash: string;
    producedAt: number;
    quantity: string;
    unit: string;
  }): PreparedTransaction {
    return {
      chainId: this.chainId,
      data: ingredientInterface.encodeFunctionData('registerBatch', [
        input.batchId,
        input.metadataHash,
        input.encryptedCid,
        input.credentialId,
        BigInt(input.quantity),
        encodeBytes32String(input.unit),
        input.producedAt,
        input.expiresAt,
      ]),
      to: this.ingredientAddress,
      value: '0x0',
    };
  }
}

function isMissing(error: unknown, contractInterface: Interface) {
  const candidate = error as { data?: string; info?: { error?: { data?: string } } };
  const data = candidate?.data ?? candidate?.info?.error?.data;
  if (typeof data !== 'string') return false;
  try {
    return contractInterface.parseError(data)?.name === 'InvalidInput';
  } catch {
    return false;
  }
}

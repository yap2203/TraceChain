import { Contract, Interface, JsonRpcProvider, encodeBytes32String, getAddress, id } from 'ethers';

import type { PreparedTransaction } from '../blockchain/blockchain-gateway.service.js';
import { EthersOrdersGateway } from '../orders/orders.gateway.js';
import type {
  ChainEvidenceRequest,
  ChainIngredientBatch,
  ChainProduct,
  ChainTransfer,
} from './production-flow.types.js';

const stakeholderAbi = [
  'event StakeholderRegistered(address indexed account,uint8 indexed role,bytes32 indexed credentialHash)',
  'function getStakeholder(address) view returns (tuple(uint8 role,uint8 status,bytes32 credentialHash,string credentialCid,uint64 credentialExpiresAt,uint64 updatedAt))',
  'function hasPermission(address,bytes32) view returns (bool)',
  'function roleOf(address) view returns (uint8)',
] as const;
const credentialAbi = [
  'error InvalidInput()',
  'function credentialIdByHash(bytes32) view returns (bytes32)',
  'function effectiveStatus(bytes32) view returns (uint8)',
  'function getCredential(bytes32) view returns (tuple(bytes32 credentialHash,string encryptedCid,address issuer,address subject,uint8 credentialType,uint8 status,uint64 issuedAt,uint64 expiresAt,uint64 updatedAt))',
] as const;
const ingredientAbi = [
  'function supplyOrders() view returns (address)',
  'function manufacturerUsable(bytes32,address) view returns (uint256)',
  'function getReceivedStock(bytes32,address,bytes32) view returns (tuple(uint256 usable,uint256 damaged,uint256 rejected,uint256 missing,uint256 consumed))',
  'error InvalidInput()',
  'event IngredientBatchRegistered(bytes32 indexed batchId,address indexed supplier,bytes32 indexed credentialId,uint256 quantity,bytes32 metadataHash,string encryptedCid)',
  'function getBatch(bytes32) view returns (tuple(address supplier,bytes32 metadataHash,string encryptedCid,bytes32 credentialId,uint256 totalQuantity,uint256 availableQuantity,bytes32 unit,uint64 producedAt,uint64 expiresAt,uint8 status))',
] as const;
const evidenceAbi = [
  'error InvalidInput()',
  'event EvidenceRequested(bytes32 indexed requestId,address indexed requester,address indexed supplier,bytes32 ingredientBatchId,bytes32 claimsHash,bytes32 challengeHash,string requestCid,uint64 dueAt)',
  'function getRequest(bytes32) view returns (tuple(address requester,address supplier,bytes32 ingredientBatchId,bytes32 claimsHash,bytes32 challengeHash,string requestCid,string presentationCid,bytes32 presentationHash,uint8 status,uint64 dueAt,uint64 presentationExpiresAt,uint64 updatedAt))',
  'function acceptedForManufacturer(bytes32,address) view returns (bool)',
  'function requestEvidence(bytes32,address,bytes32,bytes32,bytes32,string,uint64)',
  'function respond(bytes32,bytes32,string,uint64)',
  'function accept(bytes32,bytes32)',
  'function close(bytes32,uint8,bytes32)',
] as const;
const productAbi = [
  'function receivedProductionPolicy() view returns (uint8)',
  'function productionRecordedAt(bytes32) view returns (uint64)',
  'function productionLocation(bytes32) view returns (bytes32)',
  'function createProductAt(bytes32,bytes32,string,uint256,bytes32,uint64,uint64,bytes32[],uint256[],bytes32)',
  'error InvalidInput()',
  'function getProduct(bytes32) view returns (tuple(address manufacturer,bytes32 metadataHash,string publicCid,uint256 totalQuantity,bytes32 unit,uint64 producedAt,uint64 expiresAt,uint8 status))',
  'function getIngredientLinks(bytes32) view returns (tuple(bytes32 batchId,uint256 quantity)[])',
  'function isTransferable(bytes32) view returns (bool)',
  'function createProduct(bytes32,bytes32,string,uint256,bytes32,uint64,uint64,bytes32[],uint256[])',
] as const;
const custodyAbi = [
  'error InvalidInput()',
  'event TransferCreated(bytes32 indexed transferId,bytes32 indexed productBatchId,address indexed sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid)',
  'function getTransfer(bytes32) view returns (tuple(bytes32 productBatchId,address sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid,uint64 dispatchedAt,uint64 expectedAt,uint8 status,uint256 usable,uint256 damaged,uint256 rejected))',
  'function getInventory(bytes32,address) view returns (tuple(uint256 available,uint256 reserved,uint256 damaged,uint256 rejected))',
  'function createTransfer(bytes32,bytes32,address,uint256,uint64,bytes32,string)',
] as const;

const evidenceInterface = new Interface(evidenceAbi);
const productInterface = new Interface(productAbi);
const custodyInterface = new Interface(custodyAbi);
const ingredientInterface = new Interface(ingredientAbi);
const credentialInterface = new Interface(credentialAbi);

export interface ProductionFlowGateway {
  supportsOptionalProductionEvidence?(): Promise<boolean>;
  getProductionRecord?(batchId: string): Promise<{ location: string; recordedAt: number }>;
  listProposedProductBatchIds?(wallet: string): Promise<string[]>;
  getReceivedAvailable?(batchId: string, wallet: string, location?: string): Promise<string | null>;
  assertDeployment(): Promise<void>;
  getAccess(
    wallet: string,
    companyCredentialHash: string,
    role: number,
    permission: string,
  ): Promise<boolean>;
  getAccepted(batchId: string, manufacturer: string): Promise<boolean>;
  getCredential(credentialId: string): Promise<{
    credentialHash: string;
    credentialType: number;
    expiresAt: number;
    issuer: string;
    status: number;
    subject: string;
  } | null>;
  getEvidenceRequest(requestId: string): Promise<ChainEvidenceRequest | null>;
  getIngredient(batchId: string): Promise<ChainIngredientBatch | null>;
  getInventory(
    batchId: string,
    holder: string,
  ): Promise<{ available: string; initialized: boolean; reserved: string }>;
  hasPermission(wallet: string, permission: string): Promise<boolean>;
  getProduct(batchId: string): Promise<ChainProduct | null>;
  getProductLinks(batchId: string): Promise<Array<{ batchId: string; quantity: string }>>;
  getTransfer(transferId: string): Promise<ChainTransfer | null>;
  isTransferable(batchId: string): Promise<boolean>;
  isRoleAuthorized(wallet: string, role: number): Promise<boolean>;
  listActiveDistributors(): Promise<string[]>;
  listActiveRetailers(): Promise<string[]>;
  listReceivedProductBatchIds(holder: string): Promise<string[]>;
  listEvidenceRequestIds(wallet: string, role: 2 | 3 | 5): Promise<string[]>;
  listIngredients(): Promise<Array<ChainIngredientBatch & { batchId: string }>>;
  prepareAccept(requestId: string, credentialId: string): PreparedTransaction;
  prepareClose(requestId: string, status: number, reasonHash: string): PreparedTransaction;
  prepareEvidenceRequest(input: {
    requestId: string;
    supplier: string;
    batchId: string;
    claimsHash: string;
    challengeHash: string;
    requestCid: string;
    dueAt: number;
  }): PreparedTransaction;
  prepareEvidenceResponse(input: {
    requestId: string;
    presentationHash: string;
    presentationCid: string;
    expiresAt: number;
  }): PreparedTransaction;
  prepareProduct(input: {
    productionLocation?: string;
    batchId: string;
    metadataHash: string;
    publicCid: string;
    quantity: string;
    unit: string;
    producedAt: number;
    expiresAt: number;
    ingredients: Array<{ batchId: string; quantity: string }>;
  }): PreparedTransaction;
  prepareTransfer(input: {
    transferId: string;
    productBatchId: string;
    recipient: string;
    quantity: string;
    expectedAt: number;
    shipmentHash: string;
    shipmentCid: string;
  }): PreparedTransaction;
}

export class EthersProductionFlowGateway implements ProductionFlowGateway {
  async supportsOptionalProductionEvidence() {
    try {
      return Number(await this.products.receivedProductionPolicy()) === 1;
    } catch (error) {
      const failure = error as { code?: string; data?: string; value?: string };
      if (
        (failure.code === 'CALL_EXCEPTION' && failure.data === '0x') ||
        (failure.code === 'BAD_DATA' && failure.value === '0x')
      )
        return false;
      throw error;
    }
  }
  async getProductionRecord(batchId: string) {
    return {
      location: String(await this.products.productionLocation(batchId)),
      recordedAt: Number(await this.products.productionRecordedAt(batchId)),
    };
  }
  async listProposedProductBatchIds(wallet: string) {
    if (!process.env.SUPPLY_ORDERS_ADDRESS) return [];
    const gateway = new EthersOrdersGateway(
      this.chainId,
      process.env.SUPPLY_ORDERS_ADDRESS,
      this.provider._getConnection().url,
      {},
    );
    const events = await gateway.events('orders', 'OrderRequested');
    const batches: string[] = [];
    for (const event of events) {
      if (String(event.buyer).toLowerCase() !== wallet.toLowerCase()) continue;
      const order = await gateway.read('orders', 'getOrder', [event.orderId]);
      const item = await gateway.read('orders', 'getItem', [order.itemId]);
      if (
        Number(item.kind) === 2 &&
        [1, 2].includes(Number(order.status)) &&
        Number(order.expiresAt) > Date.now() / 1000 &&
        !/^0x0{64}$/i.test(order.proposedBatch)
      )
        batches.push(order.proposedBatch);
    }
    return [...new Set(batches)];
  }
  async getReceivedAvailable(batchId: string, wallet: string, location?: string) {
    const ledger = String(await this.ingredients.supplyOrders());
    if (/^0x0{40}$/i.test(ledger)) return null;
    if (location)
      return String((await this.ingredients.getReceivedStock(batchId, wallet, location)).usable);
    return String(await this.ingredients.manufacturerUsable(batchId, wallet));
  }
  private readonly provider: JsonRpcProvider;
  private readonly stakeholders: Contract;
  private readonly credentials: Contract;
  private readonly ingredients: Contract;
  private readonly evidence: Contract;
  private readonly products: Contract;
  private readonly custody: Contract;

  constructor(
    private readonly chainId: number,
    rpcUrl: string,
    private readonly addresses: {
      stakeholder: string;
      credential: string;
      ingredient: string;
      evidence: string;
      product: string;
      custody: string;
    },
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.stakeholders = new Contract(addresses.stakeholder, stakeholderAbi, this.provider);
    this.credentials = new Contract(addresses.credential, credentialAbi, this.provider);
    this.ingredients = new Contract(addresses.ingredient, ingredientAbi, this.provider);
    this.evidence = new Contract(addresses.evidence, evidenceAbi, this.provider);
    this.products = new Contract(addresses.product, productAbi, this.provider);
    this.custody = new Contract(addresses.custody, custodyAbi, this.provider);
  }

  async assertDeployment() {
    const [network, ...codes] = await Promise.all([
      this.provider.getNetwork(),
      ...Object.values(this.addresses).map((address) => this.provider.getCode(address)),
    ]);
    if (network.chainId !== BigInt(this.chainId) || codes.includes('0x')) {
      throw new Error('The production workflow contracts are unavailable on the configured chain.');
    }
  }

  async getAccess(wallet: string, companyCredentialHash: string, role: number, permission: string) {
    const stakeholder = await this.stakeholders.getStakeholder(wallet);
    const expectedHash = `0x${companyCredentialHash.replace(/^0x/, '')}`;
    const credentialId = await this.credentials.credentialIdByHash(expectedHash);
    const credentialStatus = /^0x0{64}$/i.test(String(credentialId))
      ? 0
      : Number(await this.credentials.effectiveStatus(credentialId));
    return (
      Number(stakeholder.role) === role &&
      Number(stakeholder.status) === 1 &&
      String(stakeholder.credentialHash).toLowerCase() === expectedHash.toLowerCase() &&
      credentialStatus === 1 &&
      Boolean(await this.stakeholders.hasPermission(wallet, id(permission)))
    );
  }

  async getAccepted(batchId: string, manufacturer: string) {
    return Boolean(await this.evidence.acceptedForManufacturer(batchId, manufacturer));
  }

  async isRoleAuthorized(wallet: string, role: number) {
    return Number(await this.stakeholders.roleOf(wallet)) === role;
  }

  async hasPermission(wallet: string, permission: string) {
    return Boolean(await this.stakeholders.hasPermission(wallet, id(permission)));
  }

  async getCredential(credentialId: string) {
    try {
      const record = await this.credentials.getCredential(credentialId);
      return {
        credentialHash: String(record.credentialHash),
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

  async getEvidenceRequest(requestId: string) {
    try {
      const r = await this.evidence.getRequest(requestId);
      return {
        challengeHash: String(r.challengeHash),
        claimsHash: String(r.claimsHash),
        dueAt: Number(r.dueAt),
        ingredientBatchId: String(r.ingredientBatchId),
        presentationCid: String(r.presentationCid),
        presentationExpiresAt: Number(r.presentationExpiresAt),
        presentationHash: String(r.presentationHash),
        requestCid: String(r.requestCid),
        requester: getAddress(String(r.requester)),
        status: Number(r.status),
        supplier: getAddress(String(r.supplier)),
        updatedAt: Number(r.updatedAt),
      };
    } catch (error) {
      if (isMissing(error, evidenceInterface)) return null;
      throw error;
    }
  }

  async getIngredient(batchId: string) {
    try {
      const r = await this.ingredients.getBatch(batchId);
      return {
        availableQuantity: BigInt(r.availableQuantity).toString(),
        credentialId: String(r.credentialId),
        encryptedCid: String(r.encryptedCid),
        expiresAt: Number(r.expiresAt),
        metadataHash: String(r.metadataHash),
        producedAt: Number(r.producedAt),
        status: Number(r.status),
        supplier: getAddress(String(r.supplier)),
        totalQuantity: BigInt(r.totalQuantity).toString(),
        unit: String(r.unit),
      };
    } catch (error) {
      if (isMissing(error, ingredientInterface)) return null;
      throw error;
    }
  }

  async listIngredients() {
    const logs = await this.ingredients.queryFilter(
      this.ingredients.filters.IngredientBatchRegistered(),
    );
    const ids = [
      ...new Set(
        logs.map((log) => String((log as unknown as { args: { batchId: string } }).args.batchId)),
      ),
    ];
    const records = await Promise.all(
      ids.map(async (batchId) => {
        const record = await this.getIngredient(batchId);
        return record ? { batchId, ...record } : null;
      }),
    );
    return records.filter((record): record is ChainIngredientBatch & { batchId: string } =>
      Boolean(record),
    );
  }

  async listEvidenceRequestIds(wallet: string, role: 2 | 3 | 5) {
    const filter =
      role === 2
        ? this.evidence.filters.EvidenceRequested(null, null, wallet)
        : this.evidence.filters.EvidenceRequested(null, wallet);
    const logs = await this.evidence.queryFilter(filter);
    return [
      ...new Set(
        logs.map((log) =>
          String((log as unknown as { args: { requestId: string } }).args.requestId),
        ),
      ),
    ];
  }

  async getProduct(batchId: string) {
    try {
      const r = await this.products.getProduct(batchId);
      return {
        expiresAt: Number(r.expiresAt),
        manufacturer: getAddress(String(r.manufacturer)),
        metadataHash: String(r.metadataHash),
        producedAt: Number(r.producedAt),
        publicCid: String(r.publicCid),
        status: Number(r.status),
        totalQuantity: BigInt(r.totalQuantity).toString(),
        unit: String(r.unit),
      };
    } catch (error) {
      if (isMissing(error, productInterface)) return null;
      throw error;
    }
  }

  async getProductLinks(batchId: string) {
    const links = await this.products.getIngredientLinks(batchId);
    return Array.from(links as ArrayLike<{ batchId: string; quantity: bigint }>).map((link) => ({
      batchId: String(link.batchId),
      quantity: BigInt(link.quantity).toString(),
    }));
  }

  async isTransferable(batchId: string) {
    return Boolean(await this.products.isTransferable(batchId));
  }
  async getInventory(batchId: string, holder: string) {
    const [r, events] = await Promise.all([
      this.custody.getInventory(batchId, holder),
      this.custody.queryFilter(this.custody.filters.TransferCreated(null, batchId, holder)),
    ]);
    const available = BigInt(r.available);
    const reserved = BigInt(r.reserved);
    return {
      available: available.toString(),
      initialized:
        events.length > 0 ||
        available > 0n ||
        reserved > 0n ||
        BigInt(r.damaged) > 0n ||
        BigInt(r.rejected) > 0n,
      reserved: reserved.toString(),
    };
  }

  async getTransfer(transferId: string) {
    try {
      const r = await this.custody.getTransfer(transferId);
      return {
        expectedAt: Number(r.expectedAt),
        productBatchId: String(r.productBatchId),
        quantity: BigInt(r.quantity).toString(),
        recipient: getAddress(String(r.recipient)),
        sender: getAddress(String(r.sender)),
        shipmentCid: String(r.shipmentCid),
        shipmentHash: String(r.shipmentHash),
        status: Number(r.status),
        transferId,
      };
    } catch (error) {
      if (isMissing(error, custodyInterface)) return null;
      throw error;
    }
  }

  async listActiveDistributors() {
    return this.listActiveStakeholders(4);
  }

  async listActiveRetailers() {
    return this.listActiveStakeholders(5);
  }

  async listReceivedProductBatchIds(holder: string) {
    const recipient = getAddress(holder);
    const logs = await this.custody.queryFilter(this.custody.filters.TransferCreated());
    return [
      ...new Set(
        logs
          .filter(
            (log) =>
              getAddress(
                String((log as unknown as { args: { recipient: string } }).args.recipient),
              ) === recipient,
          )
          .map((log) =>
            String((log as unknown as { args: { productBatchId: string } }).args.productBatchId),
          ),
      ),
    ];
  }

  private async listActiveStakeholders(role: number) {
    const logs = await this.stakeholders.queryFilter(
      this.stakeholders.filters.StakeholderRegistered(null, role),
    );
    const accounts = [
      ...new Set(
        logs.map((log) =>
          getAddress(String((log as unknown as { args: { account: string } }).args.account)),
        ),
      ),
    ];
    const active = await Promise.all(
      accounts.map(async (account) =>
        Number(await this.stakeholders.roleOf(account)) === role ? account : null,
      ),
    );
    return active.filter((account): account is string => Boolean(account));
  }

  prepareEvidenceRequest(input: {
    requestId: string;
    supplier: string;
    batchId: string;
    claimsHash: string;
    challengeHash: string;
    requestCid: string;
    dueAt: number;
  }) {
    return this.tx(
      this.addresses.evidence,
      evidenceInterface.encodeFunctionData('requestEvidence', [
        input.requestId,
        input.supplier,
        input.batchId,
        input.claimsHash,
        input.challengeHash,
        input.requestCid,
        input.dueAt,
      ]),
    );
  }
  prepareEvidenceResponse(input: {
    requestId: string;
    presentationHash: string;
    presentationCid: string;
    expiresAt: number;
  }) {
    return this.tx(
      this.addresses.evidence,
      evidenceInterface.encodeFunctionData('respond', [
        input.requestId,
        input.presentationHash,
        input.presentationCid,
        input.expiresAt,
      ]),
    );
  }
  prepareAccept(requestId: string, credentialId: string) {
    return this.tx(
      this.addresses.evidence,
      evidenceInterface.encodeFunctionData('accept', [requestId, credentialId]),
    );
  }
  prepareClose(requestId: string, status: number, reasonHash: string) {
    return this.tx(
      this.addresses.evidence,
      evidenceInterface.encodeFunctionData('close', [requestId, status, reasonHash]),
    );
  }
  prepareProduct(input: {
    productionLocation?: string;
    batchId: string;
    metadataHash: string;
    publicCid: string;
    quantity: string;
    unit: string;
    producedAt: number;
    expiresAt: number;
    ingredients: Array<{ batchId: string; quantity: string }>;
  }) {
    return this.tx(
      this.addresses.product,
      productInterface.encodeFunctionData(
        input.productionLocation ? 'createProductAt' : 'createProduct',
        [
          input.batchId,
          input.metadataHash,
          input.publicCid,
          BigInt(input.quantity),
          encodeBytes32String(input.unit),
          input.producedAt,
          input.expiresAt,
          input.ingredients.map((item) => item.batchId),
          input.ingredients.map((item) => BigInt(item.quantity)),
          ...(input.productionLocation ? [input.productionLocation] : []),
        ],
      ),
    );
  }
  prepareTransfer(input: {
    transferId: string;
    productBatchId: string;
    recipient: string;
    quantity: string;
    expectedAt: number;
    shipmentHash: string;
    shipmentCid: string;
  }) {
    return this.tx(
      this.addresses.custody,
      custodyInterface.encodeFunctionData('createTransfer', [
        input.transferId,
        input.productBatchId,
        input.recipient,
        BigInt(input.quantity),
        input.expectedAt,
        input.shipmentHash,
        input.shipmentCid,
      ]),
    );
  }

  private tx(to: string, data: string): PreparedTransaction {
    return { chainId: this.chainId, data, to, value: '0x0' };
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
